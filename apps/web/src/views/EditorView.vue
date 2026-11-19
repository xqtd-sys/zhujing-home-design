<script setup lang="ts">
import { ArrowLeft, Check, Delete, DocumentCopy, Download, MagicStick, Picture, RefreshLeft, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { PlanDocumentSchema, polygonArea, type PlanDocument, type Point2D } from '@home-design/plan-schema'
import FloorplanCanvas from '../components/FloorplanCanvas.vue'
import DesignToolIcon from '../components/DesignToolIcon.vue'
import FurnitureThumb from '../components/FurnitureThumb.vue'
import OpeningPreview from '../components/OpeningPreview.vue'
import PlanImportDialog from '../components/PlanImportDialog.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { cloneReactive } from '../editor/clone'
import { DOOR_PRESETS, WINDOW_PRESETS, openingStyleKey, presetsFor, type OpeningPreset } from '../editor/opening-presets'
import { applyRecognizedFloorplan, type RecognizedFloorplan } from '../editor/plan-recognition'
import type { PlanBackgroundPatch } from '../editor/plan-recognition-image'
import { draftKey, readDraft, type PlanDraft } from '../editor/drafts'
import {
  alignFurniture,
  distributeFurniture,
  findOpenWallEndpoints,
  segmentAngleDegrees,
  wallFromLengthAngle,
  type AlignMode,
} from '../editor/geometry'
import { useAssetsStore } from '../stores/assets'
import { deletePlan, getPlan, savePlan } from '../api/plans'
import type { PlanDetail } from '../types/api'

const route = useRoute()
const router = useRouter()
const assetCatalog = useAssetsStore()
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const plan = ref<PlanDetail | null>(null)
const activeMode = ref<'2d' | '3d'>('2d')
const activeTool = ref<'select' | 'wall' | 'door' | 'window' | 'room' | 'furniture'>('select')
const activeOpeningPresetId = ref(DOOR_PRESETS[0].id)
const activePresets = computed(() => presetsFor(activeTool.value === 'window' ? 'window' : 'door'))
const activeOpeningPreset = computed<OpeningPreset | null>(() => {
  if (activeTool.value !== 'door' && activeTool.value !== 'window') return null
  return activePresets.value.find((preset) => preset.id === activeOpeningPresetId.value) ?? activePresets.value[0] ?? null
})
const selectedEntity = ref<{ type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null>(null)
/** 画布多选家具集合（Shift+点击），用于对齐/等间距。 */
const multiFurnitureIds = ref<string[]>([])
const undoStack = ref<PlanDocument[]>([])
const redoStack = ref<PlanDocument[]>([])
const dirty = ref(false)
const draftStatus = ref('')
let draftTimer: ReturnType<typeof setTimeout> | undefined
const assetsExpanded = ref(false)
const propertiesExpanded = ref(false)
type PlanBackground = { src: string; x: number; y: number; width: number; height: number; opacity: number }
const background = ref<PlanBackground | null>(null)
const bgInput = ref<HTMLInputElement | null>(null)
const importDialogOpen = ref(false)
const threePreview = ref<{ exportPng: (filename?: string) => void } | null>(null)
const magnetEnabled = ref(true)
try {
  magnetEnabled.value = localStorage.getItem('zhujing:magnet') !== '0'
} catch {
  /* 隐私模式下默认开启 */
}
function toggleMagnet() {
  magnetEnabled.value = !magnetEnabled.value
  try {
    localStorage.setItem('zhujing:magnet', magnetEnabled.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
const showDimensions = ref(true)
try {
  showDimensions.value = localStorage.getItem('zhujing:dimensions') !== '0'
} catch {
  /* 隐私模式下默认开启 */
}
function toggleDimensions() {
  showDimensions.value = !showDimensions.value
  try {
    localStorage.setItem('zhujing:dimensions', showDimensions.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

type LayerKey = 'walls' | 'rooms' | 'openings' | 'furniture'
const layerItems: Array<{ key: LayerKey; label: string }> = [
  { key: 'walls', label: '墙体' },
  { key: 'rooms', label: '房间' },
  { key: 'openings', label: '门窗' },
  { key: 'furniture', label: '家具' },
]
/** 图层显隐是视图偏好，按浏览器保存，不写入设计数据。 */
const layers = reactive<Record<LayerKey, boolean>>({ walls: true, rooms: true, openings: true, furniture: true })
try {
  const storedLayers = localStorage.getItem('zhujing:layers')
  if (storedLayers) Object.assign(layers, JSON.parse(storedLayers) as Partial<Record<LayerKey, boolean>>)
} catch {
  /* 隐私模式下默认全部显示 */
}
function toggleLayer(key: LayerKey) {
  layers[key] = !layers[key]
  try {
    localStorage.setItem('zhujing:layers', JSON.stringify(layers))
  } catch {
    /* ignore */
  }
}
const toolGuide = computed(
  () =>
    ({
      select: ['选择与调整', '点击墙体、门窗或家具查看尺寸。选中家具后可拖动四角手柄缩放，拖动时会自动对齐其它家具/房间；Ctrl+Shift+D 或右侧按钮复制。'],
      wall: ['画出空间轮廓', '按住左键拖动绘制墙体，松开完成。端点会自动吸附到其它墙的端点或墙中线，靠近水平/垂直时自动对齐；按住 Shift 强制锁定水平或垂直，右键取消本次绘制。'],
      door: ['在墙上放门', '点击墙体放置门，默认宽 90 cm、高 210 cm。放置后可在属性面板调整尺寸。'],
      window: ['在墙上放窗', '点击墙体放置窗，默认宽 120 cm、窗高 120 cm、窗台 90 cm。避免与其他门窗重叠。'],
      room: ['标注房间边界', '依次点击房间各个角，最后点击第一个点闭合。右键或 Esc 取消未完成的边界。'],
      furniture: ['摆放家具', '展开家具素材，拖入画布，或双击素材放到画布中央。选中后可调整尺寸和旋转角度。'],
    })[activeTool.value],
)
const planId = computed(() => String(route.params.id))
const bgStorageKey = computed(() => `zhujing:bg:${planId.value}`)

function loadBackground() {
  try {
    const raw = localStorage.getItem(bgStorageKey.value)
    background.value = raw ? (JSON.parse(raw) as PlanBackground) : null
  } catch {
    background.value = null
  }
}

watch(
  background,
  (value) => {
    try {
      if (value) localStorage.setItem(bgStorageKey.value, JSON.stringify(value))
      else localStorage.removeItem(bgStorageKey.value)
    } catch {
      /* 隐私模式下忽略 */
    }
  },
  { deep: true },
)

function triggerBackgroundImport() {
  bgInput.value?.click()
}

function onBackgroundFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/image\/(png|jpeg)/.test(file.type)) {
    ElMessage.warning('请选择 PNG 或 JPG 图片')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const src = String(reader.result ?? '')
    const image = new Image()
    image.onload = () => {
      const ratio = image.naturalHeight / image.naturalWidth || 0.75
      const width = 800
      background.value = { src, x: 0, y: 0, width, height: Math.round(width * ratio), opacity: 0.5 }
      ElMessage.success('已导入参考底图，可调整透明度与位置后描图')
    }
    image.src = src
  }
  reader.readAsDataURL(file)
}

function clearBackground() {
  background.value = null
}

/** 打开「识别户型图」对话框。 */
function openImportDialog() {
  if (activeMode.value !== '2d') return
  importDialogOpen.value = true
}

/**
 * 把识别结果写进当前方案。
 * replace 只替换墙/房间/门，家具保留；append 追加到现有内容后面。
 */
function onImportApply(payload: {
  result: RecognizedFloorplan
  background: PlanBackgroundPatch
  mode: 'replace' | 'append'
}) {
  if (!plan.value) return
  const document = cloneReactive(plan.value.documentJson)
  const merged = applyRecognizedFloorplan(document, payload.result, payload.mode)

  const next = {
    ...document,
    walls: merged.walls,
    rooms: merged.rooms,
    openings: merged.openings,
    furniture: merged.furniture,
  }
  const parsed = PlanDocumentSchema.safeParse(next)
  if (!parsed.success) {
    ElMessage.error(`识别结果不合规：${parsed.error.issues[0]?.message ?? '未知错误'}`)
    return
  }

  recordHistory()
  plan.value.documentJson = parsed.data
  background.value = { ...payload.background }
  selectedEntity.value = null
  multiFurnitureIds.value = []
  chooseTool('select')

  const stats = payload.result.stats
  const furniturePart = stats.furnitureCount > 0 ? `、${stats.furnitureCount} 件家具` : ''
  ElMessage.success(
    `已导入 ${stats.wallCount} 面墙、${stats.roomCount} 个房间、${stats.openingCount} 个门${furniturePart}`,
  )
  // 画布要等新 document 渲染完再定位，否则按旧内容算视野。
  setTimeout(() => canvas.value?.locateDesign(), 0)
}

/** 只要底图，不写墙（沿用原来的描图用法）。 */
function onImportBackgroundOnly(payload: { background: PlanBackgroundPatch }) {
  background.value = { ...payload.background }
  ElMessage.success('已铺好参考底图，可以手动描墙')
}

function resizeBackground(value?: number) {
  if (!background.value || value === undefined || Number.isNaN(value)) return
  const ratio = background.value.height / background.value.width || 0.75
  background.value.width = Math.max(50, Math.min(5000, value))
  background.value.height = Math.round(background.value.width * ratio)
}

function moveBackground(axis: 'x' | 'y', value?: number) {
  if (!background.value || value === undefined || Number.isNaN(value)) return
  background.value[axis] = value
}

function exportPng() {
  const name = (plan.value?.name ?? '设计方案').replace(/[\\/:*?"<>|]/g, '_')
  if (activeMode.value === '2d') canvas.value?.exportPng(name)
  else threePreview.value?.exportPng(name)
  ElMessage.success('已导出 PNG')
}
const canvas = ref<InstanceType<typeof FloorplanCanvas> | null>(null)
const ThreePreview = defineAsyncComponent(() => import('../components/ThreePreview.vue'))
const selectedRoom = computed(() => {
  if (selectedEntity.value?.type !== 'room') return null
  return plan.value?.documentJson.rooms.find((room) => room.id === selectedEntity.value?.id) ?? null
})
const selectedWall = computed(() => {
  if (selectedEntity.value?.type !== 'wall') return null
  return plan.value?.documentJson.walls.find((wall) => wall.id === selectedEntity.value?.id) ?? null
})
const selectedWallLength = computed(() =>
  selectedWall.value
    ? Math.hypot(selectedWall.value.end.x - selectedWall.value.start.x, selectedWall.value.end.y - selectedWall.value.start.y)
    : 0,
)
const selectedWallAngle = computed(() => (selectedWall.value ? segmentAngleDegrees(selectedWall.value) : 0))
const selectedOpening = computed(() => {
  if (selectedEntity.value?.type !== 'opening') return null
  return plan.value?.documentJson.openings.find((opening) => opening.id === selectedEntity.value?.id) ?? null
})
const selectedFurniture = computed(() => {
  if (selectedEntity.value?.type !== 'furniture') return null
  return plan.value?.documentJson.furniture.find((furniture) => furniture.id === selectedEntity.value?.id) ?? null
})
const selectedFurnitureAsset = computed(() =>
  selectedFurniture.value ? assetCatalog.getById(selectedFurniture.value.assetId) : undefined,
)
/**
 * 画布上的实时尺寸提示（HUD）。
 * 高度是竖向尺寸，2D 俯视图里画不出来；用这个 HUD 让"改高度"也有即时、可见的反馈。
 */
const selectionHud = computed(() => {
  const round = (value: number) => Math.round(value)
  if (selectedFurniture.value) {
    const furniture = selectedFurniture.value
    // 与属性面板一致：深度框用 height、高度框用 depth（两者对调）
    return `家具 · 宽 ${round(furniture.width)} · 深 ${round(furniture.height)} · 高 ${round(furniture.depth)} cm`
  }
  if (selectedOpening.value) {
    const opening = selectedOpening.value
    return `${opening.type === 'door' ? '门' : '窗'} · 宽 ${round(opening.width)} · 高 ${round(opening.height)} cm${
      opening.type === 'window' ? ` · 窗台 ${round(opening.sillHeight)}` : ''
    }`
  }
  if (selectedWall.value) {
    const wall = selectedWall.value
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    return `墙 · 长 ${round(length)} · 厚 ${round(wall.thickness)} · 高 ${round(wall.height)} cm`
  }
  return ''
})
const visibleAssets = computed(() => assetCatalog.items)

/** 左侧素材面板标题跟随当前工具。 */
const libraryTitle = computed(() => {
  switch (activeTool.value) {
    case 'door':
      return '门款式'
    case 'window':
      return '窗款式'
    case 'wall':
      return '墙体'
    case 'room':
      return '房间'
    case 'furniture':
      return '家具素材'
    default:
      return '选择与编辑'
  }
})

async function load() {
  loading.value = true
  clearTimeout(draftTimer)
  dirty.value = false
  draftStatus.value = ''
  selectedEntity.value = null
  multiFurnitureIds.value = []
  plan.value = null
  try {
    plan.value = await getPlan(planId.value)
    undoStack.value = []
    redoStack.value = []
    dirty.value = false
    await offerDraft()
  } catch {
    // API errors are displayed by the shared request handler.
  } finally {
    loading.value = false
  }
}

function persistDraft() {
  clearTimeout(draftTimer)
  if (!plan.value || !dirty.value) return true
  try {
    const draft: PlanDraft = {
      version: 1,
      ownerId: plan.value.ownerId,
      planId: plan.value.id,
      baseRevision: plan.value.revision,
      savedAt: Date.now(),
      documentJson: plan.value.documentJson,
    }
    localStorage.setItem(draftKey(draft.ownerId, draft.planId), JSON.stringify(draft))
    draftStatus.value = '草稿已保存在此浏览器，尚未保存到服务器'
    return true
  } catch {
    draftStatus.value = '本地草稿保存失败，请及时点击保存'
    return false
  }
}

function clearDraft() {
  clearTimeout(draftTimer)
  if (!plan.value) return
  try {
    localStorage.removeItem(draftKey(plan.value.ownerId, plan.value.id))
    draftStatus.value = ''
  } catch {
    draftStatus.value = '服务器已保存，但本地草稿未能清除'
  }
}

async function offerDraft() {
  if (!plan.value) return
  let draft: PlanDraft | null
  try {
    draft = readDraft(localStorage, plan.value.ownerId, plan.value.id)
  } catch {
    draftStatus.value = '本地草稿无法读取，已加载服务器版本'
    return
  }
  if (!draft) return
  if (JSON.stringify(draft.documentJson) === JSON.stringify(plan.value.documentJson)) {
    clearDraft()
    return
  }
  const stale = draft.baseRevision !== plan.value.revision
  const restore = await ElMessageBox.confirm(
    `发现 ${new Date(draft.savedAt).toLocaleString()} 的未保存草稿。${stale ? '服务器版本已变化，恢复后不会自动覆盖服务器，旧版本保存会被拒绝。' : '恢复后请点击保存，将修改保存到服务器。'}`,
    '发现本地草稿',
    {
      confirmButtonText: '恢复草稿',
      cancelButtonText: '丢弃草稿',
      type: 'warning',
      closeOnClickModal: false,
      closeOnPressEscape: false,
      showClose: false,
    },
  )
    .then(() => true)
    .catch(() => false)
  if (restore) {
    undoStack.value = [cloneReactive(plan.value.documentJson)]
    plan.value.documentJson = draft.documentJson
    // Keep the original revision so a stale draft cannot overwrite newer server edits.
    plan.value.revision = draft.baseRevision
    dirty.value = true
    persistDraft()
  } else {
    clearDraft()
  }
}

watch(
  () => plan.value?.documentJson,
  () => {
    if (loading.value || !dirty.value) return
    draftStatus.value = '正在保存本地草稿…'
    clearTimeout(draftTimer)
    draftTimer = setTimeout(persistDraft, 400)
  },
  { deep: true },
)

async function confirmLeave() {
  if (!dirty.value) return true
  const stored = persistDraft()
  return ElMessageBox.confirm(
    stored
      ? '修改尚未保存到服务器。本地草稿已保留，下次打开此方案可恢复。确定离开吗？'
      : '本地草稿保存失败，离开将丢失未保存修改。建议先留在页面点击保存。',
    '尚未保存',
    { confirmButtonText: stored ? '保留草稿并离开' : '仍然离开', cancelButtonText: '继续编辑', type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  persistDraft()
  event.preventDefault()
  event.returnValue = ''
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') persistDraft()
}

onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
watch(planId, () => {
  void load()
})

function recordHistory() {
  if (!plan.value) return
  undoStack.value.push(cloneReactive(plan.value.documentJson))
  if (undoStack.value.length > 50) undoStack.value.shift()
  redoStack.value = []
  dirty.value = true
}

function onDocumentUpdate(document: PlanDocument) {
  if (plan.value) plan.value.documentJson = document
}

function undo() {
  if (!plan.value || undoStack.value.length === 0) return
  canvas.value?.clearInteraction()
  redoStack.value.push(cloneReactive(plan.value.documentJson))
  plan.value.documentJson = undoStack.value.pop() as PlanDocument
  dirty.value = true
  selectedEntity.value = null
}

function redo() {
  if (!plan.value || redoStack.value.length === 0) return
  canvas.value?.clearInteraction()
  undoStack.value.push(cloneReactive(plan.value.documentJson))
  plan.value.documentJson = redoStack.value.pop() as PlanDocument
  dirty.value = true
  selectedEntity.value = null
}

function chooseTool(tool: 'select' | 'wall' | 'door' | 'window' | 'room' | 'furniture') {
  activeTool.value = tool
  // 窄屏下面板是折叠的：只有需要素材的工具才自动展开，切回纯绘制工具时收起，避免挡住画布。
  assetsExpanded.value = tool === 'furniture' || tool === 'door' || tool === 'window'
  if (tool === 'door') activeOpeningPresetId.value = DOOR_PRESETS[0].id
  if (tool === 'window') activeOpeningPresetId.value = WINDOW_PRESETS[0].id
}

/** 在左侧素材面板里点选门窗款式。 */
function chooseOpeningPreset(preset: OpeningPreset) {
  activeTool.value = preset.kind
  activeOpeningPresetId.value = preset.id
  assetsExpanded.value = true
}

/** 给已经选中的门窗套用某个款式（改宽高/窗台，2D 符号随之上新）。 */
function applyOpeningPreset(preset: OpeningPreset) {
  if (!selectedOpening.value) return
  updateSelectedOpening({ width: preset.width, height: preset.height, sillHeight: preset.sillHeight })
}

function chooseMode(mode: '2d' | '3d') {
  // 2D→3D 保留当前选中对象，用于 3D 高亮联动；回到 2D 时画布会重新挂载，清空避免属性面板悬空。
  if (mode !== activeMode.value && mode === '2d') {
    selectedEntity.value = null
    multiFurnitureIds.value = []
  }
  if (mode === '3d' && plan.value) {
    const openEndpoints = findOpenWallEndpoints(plan.value.documentJson.walls)
    if (openEndpoints.length > 0) {
      ElMessage.warning(`墙体仍有 ${openEndpoints.length} 个未闭合端点，3D 将按当前墙体预览`)
    }
  }
  activeMode.value = mode
}

function onAssetDragStart(event: DragEvent, assetId: string) {
  chooseTool('furniture')
  event.dataTransfer?.setData('application/x-home-design-asset', assetId)
  event.dataTransfer?.setData('text/plain', assetId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function addAssetAtCenter(assetId: string) {
  chooseTool('select')
  canvas.value?.addFurnitureAtCenter(assetId)
}

function updateSelectedFurniture(patch: Partial<PlanDocument['furniture'][number]>) {
  if (!plan.value || !selectedFurniture.value) return
  recordHistory()
  const document = cloneReactive(plan.value.documentJson)
  const furniture = document.furniture.find((item) => item.id === selectedFurniture.value?.id)
  if (!furniture) return
  Object.assign(furniture, patch)
  plan.value.documentJson = document
}

function updateFurnitureNumber(field: 'width' | 'depth' | 'height' | 'rotation', value?: number) {
  if (value === undefined || Number.isNaN(value)) return
  updateSelectedFurniture({ [field]: field === 'rotation' ? ((value % 360) + 360) % 360 : value })
}

/** 家具 X/Y 精确输入：保持另一轴与其它属性不变。 */
function updateFurnitureAxis(axis: 'x' | 'y', value?: number) {
  if (!plan.value || !selectedFurniture.value || value === undefined || Number.isNaN(value)) return
  const clamped = Math.max(0, Math.min(10000, value))
  updateSelectedFurniture({ position: { ...selectedFurniture.value.position, [axis]: clamped } })
}

/** 墙体工具激活时的默认规格：直接影响之后每次绘制的新墙。 */
function updateWallDefault(key: 'thickness' | 'height', value?: number) {
  if (!plan.value || value === undefined || Number.isNaN(value)) return
  const settings = { ...plan.value.documentJson.settings }
  if (key === 'thickness') settings.defaultWallThickness = Math.max(5, Math.min(50, Math.round(value)))
  else settings.defaultWallHeight = Math.max(200, Math.min(500, Math.round(value)))
  const parsed = PlanDocumentSchema.safeParse({ ...plan.value.documentJson, settings })
  if (!parsed.success) {
    ElMessage.warning(parsed.error.issues[0]?.message ?? '墙体规格无效')
    return
  }
  recordHistory()
  plan.value.documentJson = parsed.data
}

/** 快速模板：在现有墙体右侧生成一个矩形房间（四面墙 + 房间多边形）。 */
function addRoomTemplate(name: string, width: number, depth: number) {
  if (!plan.value) return
  const document = cloneReactive(plan.value.documentJson)
  const xs = document.walls.flatMap((wall) => [wall.start.x, wall.end.x])
  const ys = document.walls.flatMap((wall) => [wall.start.y, wall.end.y])
  const rawX = xs.length ? Math.max(...xs) + 80 : 200
  const rawY = ys.length ? Math.min(...ys) : 200
  const x = Math.round(Math.max(0, Math.min(10000 - width, rawX)) / 10) * 10
  const y = Math.round(Math.max(0, Math.min(10000 - depth, rawY)) / 10) * 10
  const corners: Point2D[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ]
  for (let index = 0; index < corners.length; index += 1) {
    document.walls.push({
      id: crypto.randomUUID(),
      start: corners[index],
      end: corners[(index + 1) % corners.length],
      thickness: document.settings.defaultWallThickness,
      height: document.settings.defaultWallHeight,
    })
  }
  const roomId = crypto.randomUUID()
  document.rooms.push({
    id: roomId,
    name: `${name} ${width / 100}×${depth / 100}m`,
    polygon: corners,
  })
  recordHistory()
  plan.value.documentJson = document
  selectedEntity.value = { type: 'room', id: roomId }
  ElMessage.success(`已添加${name}模板`)
}

function onMultiSelection(ids: string[]) {
  multiFurnitureIds.value = ids
}

function selectedFurnitureForAlign() {
  const ids = new Set(multiFurnitureIds.value)
  return (plan.value?.documentJson.furniture ?? []).filter((item) => ids.has(item.id))
}

function applyFurniturePositions(next: Array<{ id: string; position: Point2D }>) {
  if (!plan.value || !next.length) return
  if (next.some((entry) => entry.position.x < 0 || entry.position.y < 0 || entry.position.x > 10000 || entry.position.y > 10000)) {
    ElMessage.warning('对齐/分布后超出绘图范围，请先移动到画布内部')
    return
  }
  recordHistory()
  const document = cloneReactive(plan.value.documentJson)
  for (const entry of next) {
    const furniture = document.furniture.find((item) => item.id === entry.id)
    if (furniture) furniture.position = entry.position
  }
  plan.value.documentJson = document
}

/** 多选家具对齐：左/右/顶/底/水平居中/垂直居中。 */
function alignSelectedFurniture(mode: AlignMode) {
  applyFurniturePositions(alignFurniture(selectedFurnitureForAlign(), mode))
}

/** 多选家具等间距分布。 */
function distributeSelectedFurniture(axis: 'x' | 'y') {
  applyFurniturePositions(distributeFurniture(selectedFurnitureForAlign(), axis))
}

function updateSelectedWall(patch: Partial<PlanDocument['walls'][number]>) {
  if (!plan.value || !selectedWall.value) return
  if (Object.values(patch).some((value) => value === undefined)) return
  const document = cloneReactive(plan.value.documentJson)
  const wall = document.walls.find((item) => item.id === selectedWall.value?.id)
  if (!wall) return
  const nextHeight = patch.height ?? wall.height
  if (
    document.openings.some((opening) => opening.wallId === wall.id && opening.sillHeight + opening.height > nextHeight)
  ) {
    ElMessage.warning('墙高不能低于现有门窗高度')
    return
  }
  recordHistory()
  Object.assign(wall, patch)
  plan.value.documentJson = document
}

/** 保留起点，按新的终点更新墙体；校验长度、坐标范围和门窗占用。 */
function applyWallEnd(rawEnd: Point2D) {
  if (!plan.value || !selectedWall.value) return
  const wall = selectedWall.value
  if (rawEnd.x < 0 || rawEnd.y < 0 || rawEnd.x > 10000 || rawEnd.y > 10000) {
    ElMessage.warning('超出绘图范围：坐标需在 0 到 10000 cm 之间')
    return
  }
  const length = Math.hypot(rawEnd.x - wall.start.x, rawEnd.y - wall.start.y)
  if (length < 10) {
    ElMessage.warning('墙体长度不能小于 10 cm')
    return
  }
  if (
    plan.value.documentJson.openings.some(
      (opening) => opening.wallId === wall.id && opening.offset + opening.width > length + 1e-6,
    )
  ) {
    ElMessage.warning('新长度会超出现有门窗范围，请先移动或删除门窗')
    return
  }
  updateSelectedWall({ end: { x: rawEnd.x, y: rawEnd.y } })
}

/** 墙体长度精确输入：沿当前角度从起点重算终点。 */
function updateWallLength(value?: number) {
  if (!plan.value || !selectedWall.value || value === undefined || Number.isNaN(value)) return
  applyWallEnd(wallFromLengthAngle(selectedWall.value.start, Math.max(10, value), selectedWallAngle.value))
}

/** 墙体角度精确输入：保持当前长度，从起点旋转。 */
function updateWallAngle(value?: number) {
  if (!plan.value || !selectedWall.value || value === undefined || Number.isNaN(value)) return
  const normalized = ((value % 360) + 360) % 360
  applyWallEnd(wallFromLengthAngle(selectedWall.value.start, selectedWallLength.value, normalized))
}

function updateSelectedOpening(patch: Partial<PlanDocument['openings'][number]>) {
  if (!plan.value || !selectedOpening.value) return
  if (Object.values(patch).some((value) => value === undefined)) return
  const document = cloneReactive(plan.value.documentJson)
  const opening = document.openings.find((item) => item.id === selectedOpening.value?.id)
  if (!opening) return
  const wall = document.walls.find((item) => item.id === opening.wallId)
  if (!wall) return
  const next = {
    ...opening,
    ...patch,
    sillHeight: opening.type === 'door' ? 0 : (patch.sillHeight ?? opening.sillHeight),
  }
  const wallLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  if (next.width > wallLength || next.offset + next.width > wallLength) {
    ElMessage.warning('门窗宽度不能超出墙体范围')
    return
  }
  if (next.sillHeight + next.height > wall.height) {
    ElMessage.warning('门窗高度不能超出墙高')
    return
  }
  if (
    document.openings.some(
      (item) =>
        item.id !== opening.id &&
        item.wallId === opening.wallId &&
        next.offset < item.offset + item.width &&
        next.offset + next.width > item.offset,
    )
  ) {
    ElMessage.warning('同一墙体上的门窗不能重叠')
    return
  }
  recordHistory()
  Object.assign(opening, next)
  plan.value.documentJson = document
}

async function renameSelectedRoom() {
  if (!plan.value || !selectedRoom.value) return
  const result = await ElMessageBox.prompt('输入房间名称', '重命名房间', {
    inputValue: selectedRoom.value.name,
    inputValidator: (value) => value.trim().length >= 1 && value.trim().length <= 64,
    inputErrorMessage: '房间名称需为 1–64 个字符',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).catch(() => null)
  if (!result) return
  recordHistory()
  const document = cloneReactive(plan.value.documentJson)
  const room = document.rooms.find((item) => item.id === selectedRoom.value?.id)
  if (room) room.name = result.value.trim()
  plan.value.documentJson = document
}

async function save() {
  if (!plan.value || saving.value) return
  const currentPlan = plan.value
  const snapshot = cloneReactive(currentPlan.documentJson)
  const serialized = JSON.stringify(snapshot)
  persistDraft()
  saving.value = true
  try {
    const saved = await savePlan(currentPlan.id, currentPlan.revision, snapshot)
    if (plan.value?.id !== currentPlan.id) return
    const changedDuringSave = JSON.stringify(plan.value.documentJson) !== serialized
    plan.value = { ...saved, documentJson: changedDuringSave ? plan.value.documentJson : saved.documentJson }
    dirty.value = changedDuringSave
    if (changedDuringSave) persistDraft()
    else clearDraft()
    ElMessage.success(
      changedDuringSave ? '已保存提交的版本，后续修改已保留为草稿' : `已保存，版本 ${plan.value.revision}`,
    )
  } catch {
    persistDraft()
  } finally {
    saving.value = false
  }
}

async function removePlan() {
  if (!plan.value || deleting.value) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除“${plan.value.name}”吗？删除后将从我的设计中移除。`,
    '删除设计',
    {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    },
  )
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  deleting.value = true
  try {
    await deletePlan(plan.value.id)
    dirty.value = false
    clearDraft()
    ElMessage.success('设计已删除')
    await router.push({ name: 'plans' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('visibilitychange', onVisibilityChange)
  loadBackground()
  void load()
  void assetCatalog.load()
})
onBeforeUnmount(() => {
  persistDraft()
  clearTimeout(draftTimer)
  window.removeEventListener('beforeunload', beforeUnload)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div v-loading="loading" class="shell">
    <header class="topbar editor-header">
      <el-button
        text
        :icon="ArrowLeft"
        class="back-button"
        aria-label="我的设计"
        @click="router.push({ name: 'plans' })"
        >我的设计</el-button
      >
      <div class="editor-title">
        <strong>{{ plan?.name ?? '加载中' }}</strong>
        <span v-if="plan">版本 {{ plan.revision }}{{ dirty ? ' · 未保存' : '' }}</span>
      </div>
      <div class="topbar-actions">
        <el-button type="primary" :icon="Check" :loading="saving" :disabled="!plan || !dirty" @click="save"
          >保存</el-button
        >
        <el-button
          plain
          type="danger"
          :icon="Delete"
          :loading="deleting"
          :disabled="!plan || saving"
          @click="removePlan"
          >删除</el-button
        >
        <ThemeToggle />
      </div>
    </header>
    <main class="workspace">
      <aside class="sidebar left-panel" :class="{ 'assets-expanded': assetsExpanded }">
        <div class="panel-heading">绘制空间</div>
        <div class="tool-grid">
          <button :class="['tool', { active: activeTool === 'select' }]" @click="chooseTool('select')">
            <DesignToolIcon tool="select" />选择
          </button>
          <button :class="['tool', { active: activeTool === 'wall' }]" @click="chooseTool('wall')">
            <DesignToolIcon tool="wall" />墙体
          </button>
          <button :class="['tool', { active: activeTool === 'door' }]" @click="chooseTool('door')">
            <DesignToolIcon tool="door" />门
          </button>
          <button :class="['tool', { active: activeTool === 'window' }]" @click="chooseTool('window')">
            <DesignToolIcon tool="window" />窗
          </button>
          <button :class="['tool', { active: activeTool === 'room' }]" @click="chooseTool('room')">
            <DesignToolIcon tool="room" />房间
          </button>
          <button :class="['tool', { active: activeTool === 'furniture' }]" @click="chooseTool('furniture')">
            <DesignToolIcon tool="furniture" />家具
          </button>
        </div>
        <div class="panel-divider" />
        <div class="panel-heading">快速模板</div>
        <div class="template-row">
          <button type="button" class="template-chip" @click="addRoomTemplate('卧室', 360, 420)">卧室 360×420</button>
          <button type="button" class="template-chip" @click="addRoomTemplate('客厅', 420, 540)">客厅 420×540</button>
          <button type="button" class="template-chip" @click="addRoomTemplate('卫生间', 200, 240)">卫生间 200×240</button>
        </div>
        <p class="tool-note">一键生成四面墙与房间，可继续拖动调整。</p>
        <div class="panel-heading">图层</div>
        <div class="template-row">
          <button
            v-for="item in layerItems"
            :key="item.key"
            type="button"
            class="template-chip"
            :class="{ active: layers[item.key] }"
            :aria-pressed="layers[item.key]"
            @click="toggleLayer(item.key)"
          >
            {{ item.label }} {{ layers[item.key] ? '显示' : '隐藏' }}
          </button>
        </div>
        <div class="panel-divider" />
        <button class="mobile-panel-toggle" :aria-expanded="assetsExpanded" @click="assetsExpanded = !assetsExpanded">
          {{ libraryTitle }} <span>{{ assetsExpanded ? '收起 −' : '展开 +' }}</span>
        </button>
        <div class="asset-library">
          <div class="panel-heading">{{ libraryTitle }}</div>

          <template v-if="activeTool === 'door' || activeTool === 'window'">
            <div class="opening-preset-grid">
              <button
                v-for="preset in activePresets"
                :key="preset.id"
                type="button"
                class="opening-preset"
                :class="{ active: preset.id === activeOpeningPresetId }"
                @click="chooseOpeningPreset(preset)"
              >
                <OpeningPreview :preset-id="preset.id" />
                <span>{{ preset.name }}</span>
                <small aria-hidden="true">{{ preset.width }} × {{ preset.height }} cm</small>
              </button>
            </div>
            <p class="tool-note">选好款式后，在墙体上点击放置。</p>
          </template>

          <template v-else-if="activeTool === 'furniture'">
            <div class="asset-grid">
              <button
                v-for="asset in visibleAssets"
                :key="asset.id"
                class="asset-placeholder"
                draggable="true"
                :title="`拖入画布添加${asset.name}`"
                @dblclick="addAssetAtCenter(asset.id)"
                @dragstart="onAssetDragStart($event, asset.id)"
              >
                <FurnitureThumb :name="asset.name" :color="asset.color" :icon-url="asset.iconUrl" />
                <span>{{ asset.name }}</span>
                <small aria-hidden="true">{{ asset.width }} × {{ asset.depth }} cm</small>
              </button>
            </div>
            <p class="tool-note">拖动素材到画布放置家具；也可以双击素材放到当前画布中心。</p>
          </template>

          <div v-else class="tool-guide">
            <strong>{{ toolGuide[0] }}</strong>
            <p>{{ toolGuide[1] }}</p>
          </div>
        </div>
      </aside>
      <section class="editor-area">
        <div class="editor-toolbar">
          <div class="mode-switch" role="tablist" aria-label="视图模式">
            <button :class="['mode-button', { selected: activeMode === '2d' }]" @click="chooseMode('2d')">
              2D 编辑
            </button>
            <button :class="['mode-button', { selected: activeMode === '3d' }]" @click="chooseMode('3d')">
              3D 预览
            </button>
          </div>
          <div class="toolbar-actions">
            <button
              class="magnet-toggle"
              :class="{ active: magnetEnabled }"
              type="button"
              :aria-pressed="magnetEnabled"
              :title="magnetEnabled ? '自动吸附已开启，点击关闭' : '自动吸附已关闭，点击开启'"
              @click="toggleMagnet"
            >
              <span class="magnet-dot" />磁吸 {{ magnetEnabled ? '开' : '关' }}
            </button>
            <button
              class="magnet-toggle"
              :class="{ active: showDimensions }"
              type="button"
              :aria-pressed="showDimensions"
              :title="showDimensions ? '尺寸标注已显示，点击隐藏' : '尺寸标注已隐藏，点击显示'"
              @click="toggleDimensions"
            >
              <span class="magnet-dot" />尺寸 {{ showDimensions ? '开' : '关' }}
            </button>
            <el-button text :icon="MagicStick" :disabled="activeMode !== '2d'" @click="openImportDialog"
              >识别户型图</el-button
            >
            <el-button text :icon="Picture" :disabled="activeMode !== '2d'" @click="triggerBackgroundImport"
              >导入底图</el-button
            >
            <el-button text :icon="Download" @click="exportPng">导出 PNG</el-button>
            <el-button text :icon="RefreshLeft" :disabled="undoStack.length === 0" aria-label="撤销" @click="undo"
              >撤销</el-button
            >
            <el-button text :icon="RefreshRight" :disabled="redoStack.length === 0" aria-label="重做" @click="redo"
              >重做</el-button
            >
            <input ref="bgInput" class="hidden-file" type="file" accept="image/png,image/jpeg" @change="onBackgroundFile" />
          </div>
        </div>
        <div class="canvas-stage" :class="{ preview: activeMode === '3d' }">
          <FloorplanCanvas
            v-if="activeMode === '2d' && plan"
            ref="canvas"
            :document="plan.documentJson"
            :background="background"
            :magnet="magnetEnabled"
            :show-dimensions="showDimensions"
            :layers="layers"
            :opening-preset="activeOpeningPreset"
            :tool="activeTool === 'furniture' ? 'select' : activeTool"
            @history="recordHistory"
            @redo="redo"
            @selection="selectedEntity = $event"
            @selection-multi="onMultiSelection"
            @undo="undo"
            @update:document="onDocumentUpdate"
          />
          <ThreePreview v-else-if="plan" ref="threePreview" :document="plan.documentJson" :selection="selectedEntity" />
          <div v-else class="preview-placeholder"><el-empty description="正在加载方案" /></div>
          <div v-if="selectionHud" class="canvas-hud">{{ selectionHud }}</div>
        </div>
      </section>
      <PlanImportDialog
        v-model="importDialogOpen"
        :assets="visibleAssets"
        @apply="onImportApply"
        @background-only="onImportBackgroundOnly"
      />
      <aside class="sidebar right-panel" :class="{ 'properties-expanded': propertiesExpanded }">
        <button
          class="mobile-panel-toggle"
          :aria-expanded="propertiesExpanded"
          @click="propertiesExpanded = !propertiesExpanded"
        >
          空间属性{{ selectedEntity ? ' · 已选中对象' : '' }}
          <span>{{ propertiesExpanded ? '收起 −' : '展开 +' }}</span>
        </button>
        <div class="properties-content">
          <div class="panel-heading">空间属性 <small>PROPERTIES</small></div>
          <div v-if="activeTool === 'wall' && plan && activeMode === '2d'" class="wall-defaults panel">
            <strong>墙体规格</strong>
            <label class="property-field">
              <span>默认墙厚</span>
              <el-input-number
                :model-value="plan.documentJson.settings.defaultWallThickness"
                :min="5"
                :max="50"
                :step="1"
                controls-position="right"
                @change="updateWallDefault('thickness', $event)"
              />
            </label>
            <label class="property-field">
              <span>默认墙高</span>
              <el-input-number
                :model-value="plan.documentJson.settings.defaultWallHeight"
                :min="200"
                :max="500"
                :step="10"
                controls-position="right"
                @change="updateWallDefault('height', $event)"
              />
            </label>
            <small>绘制时使用此规格，绘制后仍可单独调整。单位 cm。</small>
          </div>
          <div class="background-controls">
            <div class="background-head">
              <span>参考底图</span>
              <el-button text size="small" :disabled="activeMode !== '2d'" @click="triggerBackgroundImport">{{
                background ? '更换' : '导入 PNG'
              }}</el-button>
              <el-button v-if="background" text size="small" @click="clearBackground">清除</el-button>
            </div>
            <template v-if="background">
              <label class="property-field">
                <span>透明</span>
                <el-slider v-model="background.opacity" :min="0.1" :max="1" :step="0.05" size="small" />
              </label>
              <label class="property-field">
                <span>宽度</span>
                <el-input-number
                  :model-value="background.width"
                  :min="50"
                  :max="5000"
                  :step="50"
                  controls-position="right"
                  @change="resizeBackground"
                />
              </label>
              <label class="property-field">
                <span>X</span>
                <el-input-number
                  :model-value="background.x"
                  :min="-2000"
                  :max="10000"
                  :step="20"
                  controls-position="right"
                  @change="moveBackground('x', $event)"
                />
              </label>
              <label class="property-field">
                <span>Y</span>
                <el-input-number
                  :model-value="background.y"
                  :min="-2000"
                  :max="10000"
                  :step="20"
                  controls-position="right"
                  @change="moveBackground('y', $event)"
                />
              </label>
            </template>
            <p v-else class="tool-note">导入一张户型图/手绘图作为参考底图，调好透明度后在上面描墙。</p>
          </div>
          <div v-if="plan" class="properties-summary">
            <strong>2D 编辑数据</strong>
            <span
              >{{ plan.documentJson.walls.length }} 面墙 · {{ plan.documentJson.openings.length }} 个门窗 ·
              {{ plan.documentJson.rooms.length }} 个房间 · {{ plan.documentJson.furniture.length }} 件家具</span
            >
            <div v-if="multiFurnitureIds.length >= 2" class="opening-styles panel multi-align">
              <small>Shift 多选 · {{ multiFurnitureIds.length }} 件家具</small>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('left')">左对齐</button>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('center-x')">水平居中</button>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('right')">右对齐</button>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('top')">顶对齐</button>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('center-y')">垂直居中</button>
              <button type="button" class="opening-chip" @click="alignSelectedFurniture('bottom')">底对齐</button>
              <button
                type="button"
                class="opening-chip"
                :disabled="multiFurnitureIds.length < 3"
                @click="distributeSelectedFurniture('x')"
              >
                水平等距
              </button>
              <button
                type="button"
                class="opening-chip"
                :disabled="multiFurnitureIds.length < 3"
                @click="distributeSelectedFurniture('y')"
              >
                垂直等距
              </button>
            </div>
            <template v-if="selectedRoom">
              <small>{{ selectedRoom.name }} · {{ (polygonArea(selectedRoom.polygon) / 10000).toFixed(2) }} m²</small>
              <el-button plain @click="renameSelectedRoom">重命名房间</el-button>
            </template>
            <template v-else-if="selectedWall">
              <small
                >墙体长度
                {{
                  Math.round(
                    Math.hypot(selectedWall.end.x - selectedWall.start.x, selectedWall.end.y - selectedWall.start.y),
                  )
                }}
                cm</small
              >
              <label class="property-field">
                <span>墙厚</span>
                <el-input-number
                  :model-value="selectedWall.thickness"
                  :min="5"
                  :max="50"
                  :step="5"
                  controls-position="right"
                  @change="updateSelectedWall({ thickness: $event ?? undefined })"
                />
              </label>
              <label class="property-field">
                <span>墙高</span>
                <el-input-number
                  :model-value="selectedWall.height"
                  :min="200"
                  :max="500"
                  :step="10"
                  controls-position="right"
                  @change="updateSelectedWall({ height: $event ?? undefined })"
                />
              </label>
              <label class="property-field">
                <span>长度</span>
                <el-input-number
                  :model-value="Math.round(selectedWallLength)"
                  :min="10"
                  :max="20000"
                  :step="10"
                  controls-position="right"
                  @change="updateWallLength"
                />
              </label>
              <label class="property-field">
                <span>角度</span>
                <el-input-number
                  :model-value="Math.round(selectedWallAngle)"
                  :min="0"
                  :max="359"
                  :step="15"
                  controls-position="right"
                  @change="updateWallAngle"
                />
              </label>
              <p class="tool-note">墙高是竖向尺寸，2D 平面里看不出来；切到「3D 预览」查看效果。</p>
            </template>
            <template v-else-if="selectedOpening">
              <small
                >{{ selectedOpening.type === 'door' ? '门' : '窗' }} · 沿墙偏移
                {{ Math.round(selectedOpening.offset) }} cm</small
              >
              <div class="opening-styles panel">
                <button
                  v-for="preset in presetsFor(selectedOpening.type === 'window' ? 'window' : 'door')"
                  :key="preset.id"
                  type="button"
                  class="opening-chip"
                  :class="{ active: openingStyleKey(selectedOpening) === preset.id }"
                  @click="applyOpeningPreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>
              <label class="property-field">
                <span>宽度</span>
                <el-input-number
                  :model-value="selectedOpening.width"
                  :min="20"
                  :max="500"
                  :step="10"
                  controls-position="right"
                  @change="updateSelectedOpening({ width: $event ?? undefined })"
                />
              </label>
              <label class="property-field">
                <span>高度</span>
                <el-input-number
                  :model-value="selectedOpening.height"
                  :min="20"
                  :max="500"
                  :step="10"
                  controls-position="right"
                  @change="updateSelectedOpening({ height: $event ?? undefined })"
                />
              </label>
              <label v-if="selectedOpening.type === 'window'" class="property-field">
                <span>窗台</span>
                <el-input-number
                  :model-value="selectedOpening.sillHeight"
                  :min="0"
                  :max="500"
                  :step="10"
                  controls-position="right"
                  @change="updateSelectedOpening({ sillHeight: $event ?? undefined })"
                />
              </label>
              <p class="tool-note">门窗高度是竖向尺寸，2D 平面里看不出来；切到「3D 预览」查看效果。</p>
            </template>
            <template v-else-if="selectedFurniture">
              <!-- 按需求对调：深度框控制 height、高度框控制 depth -->
              <small
                >{{ selectedFurnitureAsset?.name ?? '家具' }} · {{ selectedFurniture.width }} ×
                {{ selectedFurniture.height }} × {{ selectedFurniture.depth }} cm</small
              >
              <label class="property-field">
                <span>X</span>
                <el-input-number
                  :model-value="Math.round(selectedFurniture.position.x)"
                  :min="0"
                  :max="10000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureAxis('x', $event)"
                />
              </label>
              <label class="property-field">
                <span>Y</span>
                <el-input-number
                  :model-value="Math.round(selectedFurniture.position.y)"
                  :min="0"
                  :max="10000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureAxis('y', $event)"
                />
              </label>
              <label class="property-field">
                <span>宽度</span>
                <el-input-number
                  :model-value="selectedFurniture.width"
                  :min="1"
                  :max="2000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureNumber('width', $event)"
                />
              </label>
              <label class="property-field">
                <span>深度</span>
                <el-input-number
                  :model-value="selectedFurniture.height"
                  :min="1"
                  :max="2000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureNumber('height', $event)"
                />
              </label>
              <label class="property-field">
                <span>高度</span>
                <el-input-number
                  :model-value="selectedFurniture.depth"
                  :min="1"
                  :max="2000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureNumber('depth', $event)"
                />
              </label>
              <label class="property-field">
                <span>旋转</span>
                <el-input-number
                  :model-value="selectedFurniture.rotation"
                  :min="0"
                  :max="359"
                  :step="15"
                  controls-position="right"
                  @change="updateFurnitureNumber('rotation', $event)"
                />
              </label>
              <el-checkbox
                :model-value="selectedFurniture.locked"
                @change="updateSelectedFurniture({ locked: Boolean($event) })"
                >锁定家具</el-checkbox
              >
              <p class="tool-note">高度是竖向尺寸，2D 俯视图中看不出来；切到「3D 预览」即可看到变化。</p>
            </template>
            <div v-else class="tool-guide">
              <strong>{{ toolGuide[0] }}</strong>
              <p>{{ toolGuide[1] }}</p>
              <div class="endpoint-legend"><i class="open-endpoint" />橙色小点：墙体尚未连接</div>
              <div class="endpoint-legend"><i class="edit-endpoint" />绿色手柄：选中后可拖动</div>
              <p class="guide-shortcuts">滚轮缩放 · 空格拖动画布<br />迷路时点击左下角“定位设计”</p>
            </div>
            <el-button plain type="danger" :icon="Delete" :disabled="!selectedEntity" @click="canvas?.deleteSelected()"
              >删除选中对象</el-button
            >
            <el-button plain :icon="DocumentCopy" :disabled="!selectedEntity" @click="canvas?.duplicateSelected()"
              >复制选中对象</el-button
            >
          </div>
          <div v-else class="empty-properties"><strong>正在加载方案</strong></div>
          <div class="panel-divider" />
          <div v-if="plan" class="status-card">
            <span>方案状态</span><strong class="ok">已加载</strong
            ><small>版本 {{ plan.revision }} · {{ dirty ? '有未保存修改' : '已同步' }}</small>
            <small v-if="draftStatus" role="status">{{ draftStatus }}</small>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>
