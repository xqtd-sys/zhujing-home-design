<script setup lang="ts">
/**
 * 「识别户型图」对话框：选一张网上下载的户型图，本地识别出墙体/房间/门，
 * 预览确认后再写进当前方案。
 *
 * 识别完全在浏览器里跑（Canvas 取灰度 + 纯计算），不上传图片、不调外部接口。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import type { RecognizeOptions, RecognizedFloorplan } from '../editor/plan-recognition'
import { cancelRecognition, recognizeFloorplanAsync } from '../editor/plan-recognition-runner'
import { decodeImage, readImageFile, sampleImage, type PlanBackgroundPatch, type SampledImage } from '../editor/plan-recognition-image'

const props = defineProps<{
  modelValue: boolean
  /** 家具素材库（来自素材 store），用于把识别出的家具框映射到具体素材。 */
  assets?: { id: string; name: string; width: number; depth: number; height: number }[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [payload: { result: RecognizedFloorplan; background: PlanBackgroundPatch; mode: 'replace' | 'append' }]
  'background-only': [payload: { background: PlanBackgroundPatch }]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const fileInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const recognizing = ref(false)
const sampled = ref<SampledImage | null>(null)
const result = ref<RecognizedFloorplan | null>(null)
const errorText = ref('')
const dragging = ref(false)
const previewCanvas = ref<HTMLCanvasElement | null>(null)

/** 整张图最外侧墙之间的实际宽度，用来标定比例。 */
const targetWidthCm = ref(1200)
const wallHeight = ref(280)
const detectRooms = ref(true)
const detectDoors = ref(true)
const detectFurniture = ref(true)
/** 自动摆正：手机拍歪了会自动旋转（倾斜角 > 0.7° 才动手）。 */
const autoDeskew = ref(true)
/** 房间分割模式：watershed（距离场分水岭，推荐）/ flood（旧泛洪）。 */
const roomSegmentation = ref<'watershed' | 'flood'>('watershed')
/** 是否先做局部对比度增强（拍得发灰的照片可开，电子线稿不用）。 */
const enhanceContrast = ref(false)

const hasResult = computed(() => Boolean(result.value && result.value.walls.length > 0))
const stats = computed(() => result.value?.stats ?? null)
const warnings = computed(() => result.value?.warnings ?? [])

/** 连点"换一张"或连续改参数时，旧任务可能后完成；用序号丢弃过期结果。 */
let recognizeToken = 0
let previewToken = 0

function reset() {
  // 关掉对话框时让在途的识别结果作废，避免下次打开被旧结果覆盖。
  recognizeToken += 1
  previewToken += 1
  // Worker 里的计算不会因为换图自动停，必须显式终止，否则旧任务继续烧 CPU。
  cancelRecognition()
  sampled.value = null
  result.value = null
  errorText.value = ''
  loading.value = false
  recognizing.value = false
}

watch(visible, (open) => {
  if (!open) reset()
})

function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await loadFile(file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void loadFile(file)
}

async function loadFile(file: File) {
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
    ElMessage.warning('请选择 PNG、JPG 或 WebP 图片')
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('图片太大了（超过 20MB），请先压缩一下')
    return
  }
  loading.value = true
  errorText.value = ''
  result.value = null
  try {
    const dataUrl = await readImageFile(file)
    const image = await decodeImage(dataUrl)
    sampled.value = sampleImage(image)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '图片处理失败'
    loading.value = false
    return
  }
  // 读取/采样结束后就切到"正在识别墙体…"，不然识别期间一直显示"正在读取图片…"，
  // 用户会以为卡在读文件这一步。
  loading.value = false
  await recognize()
}

function options(): RecognizeOptions {
  const assets = props.assets ?? []
  return {
    targetWidthCm: targetWidthCm.value,
    wallHeight: wallHeight.value,
    detectRooms: detectRooms.value,
    detectDoors: detectDoors.value,
    detectFurniture: detectFurniture.value,
    autoDeskew: autoDeskew.value,
    roomSegmentation: roomSegmentation.value,
    enhanceContrast: enhanceContrast.value,
    furnitureAssets:
      assets.length > 0
        ? assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            baseWidth: asset.width,
            baseDepth: asset.depth,
            baseHeight: asset.height,
          }))
        : undefined,
  }
}

