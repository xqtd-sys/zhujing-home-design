<script setup lang="ts">
import { ArrowLeft, Check, Delete, RefreshLeft, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { polygonArea, type PlanDocument } from '@home-design/plan-schema'
import FloorplanCanvas from '../components/FloorplanCanvas.vue'
import DesignToolIcon from '../components/DesignToolIcon.vue'
import FurniturePreview from '../components/FurniturePreview.vue'
import { cloneReactive } from '../editor/clone'
import { draftKey, readDraft, type PlanDraft } from '../editor/drafts'
import { findOpenWallEndpoints } from '../editor/geometry'
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
const selectedEntity = ref<{ type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null>(null)
const undoStack = ref<PlanDocument[]>([])
const redoStack = ref<PlanDocument[]>([])
const dirty = ref(false)
const draftStatus = ref('')
let draftTimer: ReturnType<typeof setTimeout> | undefined
const selectedCategoryId = ref('')
const assetsExpanded = ref(false)
const propertiesExpanded = ref(false)
const toolGuide = computed(
  () =>
    ({
      select: ['选择与调整', '点击墙体、门窗或家具查看尺寸。选中墙体后，拖动绿色手柄调整端点。'],
      wall: ['画出空间轮廓', '按住左键拖动绘制墙体，松开完成。按住 Shift 锁定水平或垂直，右键取消本次绘制。'],
      door: ['在墙上放门', '点击墙体放置门，默认宽 90 cm、高 210 cm。放置后可在属性面板调整尺寸。'],
      window: ['在墙上放窗', '点击墙体放置窗，默认宽 120 cm、窗高 120 cm、窗台 90 cm。避免与其他门窗重叠。'],
      room: ['标注房间边界', '依次点击房间各个角，最后点击第一个点闭合。右键或 Esc 取消未完成的边界。'],
      furniture: ['摆放家具', '展开家具素材，拖入画布，或双击素材放到画布中央。选中后可调整尺寸和旋转角度。'],
    })[activeTool.value],
)
const planId = computed(() => String(route.params.id))
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
const visibleAssets = computed(() =>
  selectedCategoryId.value
    ? assetCatalog.items.filter((asset) => asset.categoryId === selectedCategoryId.value)
    : assetCatalog.items,
)

async function load() {
  loading.value = true
  clearTimeout(draftTimer)
  dirty.value = false
  draftStatus.value = ''
  selectedEntity.value = null
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
  if (tool === 'furniture') assetsExpanded.value = true
}

function chooseMode(mode: '2d' | '3d') {
  if (mode !== activeMode.value) selectedEntity.value = null
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
        <button class="mobile-panel-toggle" :aria-expanded="assetsExpanded" @click="assetsExpanded = !assetsExpanded">
          家具素材 <span>{{ assetsExpanded ? '收起 −' : '展开 +' }}</span>
        </button>
        <div class="asset-library">
          <div class="panel-heading">家具素材</div>
          <el-select
            v-model="selectedCategoryId"
            class="asset-filter"
            size="small"
            clearable
            placeholder="全部分类"
            :loading="assetCatalog.loading"
          >
            <el-option
              v-for="category in assetCatalog.categories"
              :key="category.id"
              :label="category.name"
              :value="category.id"
            />
          </el-select>
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
              <FurniturePreview :name="asset.name" :color="asset.color" />
              <span>{{ asset.name }}</span>
              <small aria-hidden="true">{{ asset.width }} × {{ asset.depth }} cm</small>
            </button>
          </div>
          <p class="tool-note">拖动素材到画布放置家具；也可以双击素材放到当前画布中心。</p>
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
            <el-button text :icon="RefreshLeft" :disabled="undoStack.length === 0" aria-label="撤销" @click="undo"
              >撤销</el-button
            >
            <el-button text :icon="RefreshRight" :disabled="redoStack.length === 0" aria-label="重做" @click="redo"
              >重做</el-button
            >
          </div>
        </div>
        <div class="canvas-stage" :class="{ preview: activeMode === '3d' }">
          <FloorplanCanvas
            v-if="activeMode === '2d' && plan"
            ref="canvas"
            :document="plan.documentJson"
            :tool="activeTool === 'furniture' ? 'select' : activeTool"
            @history="recordHistory"
            @redo="redo"
            @selection="selectedEntity = $event"
            @undo="undo"
            @update:document="onDocumentUpdate"
          />
          <ThreePreview v-else-if="plan" :document="plan.documentJson" />
          <div v-else class="preview-placeholder"><el-empty description="正在加载方案" /></div>
        </div>
      </section>
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
          <div v-if="plan" class="properties-summary">
            <strong>2D 编辑数据</strong>
            <span
              >{{ plan.documentJson.walls.length }} 面墙 · {{ plan.documentJson.openings.length }} 个门窗 ·
              {{ plan.documentJson.rooms.length }} 个房间 · {{ plan.documentJson.furniture.length }} 件家具</span
            >
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
            </template>
            <template v-else-if="selectedOpening">
              <small
                >{{ selectedOpening.type === 'door' ? '门' : '窗' }} · 沿墙偏移
                {{ Math.round(selectedOpening.offset) }} cm</small
              >
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
            </template>
            <template v-else-if="selectedFurniture">
              <small>{{ selectedFurnitureAsset?.name ?? '家具' }}</small>
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
                  :model-value="selectedFurniture.depth"
                  :min="1"
                  :max="2000"
                  :step="10"
                  controls-position="right"
                  @change="updateFurnitureNumber('depth', $event)"
                />
              </label>
              <label class="property-field">
                <span>高度</span>
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