async function recognize() {
  if (!sampled.value) return
  const token = (recognizeToken += 1)
  recognizing.value = true
  errorText.value = ''
  try {
    // 识别放到 Web Worker：真实户型图可能有几千条候选线段，
    // 在主线程上跑会让 loading 都不转，浏览器直接弹"此页面没有响应"。
    const next = await recognizeFloorplanAsync(sampled.value.gray, options())
    // 改参数会连续触发识别，只认最后一次的结果。
    if (token !== recognizeToken) return
    result.value = next
    await nextTick()
    if (token !== recognizeToken) return
    drawPreview()
  } catch (error) {
    if (token === recognizeToken) errorText.value = error instanceof Error ? error.message : '识别失败，请换一张图试试'
  } finally {
    if (token === recognizeToken) recognizing.value = false
  }
}

const previewBitmap = ref<HTMLImageElement | null>(null)

/** 把采样图和识别出的墙线画在一起，让用户先看一眼准不准。 */
function drawPreview() {
  const canvas = previewCanvas.value
  const image = sampled.value
  if (!canvas || !image) return
  const context = canvas.getContext('2d')
  if (!context) return

  const maxWidth = canvas.clientWidth || 520
  const ratio = Math.min(1, maxWidth / image.gray.width)
  canvas.width = Math.round(image.gray.width * ratio)
  canvas.height = Math.round(image.gray.height * ratio)

  context.clearRect(0, 0, canvas.width, canvas.height)
  const bitmap = previewBitmap.value
  if (bitmap) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  else {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  const scale = canvas.width / image.gray.width
  const current = result.value
  if (!current) return

  // 若识别时做了自动摆正，墙线是"摆正后坐标系"里的坐标，需要反向旋转才能贴回原图。
  const rotation = current.transform.rotation ?? 0
  if (rotation) {
    context.save()
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((-rotation * Math.PI) / 180)
    context.translate(-canvas.width / 2, -canvas.height / 2)
  }

  // 房间：用 cm 坐标反算回像素，铺一层半透明底色。
  context.fillStyle = 'rgba(37, 99, 214, 0.12)'
  context.strokeStyle = 'rgba(37, 99, 214, 0.45)'
  context.lineWidth = 1
  const toPx = (value: number, axis: 'x' | 'y'): number =>
    (value - (axis === 'x' ? current.transform.x : current.transform.y)) / current.transform.scale
  for (const room of current.rooms) {
    if (room.polygon.length < 3) continue
    context.beginPath()
    room.polygon.forEach((point, index) => {
      const x = toPx(point.x, 'x') * scale
      const y = toPx(point.y, 'y') * scale
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.fill()
    context.stroke()
  }

  // 墙线：按厚度画粗线，红/青色更好认。
  context.strokeStyle = '#e8453c'
  context.lineCap = 'round'
  for (const segment of current.segments) {
    const thickness = Math.max(1.5, segment.thickness * scale)
    context.lineWidth = thickness
    context.beginPath()
    if (segment.orientation === 'h') {
      context.moveTo(segment.from * scale, segment.cross * scale)
      context.lineTo(segment.to * scale, segment.cross * scale)
    } else {
      context.moveTo(segment.cross * scale, segment.from * scale)
      context.lineTo(segment.cross * scale, segment.to * scale)
    }
    context.stroke()
  }

  // 门：在宿主墙上画一段醒目的绿线。
  context.strokeStyle = '#12a150'
  context.lineWidth = 3
  for (const opening of current.openings) {
    const wall = current.walls.find((item) => item.id === opening.wallId)
    if (!wall) continue
    const horizontal = wall.start.y === wall.end.y
    const from = horizontal ? Math.min(wall.start.x, wall.end.x) : Math.min(wall.start.y, wall.end.y)
    const cross = horizontal ? wall.start.y : wall.start.x
    const start = from + opening.offset
    const end = start + opening.width
    context.beginPath()
    if (horizontal) {
      const y = toPx(cross, 'y') * scale
      context.moveTo(toPx(start, 'x') * scale, y)
      context.lineTo(toPx(end, 'x') * scale, y)
    } else {
      const x = toPx(cross, 'x') * scale
      context.moveTo(x, toPx(start, 'y') * scale)
      context.lineTo(x, toPx(end, 'y') * scale)
    }
    context.stroke()
  }

  // 家具：紫色虚框，方便确认识别到的家具位置。
  context.strokeStyle = 'rgba(140, 84, 214, 0.9)'
  context.fillStyle = 'rgba(140, 84, 214, 0.14)'
  context.lineWidth = 1.5
  for (const item of current.furniture) {
    const boxWidth = (item.width / current.transform.scale) * scale
    const boxHeight = (item.depth / current.transform.scale) * scale
    const boxX = toPx(item.position.x, 'x') * scale - boxWidth / 2
    const boxY = toPx(item.position.y, 'y') * scale - boxHeight / 2
    context.fillRect(boxX, boxY, boxWidth, boxHeight)
    context.strokeRect(boxX, boxY, boxWidth, boxHeight)
  }

  if (rotation) context.restore()
}

watch(
  () => sampled.value?.dataUrl,
  async (src) => {
    const token = (previewToken += 1)
    const bitmap = src ? await decodeImage(src) : null
    if (token !== previewToken) return
    previewBitmap.value = bitmap
    await nextTick()
    if (token !== previewToken) return
    drawPreview()
  },
)

watch([targetWidthCm, wallHeight, detectRooms, detectDoors, detectFurniture, autoDeskew, roomSegmentation, enhanceContrast], () => {
  if (sampled.value) void recognize()
})

function backgroundPatch(): PlanBackgroundPatch | null {
  const image = sampled.value
  if (!image) return null
  const current = result.value
  // 还没识别出墙时也允许只铺底图：按"图纸总宽"把整张图等比铺满，用户自己再拉。
  if (!current) {
    const scale = targetWidthCm.value / Math.max(1, image.gray.width)
    return {
      src: image.dataUrl,
      x: 100,
      y: 100,
      width: Math.round(image.gray.width * scale),
      height: Math.round(image.gray.height * scale),
      opacity: 0.35,
    }
  }
  return {
    src: image.dataUrl,
    x: Math.round(current.transform.x),
    y: Math.round(current.transform.y),
    width: Math.round(current.transform.width),
    height: Math.round(current.transform.height),
    opacity: 0.35,
  }
}

function apply(mode: 'replace' | 'append') {
  const current = result.value
  const patch = backgroundPatch()
  if (!current || !patch || current.walls.length === 0) return
  emit('apply', { result: current, background: patch, mode })
  visible.value = false
}

function backgroundOnly() {
  const patch = backgroundPatch()
  if (!patch) return
  emit('background-only', { background: patch })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="识别户型图"
    width="920px"
    top="4vh"
    class="plan-import-dialog"
    :close-on-click-modal="false"
  >
    <div class="import-body">
      <div
        class="import-preview"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <canvas v-show="sampled" ref="previewCanvas" class="import-canvas" />
        <div v-if="!sampled" class="import-empty">
          <p>把网上下载的户型图拖到这里，或点下面的按钮选择图片</p>
          <small>支持 PNG / JPG / WebP，识别在本机完成，图片不会上传</small>
        </div>
        <div v-if="loading || recognizing" class="import-loading">
          {{ loading ? '正在读取图片…' : '正在识别墙体…' }}
        </div>
        <button v-if="sampled" type="button" class="import-repick" @click="pickFile">换一张</button>
      </div>

      <div class="import-side">
        <button type="button" class="import-upload" @click="pickFile">
          <el-icon><Upload /></el-icon>
          {{ sampled ? '重新选择图片' : '选择户型图' }}
        </button>

        <div class="import-fields">
          <label class="import-field">
            <span>图纸总宽</span>
            <el-input-number v-model="targetWidthCm" :min="200" :max="6000" :step="50" controls-position="right" />
            <small>cm · 最外侧两面墙之间的距离</small>
          </label>
          <label class="import-field">
            <span>墙高</span>
            <el-input-number v-model="wallHeight" :min="200" :max="500" :step="10" controls-position="right" />
            <small>cm · 生成墙体的高度</small>
          </label>
          <label class="import-switch">
            <span>识别房间</span>
            <el-switch v-model="detectRooms" size="small" />
          </label>
          <label class="import-switch">
            <span>识别门洞</span>
            <el-switch v-model="detectDoors" size="small" />
          </label>
          <label class="import-switch">
            <span>识别家具</span>
            <el-switch v-model="detectFurniture" size="small" />
          </label>

          <details class="import-advanced">
            <summary>高级选项</summary>
            <label class="import-switch">
              <span>自动摆正</span>
              <el-switch v-model="autoDeskew" size="small" />
            </label>
            <label class="import-switch">
              <span>增强对比度</span>
              <el-switch v-model="enhanceContrast" size="small" />
            </label>
            <label class="import-field">
              <span>房间分割</span>
              <el-select v-model="roomSegmentation" size="small" style="width: 100%">
                <el-option label="距离场分水岭（推荐）" value="watershed" />
                <el-option label="泛洪（旧）" value="flood" />
              </el-select>
              <small>分水岭能避免门洞把两个房间连成一间</small>
            </label>
          </details>
        </div>

        <div v-if="stats" class="import-stats">
          <div><strong>{{ stats.wallCount }}</strong><small>面墙</small></div>
          <div><strong>{{ stats.roomCount }}</strong><small>个房间</small></div>
          <div><strong>{{ stats.openingCount }}</strong><small>个门</small></div>
          <div><strong>{{ stats.furnitureCount }}</strong><small>件家具</small></div>
          <div class="import-stat-wide"><strong>{{ Math.round(stats.widthCm) }}×{{ Math.round(stats.heightCm) }}</strong><small>cm</small></div>
        </div>

        <p v-if="errorText" class="import-error">{{ errorText }}</p>
        <ul v-if="warnings.length" class="import-warnings">
          <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
        </ul>
        <p v-if="!sampled" class="import-hint">
          建议用正着拍的顶视户型图（墙是水平/垂直的粗线）。斜拍照片、3D 效果图无法反推尺寸。
        </p>
      </div>
    </div>

    <template #footer>
      <div class="import-footer">
        <span v-if="!hasResult" class="import-footer-hint">
          {{ recognizing ? '正在识别…' : result ? '没识别到墙体，可以先用「只铺底图」' : '选一张户型图后可用' }}
        </span>
        <el-button text @click="visible = false">取消</el-button>
        <el-button :disabled="!sampled" @click="backgroundOnly">只铺底图</el-button>
        <el-button :disabled="!hasResult" @click="apply('append')">追加到当前方案</el-button>
        <el-button type="primary" :disabled="!hasResult" @click="apply('replace')">替换墙体并导入</el-button>
      </div>
    </template>

    <input
      ref="fileInput"
      class="hidden-file"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      @change="onFileChange"
    />
  </el-dialog>
</template>

<style>
/*
 * 弹窗整体用 flex 撑成一列：正文自己滚，底部按钮固定在框内。
 * 之前正文随内容变高，选项一多按钮就被顶到屏幕外，用户点不到"确认"。
 * 这几个类名由 Element Plus 生成，不在本组件的 scoped 范围内，所以单独写一段全局样式。
 */
.plan-import-dialog {
  display: flex;
  flex-direction: column;
  max-width: 96vw;
  /* 顶部 4vh + 弹窗高度 + 底部留白 = 100vh，保证整框始终落在视口内。 */
  max-height: calc(96vh - 24px);
  margin-bottom: 24px;
}
.plan-import-dialog .el-dialog__header {
  flex: 0 0 auto;
}
.plan-import-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.plan-import-dialog .el-dialog__footer {
  flex: 0 0 auto;
  border-top: 1px solid var(--line);
}
</style>

<style scoped>
.import-body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 1fr);
  gap: 18px;
  align-items: start;
}
.import-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 10px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow: hidden;
}
.import-preview.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.import-canvas {
  display: block;
  max-width: 100%;
  max-height: 58vh;
  border-radius: 6px;
  background: #fff;
}
.import-empty {
  text-align: center;
  color: var(--text);
  opacity: 0.8;
}
.import-empty p {
  margin: 0 0 6px;
  font-size: 13px;
}
.import-empty small {
  font-size: 12px;
  opacity: 0.7;
}
.import-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-strong);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
}
.import-repick {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-strong);
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  cursor: pointer;
}
.import-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.import-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.import-upload:hover {
  border-color: var(--accent);
}
.import-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.import-field {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 6px 8px;
  font-size: 12px;
}
.import-field > span {
  color: var(--text-strong);
}
.import-field small {
  grid-column: 2;
  font-size: 11px;
  opacity: 0.65;
}
.import-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-strong);
}
.import-advanced {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}
.import-advanced > summary {
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.import-advanced > summary::before {
  content: '▸ ';
}
.import-advanced[open] > summary::before {
  content: '▾ ';
}
.import-advanced[open] {
  gap: 10px;
}
.import-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.import-stats > div {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.import-stats strong {
  font-size: 16px;
  color: var(--text-strong);
}
.import-stats small {
  font-size: 11px;
  opacity: 0.7;
}
.import-stat-wide {
  grid-column: 1 / -1;
}
.import-error {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: #e8453c;
  border: 1px solid rgba(232, 69, 60, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(232, 69, 60, 0.08);
}
.import-warnings {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.75;
}
.import-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.65;
}
.import-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.import-footer-hint {
  margin-right: auto;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 780px) {
  .import-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .import-canvas {
    max-height: 40vh;
  }
}
</style>
