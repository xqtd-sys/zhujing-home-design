<script setup lang="ts">
import {
  PlanDocumentSchema,
  polygonArea,
  polygonSelfIntersects,
  type PlanDocument,
  type Point2D,
} from '@home-design/plan-schema'
import { ElMessage } from 'element-plus'
import { Aim, Location } from '@element-plus/icons-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAssetsStore } from '../stores/assets'
import {
  axisRulerTicks,
  clampLogicalPoint,
  clampViewportToNonNegative,
  distance,
  findOpenWallEndpoints,
  fitDocumentViewport,
  MIN_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  pointOnSegment,
  projectPointToSegment,
  rulerStepForZoom,
  screenToLogical,
  segmentLength,
  snapToGrid,
  snapWallDrawPoint,
  snapOrthogonalPoint,
  resolvePointSnap,
  resolveAxisSnap,
  wallMidpoint,
  openingAnchorPoints,
  pointInPolygonInclusive,
  rectFromPoints,
  rectsOverlap,
  segmentIntersectsRect,
  polygonIntersectsRect,
  furnitureBox,
  segmentAngleDegrees,
  snapAngleStep,
  SNAP_PRIORITY,
  type Rect,
  type SnapKind,
  type SnapAnchor,
  type AxisAnchor,
  type PointSnapResult,
  type Viewport,
} from '../editor/geometry'
import { cloneReactive } from '../editor/clone'
import { openingStyleKey, type OpeningPreset } from '../editor/opening-presets'

type CanvasBackground = { src: string; x: number; y: number; width: number; height: number; opacity: number }

const props = defineProps<{
  document: PlanDocument
  tool: 'select' | 'wall' | 'door' | 'window' | 'room'
  background?: CanvasBackground | null
  magnet?: boolean
  showDimensions?: boolean
  layers?: { walls: boolean; rooms: boolean; openings: boolean; furniture: boolean }
  openingPreset?: OpeningPreset | null
}>()
const assets = useAssetsStore()
const emit = defineEmits<{
  'update:document': [document: PlanDocument]
  history: []
  selection: [selection: { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null]
  'selection-multi': [ids: string[]]
  undo: []
  redo: []
}>()

const host = ref<HTMLElement | null>(null)
const stage = ref<any>(null)
const width = ref(800)
const height = ref(600)
const viewport = ref<Viewport>({ x: 80, y: 80, zoom: 1 })
const tool = computed(() => props.tool)
/** 图层显隐：未传时默认全部可见。 */
const layerVisible = computed(() => ({ walls: true, rooms: true, openings: true, furniture: true, ...props.layers }))
const selectedWallId = ref<string | null>(null)
const selectedOpeningId = ref<string | null>(null)
const selectedRoomId = ref<string | null>(null)
const selectedFurnitureId = ref<string | null>(null)
/** 多选家具集合（Shift+点击切换）；单选时也包含当前家具。 */
const selectedFurnitureIds = ref<string[]>([])
/** 框选出来的“整片区域”：矩形范围内命中的墙/门窗/房间/家具。 */
type AreaSelection = { wallIds: string[]; openingIds: string[]; roomIds: string[]; furnitureIds: string[] }
const areaSelection = ref<AreaSelection | null>(null)
/** 拖动整片区域时的实时偏移，仅用于预览，松手才写入文档。 */
const areaDragOffset = ref<Point2D>({ x: 0, y: 0 })
/** 框选矩形：按下位置与当前拖动位置（逻辑坐标）；选中后保留，作为可拖动的选框。 */
const marquee = ref<{ start: Point2D; end: Point2D } | null>(null)
const marqueeRect = computed<Rect | null>(() => {
  const box = marquee.value
  if (!box) return null
  const rect = rectFromPoints(box.start, box.end)
  return { ...rect, maxX: Math.max(rect.maxX, rect.minX + 0.01), maxY: Math.max(rect.maxY, rect.minY + 0.01) }
})
const drawingStart = ref<Point2D | null>(null)
const drawingPoint = ref<Point2D | null>(null)
const roomDraftPoints = ref<Point2D[]>([])
const roomHoverPoint = ref<Point2D | null>(null)
const isPanning = ref(false)
const panStart = ref<Point2D | null>(null)
const panOrigin = ref<Point2D | null>(null)
const spacePressed = ref(false)
const shiftPressed = ref(false)
const canDragObjects = computed(() => tool.value === 'select' && !spacePressed.value && !isPanning.value)
const backgroundEl = ref<HTMLImageElement | null>(null)

watch(
  () => props.background?.src,
  (src) => {
    if (!src) {
      backgroundEl.value = null
      return
    }
    const image = new Image()
    image.onload = () => {
      backgroundEl.value = image
    }
    image.src = src
  },
  { immediate: true },
)
let resizeObserver: ResizeObserver | undefined
/** pointermove 高频触发，用一帧合并一次预览/吸附计算。 */
let previewFrame = 0

const stageConfig = computed(() => ({ width: width.value, height: height.value }))
const worldConfig = computed(() => ({
  x: viewport.value.x,
  y: viewport.value.y,
  scaleX: viewport.value.zoom,
  scaleY: viewport.value.zoom,
}))
const gridLines = computed(() => {
  const baseGrid = props.document.settings.gridSize
  const grid = baseGrid * Math.max(1, Math.ceil(10 / (baseGrid * viewport.value.zoom)))
  const lines: Array<{ points: number[]; major: boolean }> = []
  const left = Math.max(0, Math.floor(-viewport.value.x / viewport.value.zoom / grid) * grid - grid)
  const right = Math.ceil((width.value - viewport.value.x) / viewport.value.zoom / grid) * grid + grid
  const top = Math.max(0, Math.floor(-viewport.value.y / viewport.value.zoom / grid) * grid - grid)
  const bottom = Math.ceil((height.value - viewport.value.y) / viewport.value.zoom / grid) * grid + grid
  for (let x = left; x <= right; x += grid)
    lines.push({ points: [x, top, x, bottom], major: Math.abs((x / grid) % 5) < 1e-6 })
  for (let y = top; y <= bottom; y += grid)
    lines.push({ points: [left, y, right, y], major: Math.abs((y / grid) % 5) < 1e-6 })
  return lines
})
const rulerStep = computed(() => rulerStepForZoom(viewport.value.zoom))
const horizontalRulerTicks = computed(() =>
  axisRulerTicks(width.value, viewport.value.x, viewport.value.zoom, rulerStep.value).filter(
    (tick) => tick.value >= 0 && tick.screen >= 44,
  ),
)
const verticalRulerTicks = computed(() =>
  axisRulerTicks(height.value, viewport.value.y, viewport.value.zoom, rulerStep.value).filter(
    (tick) => tick.value >= 0 && tick.screen >= 28,
  ),
)
const openWallEndpoints = computed(() => findOpenWallEndpoints(props.document.walls))

const selectedWall = computed(() => props.document.walls.find((wall) => wall.id === selectedWallId.value) ?? null)
const selectedOpening = computed(
  () => props.document.openings.find((opening) => opening.id === selectedOpeningId.value) ?? null,
)
const selectedRoom = computed(() => props.document.rooms.find((room) => room.id === selectedRoomId.value) ?? null)

function isAreaWall(id: string) {
  return areaSelection.value?.wallIds.includes(id) ?? false
}

function isAreaOpening(id: string) {
  return areaSelection.value?.openingIds.includes(id) ?? false
}

function isAreaRoom(id: string) {
  return areaSelection.value?.roomIds.includes(id) ?? false
}

function isAreaFurniture(id: string) {
  return areaSelection.value?.furnitureIds.includes(id) ?? false
}

/** 拖动整片区域时的墙体预览（不写文档）。 */
const displayWalls = computed(() => {
  const { x: dx, y: dy } = areaDragOffset.value
  if (!dx && !dy) return props.document.walls
  return props.document.walls.map((wall) =>
    isAreaWall(wall.id)
      ? { ...wall, start: { x: wall.start.x + dx, y: wall.start.y + dy }, end: { x: wall.end.x + dx, y: wall.end.y + dy } }
      : wall,
  )
})

/** 拖动整片区域时的房间预览（房间线本身由 Konva 拖动，这里只用于文字和顶点）。 */
const displayRooms = computed(() => {
  const { x: dx, y: dy } = areaDragOffset.value
  if (!dx && !dy) return props.document.rooms
  return props.document.rooms.map((room) =>
    isAreaRoom(room.id) ? { ...room, polygon: room.polygon.map((point) => ({ x: point.x + dx, y: point.y + dy })) } : room,
  )
})

const sortedFurniture = computed(() => {
  const { x: dx, y: dy } = areaDragOffset.value
  const items = props.document.furniture.map((furniture) =>
    isAreaFurniture(furniture.id) && (dx || dy) ? { ...furniture, position: { x: furniture.position.x + dx, y: furniture.position.y + dy } } : furniture,
  )
  return items.sort((a, b) => a.zIndex - b.zIndex)
})

/** 区域整体平移时的可移动范围，保证家具/墙体不会越出 0–10000 的绘图坐标。 */
const areaBounds = computed(() => {
  const selection = areaSelection.value
  if (!selection) return null
  const xs: number[] = []
  const ys: number[] = []
  props.document.rooms
    .filter((room) => isAreaRoom(room.id))
    .forEach((room) => {
      room.polygon.forEach((point) => {
        xs.push(point.x)
        ys.push(point.y)
      })
    })
  props.document.walls
    .filter((wall) => isAreaWall(wall.id))
    .forEach((wall) => {
      xs.push(wall.start.x, wall.end.x)
      ys.push(wall.start.y, wall.end.y)
    })
  props.document.furniture
    .filter((item) => isAreaFurniture(item.id))
    .forEach((item) => {
      xs.push(item.position.x - item.width / 2, item.position.x + item.width / 2)
      ys.push(item.position.y - item.depth / 2, item.position.y + item.depth / 2)
    })
  if (!xs.length || !ys.length) return null
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
})
const selectedFurniture = computed(
  () => props.document.furniture.find((furniture) => furniture.id === selectedFurnitureId.value) ?? null,
)

/** 拖拽时的对齐参考线（逻辑坐标）。 */
const guides = ref<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
const lastGuidePosition = ref<Point2D | null>(null)
const lastResizePoint = ref<Point2D | null>(null)
/** 旋转拖拽过程中吸附后的角度（dragend 用于提交）。 */
const lastRotateAngle = ref<number | null>(null)
/** 当前吸附到的目标标记（类型化）与简短提示文案。 */
const snapHint = ref<{ point: Point2D; kind: SnapKind } | null>(null)
const snapLabel = ref<{ point: Point2D; text: string } | null>(null)
/** 吸附滞后状态：记住当前锁定的锚点 id，只有超出释放阈值才脱离。 */
const snapState = ref<{ pointId: string | null; xId: string | null; yId: string | null }>({
  pointId: null,
  xId: null,
  yId: null,
})
/** 整面墙拖动时的吸附位移，dragend 用它提交。 */
const lastWallDrag = ref<{ id: string; dx: number; dy: number } | null>(null)
/**
 * 一次拖拽/绘制手势内的吸附候选缓存：文档在手势结束前不会变化，
 * 因此只在开始时构建一次，避免每帧重复生成墙/房间/门窗/家具锚点。
 */
const gestureAnchors = ref<{ point: SnapAnchor[]; axis: AxisAnchor[] } | null>(null)

function cacheGestureAnchors(
  pointOptions: {
    excludeWallId?: string
    excludeEndpoint?: 'start' | 'end'
    excludeFurnitureId?: string
    includeFurniture?: boolean
  } = {},
  axisOptions: { excludeFurnitureId?: string; excludeWallId?: string } = {},
) {
  gestureAnchors.value = {
    point: buildPointAnchors(pointOptions),
    axis: buildAxisAnchors(axisOptions),
  }
}

function resetSnapState() {
  snapState.value = { pointId: null, xId: null, yId: null }
  snapHint.value = null
  snapLabel.value = null
  guides.value = { vertical: [], horizontal: [] }
  gestureAnchors.value = null
}

/** 当前可见的世界坐标范围，用来把参考线画满画布。 */
const visibleWorld = computed(() => ({
  left: -viewport.value.x / viewport.value.zoom,
  top: -viewport.value.y / viewport.value.zoom,
  right: (width.value - viewport.value.x) / viewport.value.zoom,
  bottom: (height.value - viewport.value.y) / viewport.value.zoom,
}))

/** 画墙过程中实时给出长度与角度提示（对应文档"距离/角度提示"）。 */
const drawingInfo = computed(() => {
  const start = drawingStart.value
  const point = drawingPoint.value
  if (!start || !point) return null
  const length = distance(start, point)
  if (length < 1) return null
  return { length: Math.round(length), angle: Math.round(segmentAngleDegrees({ start, end: point })) }
})

function rotateVector(x: number, y: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function furnitureCorner(
  furniture: PlanDocument['furniture'][number],
  sx: number,
  sy: number,
): Point2D {
  const offset = rotateVector((sx * furniture.width) / 2, (sy * furniture.depth) / 2, furniture.rotation)
  return { x: furniture.position.x + offset.x, y: furniture.position.y + offset.y }
}

function furnitureBounds(furniture: PlanDocument['furniture'][number]) {
  const points = [
    furnitureCorner(furniture, -1, -1),
    furnitureCorner(furniture, 1, -1),
    furnitureCorner(furniture, 1, 1),
    furnitureCorner(furniture, -1, 1),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

/** 两条线段（墙）的交点；平行或不相交返回 null。 */
function segmentIntersection(
  a: { start: Point2D; end: Point2D },
  b: { start: Point2D; end: Point2D },
): Point2D | null {
  const rx = a.end.x - a.start.x
  const ry = a.end.y - a.start.y
  const sx = b.end.x - b.start.x
  const sy = b.end.y - b.start.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((b.start.x - a.start.x) * sy - (b.start.y - a.start.y) * sx) / denominator
  const u = ((b.start.x - a.start.x) * ry - (b.start.y - a.start.y) * rx) / denominator
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return { x: a.start.x + t * rx, y: a.start.y + t * ry }
}

/** 构建点/线吸附锚点：墙体端点/中点/交点、房间角点、门窗中心/边缘、墙体中线，可选家具锚点。 */
function buildPointAnchors(options: {
  excludeWallId?: string
  excludeEndpoint?: 'start' | 'end'
  excludeFurnitureId?: string
  includeFurniture?: boolean
} = {}): SnapAnchor[] {
  const anchors: SnapAnchor[] = []
  const walls = props.document.walls
  for (const wall of walls) {
    for (const key of ['start', 'end'] as const) {
      if (wall.id === options.excludeWallId && options.excludeEndpoint === key) continue
      anchors.push({ id: `wall-vertex:${wall.id}:${key}`, kind: 'wall-vertex', label: '墙角', point: wall[key], sourceId: wall.id })
    }
    if (wall.id !== options.excludeWallId) {
      anchors.push({
        id: `wall-midpoint:${wall.id}`,
        kind: 'wall-midpoint',
        label: '墙中点',
        point: wallMidpoint(wall),
        sourceId: wall.id,
      })
    }
  }
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const point = segmentIntersection(walls[i], walls[j])
      if (point) {
        anchors.push({
          id: `wall-intersection:${walls[i].id}:${walls[j].id}`,
          kind: 'wall-intersection',
          label: '墙体交点',
          point,
        })
      }
    }
  }
  for (const wall of walls) {
    if (wall.id === options.excludeWallId) continue
    anchors.push({
      id: `wall-line:${wall.id}`,
      kind: 'wall-line',
      label: '墙体',
      segment: { start: wall.start, end: wall.end },
      sourceId: wall.id,
    })
  }
  for (const opening of props.document.openings) {
    if (opening.wallId === options.excludeWallId) continue
    const wall = walls.find((item) => item.id === opening.wallId)
    if (!wall) continue
    const points = openingAnchorPoints(wall, opening)
    anchors.push({
      id: `opening-center:${opening.id}`,
      kind: 'opening-center',
      label: '门窗中心',
      point: points.center,
      sourceId: opening.id,
    })
    anchors.push({
      id: `opening-edge:${opening.id}:start`,
      kind: 'opening-edge',
      label: '门窗边缘',
      point: points.start,
      sourceId: opening.id,
    })
    anchors.push({
      id: `opening-edge:${opening.id}:end`,
      kind: 'opening-edge',
      label: '门窗边缘',
      point: points.end,
      sourceId: opening.id,
    })
  }
  for (const room of props.document.rooms) {
    room.polygon.forEach((point, index) => {
      anchors.push({ id: `room-corner:${room.id}:${index}`, kind: 'room-corner', label: '房间角点', point, sourceId: room.id })
    })
  }
  if (options.includeFurniture) {
    for (const item of props.document.furniture) {
      if (item.id === options.excludeFurnitureId) continue
      const corners = [
        furnitureCorner(item, -1, -1),
        furnitureCorner(item, 1, -1),
        furnitureCorner(item, 1, 1),
        furnitureCorner(item, -1, 1),
      ]
      corners.forEach((point, index) => {
        anchors.push({ id: `furniture-corner:${item.id}:${index}`, kind: 'furniture-corner', label: '家具角点', point, sourceId: item.id })
      })
      anchors.push({
        id: `furniture-center:${item.id}`,
        kind: 'furniture-center',
        label: '家具中心',
        point: item.position,
        sourceId: item.id,
      })
      for (let index = 0; index < corners.length; index += 1) {
        const a = corners[index]
        const b = corners[(index + 1) % corners.length]
        anchors.push({
          id: `furniture-edge-mid:${item.id}:${index}`,
          kind: 'furniture-edge-mid',
          label: '边中点',
          point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          sourceId: item.id,
        })
      }
    }
  }
  return anchors
}

/** 构建水平/垂直对齐线锚点（家具拖动用）：墙体、房间角点与家具边缘/中线。 */
function buildAxisAnchors(options: { excludeFurnitureId?: string; excludeWallId?: string } = {}): AxisAnchor[] {
  const anchors: AxisAnchor[] = []
  const add = (axis: 'x' | 'y', value: number, kind: SnapKind, sourceId: string, label: string) => {
    anchors.push({ id: `${axis}:${kind}:${sourceId}:${Number(value.toFixed(3))}`, axis, value, kind, label, sourceId, priority: SNAP_PRIORITY[kind] })
  }
  for (const wall of props.document.walls) {
    if (wall.id === options.excludeWallId) continue
    add('x', wall.start.x, 'wall-vertex', wall.id, '墙端对齐')
    add('x', wall.end.x, 'wall-vertex', wall.id, '墙端对齐')
    add('x', (wall.start.x + wall.end.x) / 2, 'wall-midpoint', wall.id, '墙中点')
    add('y', wall.start.y, 'wall-vertex', wall.id, '墙端对齐')
    add('y', wall.end.y, 'wall-vertex', wall.id, '墙端对齐')
    add('y', (wall.start.y + wall.end.y) / 2, 'wall-midpoint', wall.id, '墙中点')
  }
  for (const opening of props.document.openings) {
    if (opening.wallId === options.excludeWallId) continue
    const wall = props.document.walls.find((item) => item.id === opening.wallId)
    if (!wall) continue
    const points = openingAnchorPoints(wall, opening)
    add('x', points.center.x, 'opening-center', opening.id, '门窗中心')
    add('y', points.center.y, 'opening-center', opening.id, '门窗中心')
    add('x', points.start.x, 'opening-edge', opening.id, '门窗边缘')
    add('x', points.end.x, 'opening-edge', opening.id, '门窗边缘')
    add('y', points.start.y, 'opening-edge', opening.id, '门窗边缘')
    add('y', points.end.y, 'opening-edge', opening.id, '门窗边缘')
  }
  for (const room of props.document.rooms) {
    for (const point of room.polygon) {
      add('x', point.x, 'room-corner', room.id, '房间角点')
      add('y', point.y, 'room-corner', room.id, '房间角点')
    }
  }
  for (const item of props.document.furniture) {
    if (item.id === options.excludeFurnitureId) continue
    const box = furnitureBounds(item)
    add('x', box.left, 'furniture-corner', item.id, '左对齐')
    add('x', (box.left + box.right) / 2, 'furniture-center', item.id, '中心对齐')
    add('x', box.right, 'furniture-corner', item.id, '右对齐')
    add('y', box.top, 'furniture-corner', item.id, '上对齐')
    add('y', (box.top + box.bottom) / 2, 'furniture-center', item.id, '中对齐')
    add('y', box.bottom, 'furniture-corner', item.id, '下对齐')
  }
  return anchors
}

/** 四角缩放手柄的位置（世界坐标，随家具旋转）。 */
const resizeHandles = computed(() => {
  const furniture = selectedFurniture.value
  if (!furniture || furniture.locked || selectedFurnitureIds.value.length > 1) return []
  return ([-1, 1] as const).flatMap((sx) =>
    ([-1, 1] as const).map((sy) => ({
      key: `${sx}:${sy}`,
      sx,
      sy,
      point: furnitureCorner(furniture, sx, sy),
    })),
  )
})

/** 旋转手柄：位于家具"顶部"方向外侧，随家具旋转。 */
const rotateHandle = computed(() => {
  const furniture = selectedFurniture.value
  if (!furniture || furniture.locked || selectedFurnitureIds.value.length > 1) return null
  const offset = furniture.depth / 2 + 30 / viewport.value.zoom
  const rotated = rotateVector(0, -offset, furniture.rotation)
  return {
    center: furniture.position,
    top: furnitureCorner(furniture, 0, -1),
    point: { x: furniture.position.x + rotated.x, y: furniture.position.y + rotated.y },
  }
})

function cloneDocument(): PlanDocument {
  return cloneReactive(props.document)
}

function updateDocument(document: PlanDocument) {
  const result = PlanDocumentSchema.safeParse(document)
  if (!result.success) {
    const issue = result.error.issues[0]
    const coordinate = ['x', 'y'].includes(String(issue.path.at(-1)))
    ElMessage.warning(
      coordinate
        ? '超出绘图范围：坐标需在 0 到 10000 cm 之间，请定位设计后重试'
        : `无法完成操作：${issue.message}`,
    )
    return false
  }
  emit('history')
  emit('update:document', result.data)
  return true
}

function addFurniture(assetId: string, position: Point2D) {
  const asset = assets.getById(assetId)
  if (!asset) return
  const document = cloneDocument()
  const furniture = {
    id: crypto.randomUUID(),
    assetId: asset.id,
    position: clampLogicalPoint(
      props.document.settings.snapEnabled ? snapToGrid(position, props.document.settings.gridSize) : position,
    ),
    rotation: 0,
    width: asset.width,
    depth: asset.depth,
    height: asset.height,
    locked: false,
    zIndex: Math.max(0, ...document.furniture.map((item) => item.zIndex)) + 1,
  }
  document.furniture.push(furniture)
  if (!updateDocument(document)) return
  setSelection({ type: 'furniture', id: furniture.id })
}

function onAssetDrop(event: DragEvent) {
  event.preventDefault()
  const assetId =
    event.dataTransfer?.getData('application/x-home-design-asset') || event.dataTransfer?.getData('text/plain')
  if (!assetId || !host.value) return
  const bounds = host.value.getBoundingClientRect()
  addFurniture(
    assetId,
    screenToLogical({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport.value),
  )
}

function addFurnitureAtCenter(assetId: string) {
  addFurniture(assetId, screenToLogical({ x: width.value / 2, y: height.value / 2 }, viewport.value))
}

function openingsOverlap(document: PlanDocument, wallId: string, offset: number, width: number, exceptId?: string) {
  return document.openings.some(
    (opening) =>
      opening.wallId === wallId &&
      opening.id !== exceptId &&
      offset < opening.offset + opening.width &&
      offset + width > opening.offset,
  )
}

function pointerPosition(event: any): Point2D | null {
  const node = stage.value?.getNode?.() ?? stage.value
  const pointer = node?.getPointerPosition?.()
  return pointer ? screenToLogical(pointer, viewport.value) : null
}

function flattenPoints(points: Point2D[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

function roomCenter(points: Point2D[]): Point2D {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function wallLabelPosition(wall: PlanDocument['walls'][number]) {
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const length = Math.max(1, segmentLength(wall))
  const normal = {
    x: -(wall.end.y - wall.start.y) / length,
    y: (wall.end.x - wall.start.x) / length,
  }
  return { x: midpoint.x + normal.x * (wall.thickness / 2 + 14), y: midpoint.y + normal.y * (wall.thickness / 2 + 14) }
}

/** 墙体尺寸标注的引线：沿墙法向偏移，带两端界线与投影短线（P2 尺寸标注）。 */
function wallDimensionGeometry(wall: PlanDocument['walls'][number]) {
  const length = Math.max(1, segmentLength(wall))
  const normal = {
    x: -(wall.end.y - wall.start.y) / length,
    y: (wall.end.x - wall.start.x) / length,
  }
  const offset = wall.thickness / 2 + 14
  const edge = wall.thickness / 2
  const p1 = { x: wall.start.x + normal.x * offset, y: wall.start.y + normal.y * offset }
  const p2 = { x: wall.end.x + normal.x * offset, y: wall.end.y + normal.y * offset }
  const e1 = { x: wall.start.x + normal.x * edge, y: wall.start.y + normal.y * edge }
  const e2 = { x: wall.end.x + normal.x * edge, y: wall.end.y + normal.y * edge }
  const tick = 5
  return {
    dim: [p1.x, p1.y, p2.x, p2.y],
    ext1: [e1.x, e1.y, p1.x, p1.y],
    ext2: [e2.x, e2.y, p2.x, p2.y],
    tick1: [p1.x - normal.x * tick, p1.y - normal.y * tick, p1.x + normal.x * tick, p1.y + normal.y * tick],
    tick2: [p2.x - normal.x * tick, p2.y - normal.y * tick, p2.x + normal.x * tick, p2.y + normal.y * tick],
    label: wallLabelPosition(wall),
  }
}

function furnitureAsset(assetId: string) {
  return assets.getById(assetId)
}

function furnitureDetailPath(assetId: string) {
  const name = furnitureAsset(assetId)?.name
  if (name === '沙发') return 'M10 15H90V35H10Z M10 38H48V86H10Z M52 38H90V86H52Z M2 25H9V88H2Z M91 25H98V88H91Z'
  if (name === '床') return 'M7 6H93V94H7Z M12 12H46V30H12Z M54 12H88V30H54Z M7 38H93 M7 82H93'
  if (name === '餐桌') return 'M18 18H82V82H18Z M25 3H43V15H25Z M57 3H75V15H57Z M25 85H43V97H25Z M57 85H75V97H57Z'
  if (name === '柜子') return 'M5 8H95V92H5Z M50 8V92 M44 42V58 M56 42V58'
  return 'M8 8H92V92H8Z'
}

function openingSymbol(opening: PlanDocument['openings'][number]) {
  const wall = props.document.walls.find((item) => item.id === opening.wallId)!
  const hinge = pointOnSegment(wall, opening.offset)
  return {
    x: hinge.x,
    y: hinge.y,
    rotation: (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) / Math.PI,
    listening: false,
  }
}

function openingWallThickness(opening: PlanDocument['openings'][number]) {
  return props.document.walls.find((wall) => wall.id === opening.wallId)?.thickness ?? 20
}

function finishRoom() {
  if (roomDraftPoints.value.length < 3) return
  if (polygonSelfIntersects(roomDraftPoints.value) || polygonArea(roomDraftPoints.value) === 0) {
    ElMessage.warning('房间边界不能自相交或重合')
    return
  }
  if (openWallEndpoints.value.length > 0) {
    ElMessage.warning(`墙体仍有 ${openWallEndpoints.value.length} 个未闭合端点，房间将按当前边界创建`)
  }
  const document = cloneDocument()
  const room = {
    id: crypto.randomUUID(),
    name: `房间 ${document.rooms.length + 1}`,
    polygon: cloneReactive(roomDraftPoints.value),
    floorMaterialId: document.settings.defaultFloorMaterialId,
  }
  document.rooms.push(room)
  if (!updateDocument(document)) return
  setSelection({ type: 'room', id: room.id })
  roomDraftPoints.value = []
  roomHoverPoint.value = null
  resetSnapState()
}

function magnetOn() {
  return props.magnet !== false
}

function wallEndpointCandidates(): Point2D[] {
  return props.document.walls.flatMap((wall) => [wall.start, wall.end])
}

type InteractionSnap = PointSnapResult & { guides?: { vertical: number[]; horizontal: number[] } }

function applyPointSnapHint(result: InteractionSnap) {
  if (result.kind === 'none' || result.kind === 'grid') {
    snapHint.value = null
    snapLabel.value = null
    guides.value = { vertical: [], horizontal: [] }
    return
  }
  snapHint.value = { point: result.point, kind: result.kind }
  snapLabel.value = result.label ? { point: result.point, text: result.label } : null
  // 点到语义锚点时，用穿过目标的水平/垂直辅助线强调对齐关系；墙体中线本身已可见。
  guides.value =
    result.guides ??
    (result.kind === 'wall-line'
      ? { vertical: [], horizontal: [] }
      : { vertical: [result.point.x], horizontal: [result.point.y] })
}

type EdgeAlignment = {
  point: Point2D
  xId: string | null
  yId: string | null
  labels: string[]
  guides: { vertical: number[]; horizontal: number[] }
}

/** 边缘对齐：把点吸附到最近的墙体/房间/家具水平或垂直边缘线（带滞后）。 */
function resolveEdgeAlignment(
  point: Point2D,
  exclude: { wallId?: string; furnitureId?: string } = {},
  cachedAnchors?: AxisAnchor[] | null,
): EdgeAlignment | null {
  const anchors =
    cachedAnchors ?? buildAxisAnchors({ excludeWallId: exclude.wallId, excludeFurnitureId: exclude.furnitureId })
  const result = resolveAxisSnap(
    { xs: [point.x], ys: [point.y] },
    anchors,
    viewport.value,
    {
      currentXId: snapState.value.xId,
      currentYId: snapState.value.yId,
      gridEnabled: false,
    },
  )
  if (!result.xId && !result.yId) {
    snapState.value.xId = null
    snapState.value.yId = null
    return null
  }
  snapState.value.xId = result.xId
  snapState.value.yId = result.yId
  return {
    point: { x: point.x + result.dx, y: point.y + result.dy },
    xId: result.xId,
    yId: result.yId,
    labels: result.labels,
    guides: { vertical: result.guideXs, horizontal: result.guideYs },
  }
}

/**
 * 交互吸附总入口：墙体/房间/门窗/家具语义点（带滞后）> 边缘对齐线（带滞后）> 网格。
 * 画墙时角度锁定由调用方在“没有语义点/对齐线”之后追加。
 */
function resolveInteractionSnap(
  point: Point2D,
  options: {
    excludeWallId?: string
    excludeEndpoint?: 'start' | 'end'
    excludeFurnitureId?: string
    includeFurniture?: boolean
    gridEnabled: boolean
  },
): InteractionSnap {
  const pointAnchors =
    gestureAnchors.value?.point ??
    buildPointAnchors({
      excludeWallId: options.excludeWallId,
      excludeEndpoint: options.excludeEndpoint,
      excludeFurnitureId: options.excludeFurnitureId,
      includeFurniture: options.includeFurniture,
    })
  const pointResult = resolvePointSnap(point, pointAnchors, viewport.value, {
    currentId: snapState.value.pointId,
    gridEnabled: false,
  })
  if (pointResult.kind !== 'none') {
    snapState.value.pointId = pointResult.anchorId
    snapState.value.xId = null
    snapState.value.yId = null
    return pointResult
  }
  snapState.value.pointId = null
  const edge = resolveEdgeAlignment(
    point,
    { wallId: options.excludeWallId, furnitureId: options.excludeFurnitureId },
    gestureAnchors.value?.axis ?? null,
  )
  if (edge) {
    return {
      point: edge.point,
      kind: 'edge-line',
      anchorId: edge.xId ?? edge.yId,
      label: edge.labels.join(' · '),
      target: null,
      guides: edge.guides,
    }
  }
  if (options.gridEnabled) {
    return {
      point: snapToGrid(point, props.document.settings.gridSize),
      kind: 'grid',
      anchorId: null,
      label: '网格',
      target: null,
    }
  }
  return { point, kind: 'none', anchorId: null, label: '', target: null }
}

/** 类型化吸附标记：角点用菱形、中心/交点用十字、线用圆环；网格弱化为灰点。 */
function markerShape(kind: SnapKind): 'diamond' | 'cross' | 'ring' {
  if (
    kind === 'wall-vertex' ||
    kind === 'room-corner' ||
    kind === 'wall-midpoint' ||
    kind === 'furniture-corner' ||
    kind === 'furniture-edge-mid' ||
    kind === 'opening-edge'
  ) {
    return 'diamond'
  }
  if (kind === 'furniture-center' || kind === 'wall-intersection' || kind === 'opening-center') return 'cross'
  return 'ring'
}

function markerColor(kind: SnapKind): string {
  switch (kind) {
    case 'wall-vertex':
    case 'room-corner':
    case 'wall-midpoint':
    case 'furniture-corner':
    case 'furniture-edge-mid':
      return '#0e9d8c'
    case 'furniture-center':
      return '#2f7de1'
    case 'opening-center':
      return '#8a5cd6'
    case 'opening-edge':
      return '#3f8ea6'
    case 'wall-intersection':
      return '#e0662f'
    case 'wall-line':
    case 'edge-line':
      return '#e0559a'
    case 'distance':
      return '#c98b2f'
    default:
      return '#ff4d8d'
  }
}

/**
 * 通用交互吸附：语义点（墙体端点/交点/中点、房间角点、门窗、家具）> 边缘对齐线 > 网格，
 * 带 8px 进入 / 14px 释放的吸附滞后，避免在临界位置抖动。
 * 关闭磁吸时只做坐标钳制，便于自由摆放。
 */
function snapPoint(
  point: Point2D,
  excluded?: { wallId: string; endpoint: 'start' | 'end' },
  axisOrigin?: Point2D,
): Point2D {
  if (!magnetOn() && !axisOrigin) return clampLogicalPoint(point)
  if (axisOrigin) {
    return clampLogicalPoint(
      snapOrthogonalPoint(
        axisOrigin,
        point,
        wallEndpointCandidates(),
        viewport.value,
        props.document.settings.gridSize,
        props.document.settings.snapEnabled,
      ),
    )
  }
  const result = resolveInteractionSnap(point, {
    excludeWallId: excluded?.wallId,
    excludeEndpoint: excluded?.endpoint,
    includeFurniture: false,
    gridEnabled: props.document.settings.snapEnabled,
  })
  applyPointSnapHint(result)
  return clampLogicalPoint(result.point)
}

function onStagePointerDown(event: any) {
  shiftPressed.value = !!event.evt?.shiftKey
  // Cancel before any drawing logic: a right press must never add a vertex or opening.
  if (event.evt?.button === 2) {
    cancelDrawing()
    return
  }
  if (event.evt?.button != null && event.evt.button !== 0 && event.evt.button !== 1) return
  const point = pointerPosition(event)
  if (!point) return
  if (spacePressed.value || event.evt?.button === 1) {
    isPanning.value = true
    panStart.value = { x: event.evt.clientX, y: event.evt.clientY }
    panOrigin.value = { x: viewport.value.x, y: viewport.value.y }
    return
  }
  if (tool.value === 'wall') {
    drawingStart.value = snapPoint(point)
    drawingPoint.value = drawingStart.value
    // 绘制期间文档不变，缓存一份候选供后续 pointermove 复用。
    cacheGestureAnchors({ includeFurniture: false }, {})
    return
  }
  if (tool.value === 'room') {
    snapState.value.pointId = null
    if (!gestureAnchors.value) cacheGestureAnchors({ includeFurniture: false }, {})
    const snapped = snapPoint(point)
    const first = roomDraftPoints.value[0]
    if (first && roomDraftPoints.value.length >= 3 && distance(first, snapped) <= 8 / viewport.value.zoom) {
      finishRoom()
      return
    }
    if (roomDraftPoints.value.some((candidate) => distance(candidate, snapped) < 1e-6)) {
      ElMessage.warning('房间顶点不能重复')
      return
    }
    roomDraftPoints.value.push(snapped)
    roomHoverPoint.value = snapped
    return
  }
  if (tool.value === 'door' || tool.value === 'window') {
    const nearest = props.document.walls
      .map((wall) => ({ wall, projection: projectPointToSegment(point, wall) }))
      .sort((a, b) => a.projection.distance - b.projection.distance)[0]
    if (!nearest || nearest.projection.distance > Math.max(18, nearest.wall.thickness + 8) / viewport.value.zoom) {
      ElMessage.warning('请点击墙体放置门窗')
      return
    }
    const preset = props.openingPreset
    const width = preset?.width ?? (tool.value === 'door' ? 90 : 120)
    const wallLength = segmentLength(nearest.wall)
    const offset = Math.max(0, Math.min(nearest.projection.offset - width / 2, wallLength - width))
    const document = cloneDocument()
    if (wallLength < width) {
      ElMessage.warning(`墙体长度不足，需要至少 ${width} cm 才能放置此门窗`)
      return
    }
    if (openingsOverlap(document, nearest.wall.id, offset, width)) {
      ElMessage.warning('此位置与已有门窗重叠，请换一个位置')
      return
    }
    const openingHeight = preset?.height ?? (tool.value === 'door' ? 210 : 120)
    const sillHeight = tool.value === 'door' ? 0 : (preset?.sillHeight ?? 90)
    if (openingHeight + sillHeight > nearest.wall.height) {
      ElMessage.warning(`墙高不足，默认门窗需要至少 ${openingHeight + sillHeight} cm，请先调整墙高`)
      return
    }
    document.openings.push({
      id: crypto.randomUUID(),
      wallId: nearest.wall.id,
      type: tool.value,
      offset,
      width,
      height: openingHeight,
      sillHeight,
    })
    if (!updateDocument(document)) return
    setSelection({ type: 'opening', id: document.openings[document.openings.length - 1].id })
    return
  }
  if (tool.value === 'select' && event.target === event.currentTarget) {
    // 空白处按下：开始拉框，框选范围内的对象整体选中。
    beginMarquee(point)
    return
  }
  if (event.target !== event.currentTarget) return
  setSelection(null)
}

function updateWallPreview() {
  const start = drawingStart.value
  if (!start) return
  const raw = pointerPosition(null)
  if (!raw) return
  if (!magnetOn()) {
    drawingPoint.value = clampLogicalPoint(raw)
    snapHint.value = null
    snapLabel.value = null
    return
  }
  if (shiftPressed.value) {
    const snapped = snapPoint(raw, undefined, start)
    drawingPoint.value = snapped
    snapHint.value = { point: snapped, kind: 'wall-line' }
    snapLabel.value = { point: snapped, text: '水平/垂直' }
    guides.value = { vertical: [], horizontal: [] }
    return
  }
  // 1) 语义点（带滞后）> 2) 边缘对齐线：墙体、房间、门窗、家具的边缘/中线。
  const resolved = resolveInteractionSnap(raw, { includeFurniture: false, gridEnabled: false })
  if (resolved.kind !== 'none') {
    const snapped = clampLogicalPoint(resolved.point)
    drawingPoint.value = snapped
    applyPointSnapHint({ ...resolved, point: snapped })
    return
  }
  // 3) 自动水平/垂直 + 网格兜底（复用既有 snapWallDrawPoint 的角度/网格逻辑）。
  const result = snapWallDrawPoint(
    start,
    raw,
    [],
    viewport.value,
    props.document.settings.gridSize,
    props.document.settings.snapEnabled,
    { angleStepDeg: 90, angleToleranceDeg: 6 },
  )
  drawingPoint.value = clampLogicalPoint(result.point)
  guides.value = { vertical: [], horizontal: [] }
  if (result.kind === 'angle') {
    snapHint.value = { point: drawingPoint.value, kind: 'wall-line' }
    snapLabel.value = { point: drawingPoint.value, text: '水平/垂直' }
  } else {
    snapHint.value = null
    snapLabel.value = null
  }
}

function schedulePreviewUpdate() {
  if (previewFrame) return
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0
    if (marquee.value && !areaSelection.value) {
      const point = pointerPosition(null)
      if (point) marquee.value = { start: marquee.value.start, end: clampLogicalPoint(point) }
    }
    updateWallPreview()
    if (tool.value === 'room' && roomDraftPoints.value.length) {
      const point = pointerPosition(null)
      if (point) roomHoverPoint.value = snapPoint(point)
    }
  })
}

function onStagePointerMove(event: any) {
  // Recover if a mouse release happened outside the document or was missed.
  if (drawingStart.value && event.evt?.buttons === 0) cancelDrawing()
  shiftPressed.value = !!event.evt?.shiftKey
  if (isPanning.value && panStart.value && panOrigin.value) {
    viewport.value = clampViewportToNonNegative({
      ...viewport.value,
      x: panOrigin.value.x + event.evt.clientX - panStart.value.x,
      y: panOrigin.value.y + event.evt.clientY - panStart.value.y,
    })
    return
  }
  // 合并高频鼠标移动：每帧最多计算一次吸附预览。
  schedulePreviewUpdate()
}

function onStagePointerUp(event: any) {
  if (event.evt?.button != null && event.evt.button !== 0 && event.evt.button !== 1) return
  if (isPanning.value) {
    stopPanning()
    return
  }
  shiftPressed.value = !!event.evt?.shiftKey
  if (previewFrame) {
    cancelAnimationFrame(previewFrame)
    previewFrame = 0
  }
  // 只有“正在拉框”时才结算；已选中区域后再拖选框，走的是选框自身的 drag 事件。
  if (marquee.value && !areaSelection.value) {
    const point = pointerPosition(event)
    if (point) marquee.value = { start: marquee.value.start, end: clampLogicalPoint(point) }
    finishMarquee()
    return
  }
  updateWallPreview()
  if (!drawingStart.value || !drawingPoint.value) return
  if (distance(drawingStart.value, drawingPoint.value) >= 10) {
    const document = cloneDocument()
    document.walls.push({
      id: crypto.randomUUID(),
      start: drawingStart.value,
      end: drawingPoint.value,
      thickness: document.settings.defaultWallThickness,
      height: document.settings.defaultWallHeight,
      materialId: document.settings.defaultWallMaterialId,
    })
    updateDocument(document)
  }
  drawingStart.value = null
  drawingPoint.value = null
  resetSnapState()
}

function onWheel(event: any) {
  event.evt.preventDefault()
  const node = stage.value?.getNode?.() ?? stage.value
  const pointer = node?.getPointerPosition?.()
  if (!pointer) return
  const oldZoom = viewport.value.zoom
  const direction = event.evt.deltaY > 0 ? -1 : 1
  const newZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, oldZoom * (direction > 0 ? 1.08 : 0.92)))
  const logical = screenToLogical(pointer, viewport.value)
  viewport.value = clampViewportToNonNegative({
    x: pointer.x - logical.x * newZoom,
    y: pointer.y - logical.y * newZoom,
    zoom: newZoom,
  })
}

function emitMultiSelection() {
  emit('selection-multi', [...selectedFurnitureIds.value])
}

function setSelection(selection: { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null) {
  if (!selection) clearAreaSelection()
  selectedWallId.value = selection?.type === 'wall' ? selection.id : null
  selectedOpeningId.value = selection?.type === 'opening' ? selection.id : null
  selectedRoomId.value = selection?.type === 'room' ? selection.id : null
  selectedFurnitureId.value = selection?.type === 'furniture' ? selection.id : null
  if (selection?.type !== 'furniture' && selectedFurnitureIds.value.length) {
    selectedFurnitureIds.value = []
    emitMultiSelection()
  }
  emit('selection', selection)
}

function clearAreaSelection() {
  if (!areaSelection.value && !areaDragOffset.value.x && !areaDragOffset.value.y && !marquee.value) return
  areaSelection.value = null
  areaDragOffset.value = { x: 0, y: 0 }
  marquee.value = null
}

function isFurnitureSelected(id: string) {
  return selectedFurnitureIds.value.includes(id) || isAreaFurniture(id)
}

function selectWall(id: string) {
  if (!canDragObjects.value) return
  clearAreaSelection()
  setSelection({ type: 'wall', id })
}

function startWallDrag(id: string) {
  selectWall(id)
  resetSnapState()
  clearGuides()
  lastWallDrag.value = null
  cacheGestureAnchors({ excludeWallId: id, includeFurniture: false }, { excludeWallId: id })
}

/** 整面墙拖动时的实时磁吸：对齐其它墙体/房间/家具的边缘中线，或落到网格上，并显示参考线。 */
function dragWall(id: string, event: any) {
  const wall = props.document.walls.find((item) => item.id === id)
  if (!wall) return
  const rawDx = event.target.x()
  const rawDy = event.target.y()
  lastWallDrag.value = { id, dx: rawDx, dy: rawDy }
  if (!magnetOn()) {
    guides.value = { vertical: [], horizontal: [] }
    snapLabel.value = null
    return
  }
  const anchors = gestureAnchors.value?.axis ?? buildAxisAnchors({ excludeWallId: id })
  const result = resolveAxisSnap(
    { xs: [wall.start.x + rawDx, wall.end.x + rawDx], ys: [wall.start.y + rawDy, wall.end.y + rawDy] },
    anchors,
    viewport.value,
    {
      currentXId: snapState.value.xId,
      currentYId: snapState.value.yId,
      gridSize: props.document.settings.gridSize,
      gridEnabled: props.document.settings.snapEnabled,
    },
  )
  snapState.value.xId = result.xId
  snapState.value.yId = result.yId
  const dx = Math.max(rawDx + result.dx, -Math.min(wall.start.x, wall.end.x))
  const dy = Math.max(rawDy + result.dy, -Math.min(wall.start.y, wall.end.y))
  event.target.position({ x: dx, y: dy })
  lastWallDrag.value = { id, dx, dy }
  guides.value = { vertical: result.guideXs, horizontal: result.guideYs }
  snapLabel.value = result.labels.length
    ? { point: { x: wall.start.x + dx, y: wall.start.y + dy }, text: result.labels.join(' · ') }
    : null
}

function moveWall(id: string, event: any) {
  const wall = props.document.walls.find((item) => item.id === id)
  if (!wall) return
  // Konva reports a draggable node's position in its parent layer's logical coordinates.
  const pending = lastWallDrag.value
  const dx = pending && pending.id === id ? pending.dx : event.target.x()
  const dy = pending && pending.id === id ? pending.dy : event.target.y()
  event.target.position({ x: 0, y: 0 })
  const document = cloneDocument()
  const target = document.walls.find((item) => item.id === id)
  if (!target) return
  const adjustedDx = Math.max(dx, -Math.min(target.start.x, target.end.x))
  const adjustedDy = Math.max(dy, -Math.min(target.start.y, target.end.y))
  target.start = { x: target.start.x + adjustedDx, y: target.start.y + adjustedDy }
  target.end = { x: target.end.x + adjustedDx, y: target.end.y + adjustedDy }
  clearGuides()
  resetSnapState()
  lastWallDrag.value = null
  if (!updateDocument(document)) event.target.position({ x: 0, y: 0 })
}

function startEndpointDrag(id: string, endpoint: 'start' | 'end') {
  resetSnapState()
  cacheGestureAnchors(
    { excludeWallId: id, excludeEndpoint: endpoint, includeFurniture: false },
    { excludeWallId: id },
  )
}

/** 拖动端点时的实时磁吸预览（语义点 > 边缘对齐线 > 网格，带滞后）。 */
function dragEndpoint(id: string, endpoint: 'start' | 'end', event: any) {
  if (!magnetOn()) {
    snapHint.value = null
    snapLabel.value = null
    return
  }
  const result = resolveInteractionSnap({ x: event.target.x(), y: event.target.y() }, {
    excludeWallId: id,
    excludeEndpoint: endpoint,
    includeFurniture: false,
    gridEnabled: props.document.settings.snapEnabled,
  })
  const snapped = clampLogicalPoint(result.point)
  event.target.position(snapped)
  applyPointSnapHint({ ...result, point: snapped })
}

function moveEndpoint(id: string, endpoint: 'start' | 'end', event: any) {
  const document = cloneDocument()
  const target = document.walls.find((item) => item.id === id)
  if (!target) return
  const point = snapPoint({ x: event.target.x(), y: event.target.y() }, { wallId: id, endpoint })
  resetSnapState()
  const other = endpoint === 'start' ? target.end : target.start
  if (distance(point, other) < 10) {
    event.target.position(target[endpoint])
    return
  }
  target[endpoint] = point
  if (
    document.openings.some((opening) => opening.wallId === id && opening.offset + opening.width > segmentLength(target))
  ) {
    event.target.position(props.document.walls.find((wall) => wall.id === id)![endpoint])
    ElMessage.warning('缩短后会超出现有门窗范围，请先移动或删除门窗')
    return
  }
  if (!updateDocument(document)) {
    event.target.position(props.document.walls.find((wall) => wall.id === id)![endpoint])
  }
}

function selectOpening(id: string) {
  if (!canDragObjects.value) return
  clearAreaSelection()
  setSelection({ type: 'opening', id })
}

function selectRoom(id: string) {
  if (!canDragObjects.value) return
  clearAreaSelection()
  setSelection({ type: 'room', id })
}

/** 双击房间：把房间和完全落在房间内的墙、门窗、家具作为一个整体区域选中。 */
function selectRoomArea(id: string) {
  if (!canDragObjects.value) return
  const room = props.document.rooms.find((item) => item.id === id)
  if (!room) return
  const wallIds = props.document.walls
    .filter((wall) => pointInPolygonInclusive(wall.start, room.polygon) && pointInPolygonInclusive(wall.end, room.polygon))
    .map((wall) => wall.id)
  const openingIds = props.document.openings
    .filter((opening) => wallIds.includes(opening.wallId))
    .map((opening) => opening.id)
  const furnitureIds = props.document.furniture
    .filter((furniture) => pointInPolygonInclusive(furniture.position, room.polygon))
    .map((furniture) => furniture.id)
  setSelection({ type: 'room', id })
  areaSelection.value = { wallIds, openingIds, roomIds: [id], furnitureIds }
  areaDragOffset.value = { x: 0, y: 0 }
  marquee.value = null
  clearGuides()
}

/** 框选命中：墙按线段相交（只压住一段也算），房间按多边形相交，家具按包围盒相交。 */
function collectAreaSelection(rect: Rect): AreaSelection | null {
  const wallIds = props.document.walls
    .filter((wall) => segmentIntersectsRect(wall, rect))
    .map((wall) => wall.id)
  const openingIds = props.document.openings
    .filter((opening) => wallIds.includes(opening.wallId))
    .map((opening) => opening.id)
  const roomIds = props.document.rooms
    .filter((room) => polygonIntersectsRect(room.polygon, rect))
    .map((room) => room.id)
  const furnitureIds = props.document.furniture
    .filter((item) => {
      const box = furnitureBox(item)
      return rectsOverlap({ minX: box.left, minY: box.top, maxX: box.right, maxY: box.bottom }, rect)
    })
    .map((item) => item.id)
  if (!wallIds.length && !roomIds.length && !furnitureIds.length && !openingIds.length) return null
  return { wallIds, openingIds, roomIds, furnitureIds }
}

function beginMarquee(point: Point2D) {
  setSelection(null)
  marquee.value = { start: point, end: point }
  areaDragOffset.value = { x: 0, y: 0 }
  clearGuides()
}

/** 松手结算：拖出的框足够大就选区域，只点了一下就当成取消选择。 */
function finishMarquee() {
  const box = marquee.value
  if (!box) return
  const rect = rectFromPoints(box.start, box.end)
  const widthPx = (rect.maxX - rect.minX) * viewport.value.zoom
  const heightPx = (rect.maxY - rect.minY) * viewport.value.zoom
  if (widthPx < 6 && heightPx < 6) {
    marquee.value = null
    return
  }
  const selection = collectAreaSelection(rect)
  if (!selection) {
    marquee.value = null
    return
  }
  areaSelection.value = selection
  areaDragOffset.value = { x: 0, y: 0 }
  const primary =
    selection.roomIds.length > 0
      ? ({ type: 'room', id: selection.roomIds[0] } as const)
      : selection.wallIds.length > 0
        ? ({ type: 'wall', id: selection.wallIds[0] } as const)
        : selection.furnitureIds.length > 0
          ? ({ type: 'furniture', id: selection.furnitureIds[0] } as const)
          : ({ type: 'opening', id: selection.openingIds[0] } as const)
  setSelection(primary)
}

/** 点一下选框（不拖动）＝取消整片选择，之后就能正常点选框内的单个对象。 */
function dismissAreaSelection() {
  clearAreaSelection()
  setSelection(null)
}

/** 拖动选框：整片对象实时预览平移（不写文档）。 */
function startAreaDrag() {
  if (!areaSelection.value) return
  areaDragOffset.value = { x: 0, y: 0 }
  resetSnapState()
  clearGuides()
}

function dragArea(event: any) {
  if (!areaSelection.value) return
  const rect = marqueeRect.value
  if (!rect) return
  // Konva 报告的是选框矩形的绝对位置，减去左上角才是整体位移。
  let dx = event.target.x() - rect.minX
  let dy = event.target.y() - rect.minY
  const grid = magnetOn() && props.document.settings.snapEnabled ? props.document.settings.gridSize : 0
  if (grid) {
    dx = Math.round(dx / grid) * grid
    dy = Math.round(dy / grid) * grid
  }
  const bounds = areaBounds.value
  if (bounds) {
    dx = Math.max(-bounds.minX, Math.min(10000 - bounds.maxX, dx))
    dy = Math.max(-bounds.minY, Math.min(10000 - bounds.maxY, dy))
  }
  areaDragOffset.value = { x: dx, y: dy }
  event.target.position({ x: rect.minX + dx, y: rect.minY + dy })
}

/** 松手才提交：区域内房间多边形、墙体端点、家具位置统一平移，只记一次历史。 */
function endAreaDrag(event: any) {
  const { x: dx, y: dy } = areaDragOffset.value
  areaDragOffset.value = { x: 0, y: 0 }
  const rect = marqueeRect.value
  event.target.position({ x: rect?.minX ?? 0, y: rect?.minY ?? 0 })
  if (!dx && !dy) return
  const selection = areaSelection.value
  if (!selection) return
  const document = cloneDocument()
  document.rooms.forEach((room) => {
    if (!isAreaRoom(room.id)) return
    room.polygon = room.polygon.map((point) => ({ x: point.x + dx, y: point.y + dy }))
  })
  document.walls.forEach((wall) => {
    if (!isAreaWall(wall.id)) return
    wall.start = { x: wall.start.x + dx, y: wall.start.y + dy }
    wall.end = { x: wall.end.x + dx, y: wall.end.y + dy }
  })
  document.furniture.forEach((furniture) => {
    if (!isAreaFurniture(furniture.id)) return
    furniture.position = { x: furniture.position.x + dx, y: furniture.position.y + dy }
  })
  // 选框跟随内容一起移动，方便继续拖动。
  if (marquee.value) {
    marquee.value = {
      start: { x: marquee.value.start.x + dx, y: marquee.value.start.y + dy },
      end: { x: marquee.value.end.x + dx, y: marquee.value.end.y + dy },
    }
  }
  updateDocument(document)
}

/** 房间名称/面积标签的位置；拖动区域时随预览偏移，避免文字留在原地。 */
function roomLabelCenter(room: PlanDocument['rooms'][number]) {
  const center = roomCenter(room.polygon)
  const { x: dx, y: dy } = areaDragOffset.value
  if (!isAreaRoom(room.id) || (!dx && !dy)) return center
  return { x: center.x + dx, y: center.y + dy }
}

function selectFurniture(id: string, event?: any) {
  if (!canDragObjects.value) return
  clearAreaSelection()
  const additive = Boolean(event?.evt?.shiftKey)
  if (additive) {
    const exists = selectedFurnitureIds.value.includes(id)
    selectedFurnitureIds.value = exists
      ? selectedFurnitureIds.value.filter((item) => item !== id)
      : [...selectedFurnitureIds.value, id]
  } else {
    selectedFurnitureIds.value = [id]
  }
  if (!selectedFurnitureIds.value.length) {
    setSelection(null)
    emitMultiSelection()
    return
  }
  const primary = selectedFurnitureIds.value.includes(id)
    ? id
    : selectedFurnitureIds.value[selectedFurnitureIds.value.length - 1]
  setSelection({ type: 'furniture', id: primary })
  emitMultiSelection()
}

function clearGuides() {
  guides.value = { vertical: [], horizontal: [] }
  lastGuidePosition.value = null
  lastResizePoint.value = null
}

function startFurnitureDrag(id: string) {
  selectFurniture(id)
  clearGuides()
  resetSnapState()
  cacheGestureAnchors({ excludeFurnitureId: id, includeFurniture: true }, { excludeFurnitureId: id })
}

/** 拖拽过程中实时磁吸到墙体/房间/家具的边缘与中线（带 8/14px 滞后）；不写文档、不产生历史。 */
function dragFurniture(id: string, event: any) {
  const furniture = props.document.furniture.find((item) => item.id === id)
  if (!furniture) return
  const raw = { x: event.target.x(), y: event.target.y() }
  if (!magnetOn()) {
    event.target.position(raw)
    lastGuidePosition.value = raw
    guides.value = { vertical: [], horizontal: [] }
    snapLabel.value = null
    return
  }
  const bounds = furnitureBounds({ ...furniture, position: raw })
  const movingX = [bounds.left, (bounds.left + bounds.right) / 2, bounds.right]
  const movingY = [bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom]
  const anchors = gestureAnchors.value?.axis ?? buildAxisAnchors({ excludeFurnitureId: id })
  const result = resolveAxisSnap({ xs: movingX, ys: movingY }, anchors, viewport.value, {
    currentXId: snapState.value.xId,
    currentYId: snapState.value.yId,
    gridSize: props.document.settings.gridSize,
    gridEnabled: props.document.settings.snapEnabled,
    // 标准间距吸附：家具边缘与墙/家具边缘相距 10 / 30 / 60 cm。
    gaps: [10, 30, 60],
  })
  snapState.value.xId = result.xId
  snapState.value.yId = result.yId
  const position = { x: raw.x + result.dx, y: raw.y + result.dy }
  event.target.position(position)
  lastGuidePosition.value = position
  guides.value = { vertical: result.guideXs, horizontal: result.guideYs }
  snapHint.value = null
  snapLabel.value = result.labels.length ? { point: position, text: result.labels.join(' · ') } : null
}

function moveFurniture(id: string, event: any) {
  const document = cloneDocument()
  const furniture = document.furniture.find((item) => item.id === id)
  if (!furniture || furniture.locked) return
  const guidePosition = lastGuidePosition.value
  const position = guidePosition ?? { x: event.target.x(), y: event.target.y() }
  const shouldGridSnap = props.magnet !== false && !guidePosition && document.settings.snapEnabled
  furniture.position = clampLogicalPoint(shouldGridSnap ? snapToGrid(position, document.settings.gridSize) : position)
  clearGuides()
  resetSnapState()
  if (!updateDocument(document)) {
    event.target.position(props.document.furniture.find((item) => item.id === id)!.position)
  }
}

function startResizeDrag(id: string) {
  resetSnapState()
  cacheGestureAnchors({ excludeFurnitureId: id, includeFurniture: true }, { excludeFurnitureId: id })
}

/** 缩放拖拽中：角点磁吸到墙体/房间/家具的角点、中心、边中点及网格（带滞后）。 */
function onResizeDrag(id: string, event: any) {
  const raw = { x: event.target.x(), y: event.target.y() }
  if (!magnetOn()) {
    guides.value = { vertical: [], horizontal: [] }
    lastResizePoint.value = raw
    snapHint.value = null
    snapLabel.value = null
    return
  }
  const result = resolveInteractionSnap(raw, {
    excludeFurnitureId: id,
    includeFurniture: true,
    gridEnabled: props.document.settings.snapEnabled,
  })
  lastResizePoint.value = result.point
  applyPointSnapHint(result)
}

function startRotateDrag() {
  resetSnapState()
  clearGuides()
  lastRotateAngle.value = null
}

/** 旋转手柄拖动：角度按 15° 步进吸附，并实时显示角度提示。 */
function onRotateDrag(event: any) {
  const furniture = selectedFurniture.value
  if (!furniture) return
  const dx = event.target.x() - furniture.position.x
  const dy = event.target.y() - furniture.position.y
  const radius = Math.hypot(dx, dy)
  if (radius < 1e-6) return
  const angle = snapAngleStep((Math.atan2(dx, -dy) * 180) / Math.PI, 15)
  lastRotateAngle.value = angle
  const radians = (angle * Math.PI) / 180
  const point = {
    x: furniture.position.x + Math.sin(radians) * radius,
    y: furniture.position.y - Math.cos(radians) * radius,
  }
  event.target.position(point)
  guides.value = { vertical: [], horizontal: [] }
  snapHint.value = null
  snapLabel.value = { point, text: `${Math.round(angle)}°` }
}

/** 旋转结束：把吸附后的角度写回文档。 */
function rotateFurniture(event: any) {
  const furniture = selectedFurniture.value
  if (!furniture) return
  let angle = lastRotateAngle.value
  if (angle === null) {
    const dx = event.target.x() - furniture.position.x
    const dy = event.target.y() - furniture.position.y
    if (Math.hypot(dx, dy) < 1e-6) {
      resetSnapState()
      return
    }
    angle = snapAngleStep((Math.atan2(dx, -dy) * 180) / Math.PI, 15)
  }
  const angleValue = angle
  resetSnapState()
  lastRotateAngle.value = null
  if (furniture.locked) return
  if (Math.abs(angleValue - furniture.rotation) < 1e-6) {
    event.target.position(rotateHandle.value?.point ?? furniture.position)
    return
  }
  const document = cloneDocument()
  const target = document.furniture.find((item) => item.id === furniture.id)
  if (!target) return
  target.rotation = angleValue
  updateDocument(document)
}

/** 拖拽四角手柄：保持对角固定，反算宽/深与新的中心位置（磁吸时角点吸附参考线）。 */
function resizeFurniture(id: string, sx: number, sy: number, event: any) {
  const original = props.document.furniture.find((item) => item.id === id)
  if (!original) return
  const pointer = lastResizePoint.value ?? { x: event.target.x(), y: event.target.y() }
  clearGuides()
  resetSnapState()
  if (original.locked) return
  const rad = (original.rotation * Math.PI) / 180
  const axisX = { x: Math.cos(rad), y: Math.sin(rad) }
  const axisY = { x: -Math.sin(rad), y: Math.cos(rad) }
  const opposite = furnitureCorner(original, -sx, -sy)
  const delta = { x: pointer.x - opposite.x, y: pointer.y - opposite.y }
  let width = sx * (delta.x * axisX.x + delta.y * axisX.y)
  let depth = sy * (delta.x * axisY.x + delta.y * axisY.y)
  const grid = props.magnet !== false && props.document.settings.snapEnabled ? props.document.settings.gridSize : 0
  if (grid) {
    width = Math.round(width / grid) * grid
    depth = Math.round(depth / grid) * grid
  }
  width = Math.min(2000, Math.max(1, width))
  depth = Math.min(2000, Math.max(1, depth))
  if (Math.abs(width - original.width) < 0.5 && Math.abs(depth - original.depth) < 0.5) return
  const document = cloneDocument()
  const target = document.furniture.find((item) => item.id === id)
  if (!target) return
  target.width = width
  target.depth = depth
  target.position = clampLogicalPoint({
    x: opposite.x + axisX.x * ((sx * width) / 2) + axisY.x * ((sy * depth) / 2),
    y: opposite.y + axisX.y * ((sx * width) / 2) + axisY.y * ((sy * depth) / 2),
  })
  updateDocument(document)
}

function duplicateSelected() {
  const source = selectedFurniture.value
  if (!source) return
  const document = cloneDocument()
  const offset = Math.max(10, document.settings.gridSize) * 2
  const copy = {
    ...cloneReactive(source),
    id: crypto.randomUUID(),
    position: clampLogicalPoint({ x: source.position.x + offset, y: source.position.y + offset }),
    zIndex: Math.max(0, ...document.furniture.map((item) => item.zIndex)) + 1,
  }
  document.furniture.push(copy)
  if (!updateDocument(document)) return
  setSelection({ type: 'furniture', id: copy.id })
}

function moveRoomVertex(roomId: string, vertexIndex: number, event: any) {
  const document = cloneDocument()
  const room = document.rooms.find((item) => item.id === roomId)
  if (!room) return
  const nextPoint = snapPoint({ x: event.target.x(), y: event.target.y() })
  resetSnapState()
  const nextPolygon = room.polygon.map((point, index) => (index === vertexIndex ? nextPoint : point))
  if (new Set(nextPolygon.map((point) => `${point.x},${point.y}`)).size !== nextPolygon.length) {
    event.target.position(room.polygon[vertexIndex])
    ElMessage.warning('房间顶点不能重复')
    return
  }
  if (polygonSelfIntersects(nextPolygon) || polygonArea(nextPolygon) === 0) {
    ElMessage.warning('该位置会让房间边界自相交')
    event.target.position(room.polygon[vertexIndex])
    return
  }
  room.polygon = nextPolygon
  if (!updateDocument(document)) {
    event.target.position(props.document.rooms.find((item) => item.id === roomId)!.polygon[vertexIndex])
  }
}

function openingPoints(opening: PlanDocument['openings'][number]) {
  const wall = displayWalls.value.find((item) => item.id === opening.wallId)
  if (!wall) return []
  const start = pointOnSegment(wall, opening.offset)
  const end = pointOnSegment(wall, opening.offset + opening.width)
  return [start.x, start.y, end.x, end.y]
}

function moveOpening(openingId: string, event: any) {
  const opening = props.document.openings.find((item) => item.id === openingId)
  const wall = opening && props.document.walls.find((item) => item.id === opening.wallId)
  if (!opening || !wall) return
  const dx = event.target.x()
  const dy = event.target.y()
  event.target.position({ x: 0, y: 0 })
  const center = pointOnSegment(wall, opening.offset + opening.width / 2)
  const projected = projectPointToSegment({ x: center.x + dx, y: center.y + dy }, wall)
  const document = cloneDocument()
  const target = document.openings.find((item) => item.id === openingId)
  if (!target) return
  const nextOffset = Math.max(0, Math.min(projected.offset - target.width / 2, segmentLength(wall) - target.width))
  if (openingsOverlap(document, wall.id, nextOffset, target.width, openingId)) return
  target.offset = nextOffset
  updateDocument(document)
}

function deleteSelected() {
  const area = areaSelection.value
  if (area) {
    const document = cloneDocument()
    const wallIds = new Set(area.wallIds)
    const roomIds = new Set(area.roomIds)
    const furnitureIds = new Set(area.furnitureIds)
    document.walls = document.walls.filter((wall) => !wallIds.has(wall.id))
    document.openings = document.openings.filter(
      (opening) => !wallIds.has(opening.wallId) && !area.openingIds.includes(opening.id),
    )
    document.rooms = document.rooms.filter((room) => !roomIds.has(room.id))
    document.furniture = document.furniture.filter((furniture) => !furnitureIds.has(furniture.id))
    clearAreaSelection()
    setSelection(null)
    updateDocument(document)
    return
  }
  if (!selectedWallId.value && !selectedOpeningId.value && !selectedRoomId.value && !selectedFurnitureId.value) return
  const document = cloneDocument()
  if (selectedWallId.value) {
    document.walls = document.walls.filter((wall) => wall.id !== selectedWallId.value)
    document.openings = document.openings.filter((opening) => opening.wallId !== selectedWallId.value)
  }
  if (selectedOpeningId.value)
    document.openings = document.openings.filter((opening) => opening.id !== selectedOpeningId.value)
  if (selectedRoomId.value) document.rooms = document.rooms.filter((room) => room.id !== selectedRoomId.value)
  if (selectedFurnitureId.value)
    document.furniture = document.furniture.filter((furniture) => furniture.id !== selectedFurnitureId.value)
  setSelection(null)
  updateDocument(document)
}

function cancelDrawing() {
  if (previewFrame) {
    cancelAnimationFrame(previewFrame)
    previewFrame = 0
  }
  drawingStart.value = null
  drawingPoint.value = null
  roomDraftPoints.value = []
  roomHoverPoint.value = null
  lastWallDrag.value = null
  marquee.value = null
  resetSnapState()
  clearGuides()
}

function clearInteraction() {
  cancelDrawing()
  setSelection(null)
}

watch(tool, cancelDrawing)

/** 撤销/删除等外部改动可能让区域里的对象消失，此时自动退出区域选择。 */
watch(
  () => props.document,
  (next) => {
    const selection = areaSelection.value
    if (!selection) return
    const alive =
      selection.roomIds.some((id) => next.rooms.some((room) => room.id === id)) ||
      selection.wallIds.some((id) => next.walls.some((wall) => wall.id === id)) ||
      selection.furnitureIds.some((id) => next.furniture.some((item) => item.id === id)) ||
      selection.openingIds.some((id) => next.openings.some((opening) => opening.id === id))
    if (!alive) clearAreaSelection()
  },
)

function stopPanning() {
  isPanning.value = false
  panStart.value = null
  panOrigin.value = null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * 关闭后的 el-dialog 仍会留在 DOM 里（display:none），
 * 所以不能用「存在 [role=dialog]」判断对话框是否打开，否则快捷键会被永久屏蔽。
 */
function hasOpenDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"]')).some(
    (node) => node instanceof HTMLElement && node.getClientRects().length > 0,
  )
}

function onKeyDown(event: KeyboardEvent) {
  // Text editing and dialogs own their keyboard shortcuts.
  if (isEditableTarget(event.target) || hasOpenDialog()) return
  if (event.key === 'Shift' && !isEditableTarget(event.target)) {
    shiftPressed.value = true
    updateWallPreview()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) emit('redo')
    else emit('undo')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    emit('redo')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    duplicateSelected()
    return
  }
  if (event.code === 'Space') {
    if (isEditableTarget(event.target)) return
    spacePressed.value = true
    event.preventDefault()
  }
  if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
  if (event.key === 'Escape') cancelDrawing()
}
function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spacePressed.value = false
  if (event.key === 'Shift') {
    shiftPressed.value = event.shiftKey
    updateWallPreview()
  }
}

function onWindowBlur() {
  spacePressed.value = false
  shiftPressed.value = false
  cancelDrawing()
  stopPanning()
}

function onWindowMouseUp() {
  if (isPanning.value) stopPanning()
  // Stage mouseup commits first; a remaining wall/marquee was released outside it.
  if (drawingStart.value) cancelDrawing()
  if (marquee.value && !areaSelection.value) finishMarquee()
}

function locateDesign() {
  stopPanning()
  viewport.value = clampViewportToNonNegative(fitDocumentViewport(props.document, width.value, height.value))
}

function resetViewport() {
  stopPanning()
  viewport.value = { x: 80, y: 80, zoom: 1 }
}

/** 导出当前 2D 画布为 PNG（隐藏标尺图层，裁剪到内容范围）。 */
function exportPng(filename = '设计方案') {
  const node = stage.value?.getNode?.() ?? stage.value
  if (!node) return
  const layers = node.getLayers?.() ?? []
  const rulerLayer = layers[layers.length - 1]
  const visible = rulerLayer?.visible?.()
  if (rulerLayer) rulerLayer.visible(false)
  node.draw()

  const options: Record<string, number> = { pixelRatio: 2 }
  const bounds = contentBounds()
  if (bounds) {
    const pad = 40
    const zoom = viewport.value.zoom
    const stageW = node.width()
    const stageH = node.height()
    const x = Math.max(0, bounds.left * zoom + viewport.value.x - pad)
    const y = Math.max(0, bounds.top * zoom + viewport.value.y - pad)
    const width = Math.min(stageW - x, (bounds.right - bounds.left) * zoom + pad * 2)
    const height = Math.min(stageH - y, (bounds.bottom - bounds.top) * zoom + pad * 2)
    if (width > 10 && height > 10) Object.assign(options, { x, y, width, height })
  }

  const dataUrl = node.toDataURL(options as any)
  if (rulerLayer) {
    rulerLayer.visible(visible)
    node.draw()
  }
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${filename}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function contentBounds() {
  const xs: number[] = []
  const ys: number[] = []
  props.document.walls.forEach((wall) => {
    xs.push(wall.start.x, wall.end.x)
    ys.push(wall.start.y, wall.end.y)
  })
  props.document.rooms.forEach((room) =>
    room.polygon.forEach((point) => {
      xs.push(point.x)
      ys.push(point.y)
    }),
  )
  props.document.furniture.forEach((item) => {
    const box = furnitureBounds(item)
    xs.push(box.left, box.right)
    ys.push(box.top, box.bottom)
  })
  if (!xs.length) return null
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

defineExpose({
  clearInteraction,
  deleteSelected,
  duplicateSelected,
  exportPng,
  addFurnitureAtCenter,
  locateDesign,
  selectedWallId,
  selectedOpeningId,
  selectedRoomId,
  selectedFurnitureId,
})

watch(
  () => props.document.walls.length,
  async () => {
    await nextTick()
    stage.value?.getNode?.()?.draw?.()
  },
)

onMounted(() => {
  if (host.value) {
    resizeObserver = new ResizeObserver(() => {
      if (host.value) {
        width.value = host.value.clientWidth
        height.value = host.value.clientHeight
      }
    })
    resizeObserver.observe(host.value)
    width.value = host.value.clientWidth
    height.value = host.value.clientHeight
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('blur', onWindowBlur)
})
onBeforeUnmount(() => {
  if (previewFrame) cancelAnimationFrame(previewFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('blur', onWindowBlur)
})
</script>

<template>
  <div
    ref="host"
    class="floorplan-canvas"
    :class="{
      'is-draw-tool': tool !== 'select',
      'is-pan-ready': spacePressed && !isPanning,
      'is-panning': isPanning,
    }"
    @dragover.prevent
    @drop="onAssetDrop"
    @contextmenu.prevent="cancelDrawing"
  >
    <v-stage
      ref="stage"
      :config="stageConfig"
      @mousedown="onStagePointerDown"
      @touchstart="onStagePointerDown"
      @mousemove="onStagePointerMove"
      @touchmove="onStagePointerMove"
      @mouseup="onStagePointerUp"
      @touchend="onStagePointerUp"
      @touchcancel="onWindowBlur"
      @wheel="onWheel"
    >
      <v-layer :config="worldConfig">
        <v-image
          v-if="props.background && backgroundEl"
          :config="{
            image: backgroundEl,
            x: props.background.x,
            y: props.background.y,
            width: props.background.width,
            height: props.background.height,
            opacity: props.background.opacity,
            listening: false,
          }"
        />
        <v-line
          v-for="(line, index) in gridLines"
          :key="`grid-${index}`"
          :config="{
            points: line.points,
            stroke: line.major ? '#dfe5ea' : '#eef1f4',
            strokeWidth: 1 / viewport.zoom,
            listening: false,
          }"
        />
        <template v-if="layerVisible.rooms" v-for="room in document.rooms" :key="room.id">
          <v-line
            :config="{
              points: flattenPoints(room.polygon),
              closed: true,
              fill: room.id === selectedRoomId ? '#d4edf0' : '#e9f1f5',
              stroke: room.id === selectedRoomId ? '#0e9d8c' : '#c3d0d9',
              strokeWidth: 2 / viewport.zoom,
              opacity: 0.72,
              listening: tool === 'select',
            }"
            @click="selectRoom(room.id)"
            @tap="selectRoom(room.id)"
            @dblclick="selectRoomArea(room.id)"
            @dbltap="selectRoomArea(room.id)"
          />
          <v-text
            :config="{
              x: roomLabelCenter(room).x - 45 / viewport.zoom,
              y: roomLabelCenter(room).y - 12 / viewport.zoom,
              width: 90 / viewport.zoom,
              text: `${room.name}\n${(polygonArea(room.polygon) / 10000).toFixed(2)} m²`,
              align: 'center',
              fontSize: 12 / viewport.zoom,
              lineHeight: 1.35,
              fill: '#55707c',
              listening: false,
            }"
          />
        </template>
        <template v-if="layerVisible.walls">
        <v-line
          v-for="wall in displayWalls"
          :key="`${wall.id}-outline`"
          :config="{
            points: [wall.start.x, wall.start.y, wall.end.x, wall.end.y],
            stroke: '#2b3740',
            strokeWidth: wall.thickness + 2 / viewport.zoom,
            lineCap: 'square',
            listening: false,
          }"
        />
        <v-line
          v-for="wall in displayWalls"
          :key="wall.id"
          :config="{
            points: [wall.start.x, wall.start.y, wall.end.x, wall.end.y],
            stroke: wall.id === selectedWallId || isAreaWall(wall.id) ? '#0e9d8c' : '#45565f',
            strokeWidth: wall.thickness,
            lineCap: 'square',
            hitStrokeWidth: Math.max(wall.thickness, 18),
            // 已框选成整片区域时，墙随选框整体移动，不再单独拖动。
            draggable: canDragObjects && !isAreaWall(wall.id),
            shadowColor: '#8b9aa3',
            shadowBlur: wall.id === selectedWallId ? 8 : 0,
            shadowOpacity: 0.28,
          }"
          @click="selectWall(wall.id)"
          @tap="selectWall(wall.id)"
          @dragstart="startWallDrag(wall.id)"
          @dragmove="dragWall(wall.id, $event)"
          @dragend="moveWall(wall.id, $event)"
        />
        <template v-if="props.showDimensions !== false">
          <v-line
            v-for="wall in displayWalls"
            :key="`${wall.id}-dim-main`"
            :config="{
              points: wallDimensionGeometry(wall).dim,
              stroke: '#9aabb4',
              strokeWidth: 1 / viewport.zoom,
              listening: false,
            }"
          />
          <v-line
            v-for="wall in displayWalls"
            :key="`${wall.id}-dim-ext`"
            :config="{
              points: wallDimensionGeometry(wall).ext1,
              stroke: '#c3ced5',
              strokeWidth: 0.8 / viewport.zoom,
              listening: false,
            }"
          />
          <v-line
            v-for="wall in displayWalls"
            :key="`${wall.id}-dim-ext2`"
            :config="{
              points: wallDimensionGeometry(wall).ext2,
              stroke: '#c3ced5',
              strokeWidth: 0.8 / viewport.zoom,
              listening: false,
            }"
          />
          <v-line
            v-for="wall in displayWalls"
            :key="`${wall.id}-dim-tick`"
            :config="{
              points: wallDimensionGeometry(wall).tick1,
              stroke: '#9aabb4',
              strokeWidth: 1 / viewport.zoom,
              listening: false,
            }"
          />
          <v-line
            v-for="wall in displayWalls"
            :key="`${wall.id}-dim-tick2`"
            :config="{
              points: wallDimensionGeometry(wall).tick2,
              stroke: '#9aabb4',
              strokeWidth: 1 / viewport.zoom,
              listening: false,
            }"
          />
          <v-text
            v-for="wall in displayWalls"
            :key="`${wall.id}-dimension`"
            :config="{
              x: wallLabelPosition(wall).x - 42 / viewport.zoom,
              y: wallLabelPosition(wall).y - 8 / viewport.zoom,
              width: 84 / viewport.zoom,
              text: `${Math.round(segmentLength(wall))} cm`,
              align: 'center',
              fontSize: 11 / viewport.zoom,
              fill: wall.id === selectedWallId ? '#0e9d8c' : '#718079',
              listening: false,
            }"
          />
        </template>
        </template>
        <template v-if="layerVisible.openings" v-for="opening in document.openings" :key="opening.id">
          <v-line
            :config="{
              points: openingPoints(opening),
              stroke: '#f3f5f6',
              strokeWidth: openingWallThickness(opening) + 6,
              lineCap: 'butt',
              hitStrokeWidth: 18,
              draggable: canDragObjects,
              listening: true,
            }"
            @click="selectOpening(opening.id)"
            @tap="selectOpening(opening.id)"
            @dragstart="selectOpening(opening.id)"
            @dragend="moveOpening(opening.id, $event)"
          />
          <v-group :config="openingSymbol(opening)">
            <template v-if="opening.type === 'door'">
              <!-- 双开门 -->
              <template v-if="openingStyleKey(opening) === 'door-double'">
                <v-line
                  :config="{
                    points: [0, 0, 0, opening.width / 2],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 3 / viewport.zoom,
                    lineCap: 'round',
                  }"
                />
                <v-line
                  :config="{
                    points: [opening.width, 0, opening.width, opening.width / 2],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 3 / viewport.zoom,
                    lineCap: 'round',
                  }"
                />
                <v-path
                  :config="{
                    data: `M${opening.width / 2} 0 A${opening.width / 2} ${opening.width / 2} 0 0 1 0 ${opening.width / 2} M${opening.width / 2} 0 A${opening.width / 2} ${opening.width / 2} 0 0 0 ${opening.width} ${opening.width / 2}`,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#c89a72',
                    strokeWidth: 1.2 / viewport.zoom,
                    dash: [5 / viewport.zoom, 5 / viewport.zoom],
                  }"
                />
              </template>
              <!-- 推拉门 -->
              <template v-else-if="openingStyleKey(opening) === 'door-sliding'">
                <v-line
                  :config="{
                    points: [0, -openingWallThickness(opening) / 4, opening.width * 0.62, -openingWallThickness(opening) / 4],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 4 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [opening.width * 0.38, openingWallThickness(opening) / 4, opening.width, openingWallThickness(opening) / 4],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 4 / viewport.zoom,
                  }"
                />
              </template>
              <!-- 折叠门 -->
              <template v-else-if="openingStyleKey(opening) === 'door-folding'">
                <v-line
                  :config="{
                    points: [
                      0,
                      0,
                      opening.width * 0.25,
                      -openingWallThickness(opening) * 0.55,
                      opening.width * 0.5,
                      0,
                      opening.width * 0.75,
                      -openingWallThickness(opening) * 0.55,
                      opening.width,
                      0,
                    ],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 1.8 / viewport.zoom,
                    lineJoin: 'round',
                  }"
                />
              </template>
              <!-- 单开门 -->
              <template v-else>
                <v-line
                  :config="{
                    points: [0, 0, opening.width, 0],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 1.5 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [0, 0, 0, opening.width],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#b9763c',
                    strokeWidth: 3 / viewport.zoom,
                    lineCap: 'round',
                  }"
                />
                <v-path
                  :config="{
                    data: `M${opening.width} 0 A${opening.width} ${opening.width} 0 0 1 0 ${opening.width}`,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#c89a72',
                    strokeWidth: 1.2 / viewport.zoom,
                    dash: [5 / viewport.zoom, 5 / viewport.zoom],
                  }"
                />
              </template>
            </template>
            <template v-else>
              <!-- 推拉窗 -->
              <template v-if="openingStyleKey(opening) === 'window-sliding'">
                <v-rect
                  :config="{
                    x: 0,
                    y: -openingWallThickness(opening) / 2,
                    width: opening.width * 0.62,
                    height: openingWallThickness(opening) / 2,
                    fill: '#bfe6f0',
                    opacity: 0.9,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.1 / viewport.zoom,
                  }"
                />
                <v-rect
                  :config="{
                    x: opening.width * 0.38,
                    y: 0,
                    width: opening.width * 0.62,
                    height: openingWallThickness(opening) / 2,
                    fill: '#bfe6f0',
                    opacity: 0.9,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.1 / viewport.zoom,
                  }"
                />
              </template>
              <!-- 落地窗 -->
              <template v-else-if="openingStyleKey(opening) === 'window-french'">
                <v-rect
                  :config="{
                    x: 0,
                    y: -openingWallThickness(opening) / 2,
                    width: opening.width,
                    height: openingWallThickness(opening),
                    fill: '#bfe6f0',
                    opacity: 0.85,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [opening.width / 3, -openingWallThickness(opening) / 2, opening.width / 3, openingWallThickness(opening) / 2],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [(opening.width * 2) / 3, -openingWallThickness(opening) / 2, (opening.width * 2) / 3, openingWallThickness(opening) / 2],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1 / viewport.zoom,
                  }"
                />
              </template>
              <!-- 飘窗 -->
              <template v-else-if="openingStyleKey(opening) === 'window-bay'">
                <v-rect
                  :config="{
                    x: 0,
                    y: -openingWallThickness(opening) / 2,
                    width: opening.width,
                    height: openingWallThickness(opening),
                    fill: '#bfe6f0',
                    opacity: 0.85,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [
                      0,
                      -openingWallThickness(opening) / 2,
                      opening.width * 0.2,
                      -openingWallThickness(opening) * 1.6,
                      opening.width * 0.8,
                      -openingWallThickness(opening) * 1.6,
                      opening.width,
                      -openingWallThickness(opening) / 2,
                    ],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [opening.width / 2, -openingWallThickness(opening) / 2, opening.width / 2, -openingWallThickness(opening) * 1.6],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1 / viewport.zoom,
                  }"
                />
              </template>
              <!-- 平开窗（默认） -->
              <template v-else>
                <v-rect
                  :config="{
                    x: 0,
                    y: -openingWallThickness(opening) / 2,
                    width: opening.width,
                    height: openingWallThickness(opening),
                    fill: '#bfe6f0',
                    opacity: 0.9,
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [0, 0, opening.width, 0],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
                <v-line
                  :config="{
                    points: [opening.width / 2, -openingWallThickness(opening) / 2, opening.width / 2, openingWallThickness(opening) / 2],
                    stroke: opening.id === selectedOpeningId ? '#0e9d8c' : '#3f8ea6',
                    strokeWidth: 1.2 / viewport.zoom,
                  }"
                />
              </template>
            </template>
          </v-group>
        </template>
        <v-group
          v-if="layerVisible.furniture"
          v-for="furniture in sortedFurniture"
          :key="furniture.id"
          :config="{
            x: furniture.position.x,
            y: furniture.position.y,
            rotation: furniture.rotation,
            // 已框选成整片区域时，家具随选框整体移动，不再单独拖动。
            draggable: canDragObjects && !furniture.locked && !isAreaFurniture(furniture.id),
          }"
          @click="selectFurniture(furniture.id, $event)"
          @tap="selectFurniture(furniture.id)"
          @dragstart="startFurnitureDrag(furniture.id)"
          @dragmove="dragFurniture(furniture.id, $event)"
          @dragend="moveFurniture(furniture.id, $event)"
        >
          <v-rect
            :config="{
              x: -furniture.width / 2,
              y: -furniture.depth / 2,
              width: furniture.width,
              height: furniture.depth,
              fill: furnitureAsset(furniture.assetId)?.color ?? '#9aa69d',
              stroke: isFurnitureSelected(furniture.id) ? '#0e9d8c' : '#566771',
              strokeWidth: (isFurnitureSelected(furniture.id) ? 2.5 : 1.2) / viewport.zoom,
              cornerRadius: 6 / viewport.zoom,
              shadowColor: '#94a3ac',
              shadowBlur: 8 / viewport.zoom,
              shadowOpacity: 0.2,
              shadowOffsetY: 2 / viewport.zoom,
            }"
          />
          <v-path
            :config="{
              data: furnitureDetailPath(furniture.assetId),
              x: -furniture.width / 2,
              y: -furniture.depth / 2,
              scaleX: furniture.width / 100,
              scaleY: furniture.depth / 100,
              stroke: '#6d808b',
              fill: '#ffffff38',
              strokeWidth: 1,
              strokeScaleEnabled: false,
              listening: false,
            }"
          />
          <v-text
            :config="{
              x: -furniture.width / 2,
              y: furniture.depth / 2 + 6 / viewport.zoom,
              width: furniture.width,
              text:
                (furnitureAsset(furniture.assetId)?.name ?? '家具') +
                (isFurnitureSelected(furniture.id) ? ' · 高 ' + Math.round(furniture.height) : ''),
              align: 'center',
              fontSize: 12 / viewport.zoom,
              fill: '#33434d',
              listening: false,
            }"
          />
        </v-group>
        <v-line
          v-for="x in guides.vertical"
          :key="`guide-x-${x}`"
          :config="{
            points: [x, visibleWorld.top, x, visibleWorld.bottom],
            stroke: '#ff4d8d',
            strokeWidth: 1 / viewport.zoom,
            dash: [6 / viewport.zoom, 4 / viewport.zoom],
            listening: false,
          }"
        />
        <v-line
          v-for="y in guides.horizontal"
          :key="`guide-y-${y}`"
          :config="{
            points: [visibleWorld.left, y, visibleWorld.right, y],
            stroke: '#ff4d8d',
            strokeWidth: 1 / viewport.zoom,
            dash: [6 / viewport.zoom, 4 / viewport.zoom],
            listening: false,
          }"
        />
        <v-group v-if="selectedFurniture && tool === 'select' && layerVisible.furniture">
          <v-circle
            v-for="handle in resizeHandles"
            :key="`resize-${handle.key}`"
            :config="{
              x: handle.point.x,
              y: handle.point.y,
              radius: 5 / viewport.zoom,
              fill: '#ffffff',
              stroke: '#0e9d8c',
              strokeWidth: 1.6 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragstart="startResizeDrag(selectedFurniture?.id ?? '')"
            @dragmove="onResizeDrag(selectedFurniture?.id ?? '', $event)"
            @dragend="resizeFurniture(selectedFurniture?.id ?? '', handle.sx, handle.sy, $event)"
          />
          <template v-if="rotateHandle">
            <v-line
              :config="{
                points: [rotateHandle.top.x, rotateHandle.top.y, rotateHandle.point.x, rotateHandle.point.y],
                stroke: '#0e9d8c',
                strokeWidth: 1 / viewport.zoom,
                dash: [4 / viewport.zoom, 3 / viewport.zoom],
                listening: false,
              }"
            />
            <v-circle
              :config="{
                x: rotateHandle.point.x,
                y: rotateHandle.point.y,
                radius: 6 / viewport.zoom,
                fill: '#ffffff',
                stroke: '#b9763c',
                strokeWidth: 1.8 / viewport.zoom,
                draggable: canDragObjects,
              }"
              @dragstart="startRotateDrag()"
              @dragmove="onRotateDrag($event)"
              @dragend="rotateFurniture($event)"
            />
          </template>
        </v-group>
        <template v-if="selectedWall && tool === 'select'">
          <v-circle
            :config="{
              x: selectedWall.start.x,
              y: selectedWall.start.y,
              radius: 7 / viewport.zoom,
              fill: '#fff',
              stroke: '#0e9d8c',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragstart="startEndpointDrag(selectedWall.id, 'start')"
            @dragmove="dragEndpoint(selectedWall.id, 'start', $event)"
            @dragend="moveEndpoint(selectedWall.id, 'start', $event)"
          />
          <v-circle
            :config="{
              x: selectedWall.end.x,
              y: selectedWall.end.y,
              radius: 7 / viewport.zoom,
              fill: '#fff',
              stroke: '#0e9d8c',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragstart="startEndpointDrag(selectedWall.id, 'end')"
            @dragmove="dragEndpoint(selectedWall.id, 'end', $event)"
            @dragend="moveEndpoint(selectedWall.id, 'end', $event)"
          />
        </template>
        <v-circle
          v-for="endpoint in openWallEndpoints.filter((item) => item.wallId !== selectedWallId)"
          :key="`open-${endpoint.wallId}-${endpoint.endpoint}`"
          :config="{
            x: endpoint.point.x,
            y: endpoint.point.y,
            radius: 3 / viewport.zoom,
            fill: '#b85c2f',
            stroke: '#b85c2f',
            strokeWidth: 2 / viewport.zoom,
            listening: false,
          }"
        />
        <template v-if="selectedRoom && tool === 'select' && !areaSelection">
          <v-circle
            v-for="(point, index) in selectedRoom.polygon"
            :key="`${selectedRoom.id}-${index}`"
            :config="{
              x: point.x,
              y: point.y,
              radius: 6 / viewport.zoom,
              fill: '#fff',
              stroke: '#0e9d8c',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragend="moveRoomVertex(selectedRoom.id, index, $event)"
          />
        </template>
        <!-- 框选矩形：拖动中只是预览，选中后变成可整体拖动的选框。 -->
        <v-rect
          v-if="marqueeRect"
          :config="{
            x: marqueeRect.minX,
            y: marqueeRect.minY,
            width: marqueeRect.maxX - marqueeRect.minX,
            height: marqueeRect.maxY - marqueeRect.minY,
            fill: 'rgba(14, 157, 140, 0.10)',
            stroke: '#0e9d8c',
            strokeWidth: 1.5 / viewport.zoom,
            dash: [6 / viewport.zoom, 4 / viewport.zoom],
            listening: canDragObjects && Boolean(areaSelection),
            draggable: canDragObjects && Boolean(areaSelection),
          }"
          @click="dismissAreaSelection"
          @tap="dismissAreaSelection"
          @dragstart="startAreaDrag"
          @dragmove="dragArea($event)"
          @dragend="endAreaDrag($event)"
        />
        <v-line
          v-if="drawingStart && drawingPoint"
          :config="{
            points: [drawingStart.x, drawingStart.y, drawingPoint.x, drawingPoint.y],
            stroke: '#0e9d8c',
            strokeWidth: props.document.settings.defaultWallThickness,
            dash: [8, 6],
            opacity: 0.8,
            listening: false,
          }"
        />
        <template v-if="snapHint">
          <v-circle
            :config="{
              x: snapHint.point.x,
              y: snapHint.point.y,
              radius: 11 / viewport.zoom,
              fill: markerColor(snapHint.kind),
              opacity: 0.22,
              listening: false,
            }"
          />
          <v-rect
            v-if="markerShape(snapHint.kind) === 'diamond'"
            :config="{
              x: snapHint.point.x - 4 / viewport.zoom,
              y: snapHint.point.y - 4 / viewport.zoom,
              width: 8 / viewport.zoom,
              height: 8 / viewport.zoom,
              rotation: 45,
              fill: '#ffffff',
              stroke: markerColor(snapHint.kind),
              strokeWidth: 2 / viewport.zoom,
              listening: false,
            }"
          />
          <template v-else-if="markerShape(snapHint.kind) === 'cross'">
            <v-line
              :config="{
                points: [snapHint.point.x - 6 / viewport.zoom, snapHint.point.y, snapHint.point.x + 6 / viewport.zoom, snapHint.point.y],
                stroke: markerColor(snapHint.kind),
                strokeWidth: 2 / viewport.zoom,
                listening: false,
              }"
            />
            <v-line
              :config="{
                points: [snapHint.point.x, snapHint.point.y - 6 / viewport.zoom, snapHint.point.x, snapHint.point.y + 6 / viewport.zoom],
                stroke: markerColor(snapHint.kind),
                strokeWidth: 2 / viewport.zoom,
                listening: false,
              }"
            />
          </template>
          <v-circle
            v-else
            :config="{
              x: snapHint.point.x,
              y: snapHint.point.y,
              radius: 4 / viewport.zoom,
              fillEnabled: false,
              stroke: markerColor(snapHint.kind),
              strokeWidth: 2 / viewport.zoom,
              listening: false,
            }"
          />
        </template>
        <v-text
          v-if="snapLabel"
          :config="{
            x: snapLabel.point.x + 10 / viewport.zoom,
            y: snapLabel.point.y - 26 / viewport.zoom,
            text: snapLabel.text,
            fontSize: 12 / viewport.zoom,
            fontStyle: 'bold',
            fill: '#ffffff',
            stroke: '#2b3740',
            strokeWidth: 2 / viewport.zoom,
            fillAfterStrokeEnabled: true,
            listening: false,
          }"
        />
        <v-text
          v-if="drawingInfo"
          :config="{
            x: drawingPoint ? drawingPoint.x + 12 / viewport.zoom : 0,
            y: drawingPoint ? drawingPoint.y + 12 / viewport.zoom : 0,
            text: `${drawingInfo.length} cm · ${drawingInfo.angle}°`,
            fontSize: 12 / viewport.zoom,
            fontStyle: 'bold',
            fill: '#0e6f63',
            stroke: '#ffffff',
            strokeWidth: 2.5 / viewport.zoom,
            fillAfterStrokeEnabled: true,
            listening: false,
          }"
        />
        <v-line
          v-if="roomDraftPoints.length"
          :config="{
            points: flattenPoints(roomHoverPoint ? [...roomDraftPoints, roomHoverPoint] : roomDraftPoints),
            stroke: '#0e9d8c',
            strokeWidth: 2 / viewport.zoom,
            dash: [8 / viewport.zoom, 5 / viewport.zoom],
            fill: '#d6eef0',
            opacity: 0.85,
            listening: false,
          }"
        />
        <v-circle
          v-for="(point, index) in roomDraftPoints"
          :key="`room-draft-${index}`"
          :config="{
            x: point.x,
            y: point.y,
            radius: 5 / viewport.zoom,
            fill: index === 0 ? '#0e9d8c' : '#fff',
            stroke: '#0e9d8c',
            strokeWidth: 2 / viewport.zoom,
            listening: false,
          }"
        />
      </v-layer>
      <v-layer :config="{ listening: false }">
        <v-rect :config="{ x: 0, y: 0, width, height: 25, fill: '#f7f9fbee', stroke: '#d3dce1', strokeWidth: 1 }" />
        <v-rect :config="{ x: 0, y: 0, width: 42, height, fill: '#f7f9fbee', stroke: '#d3dce1', strokeWidth: 1 }" />
        <template v-for="tick in horizontalRulerTicks" :key="`ruler-x-${tick.value}`">
          <v-line :config="{ points: [tick.screen, 17, tick.screen, 25], stroke: '#8493a0', strokeWidth: 1 }" />
          <v-text :config="{ x: tick.screen + 3, y: 3, text: String(tick.value), fontSize: 10, fill: '#5b6c77' }" />
        </template>
        <template v-for="tick in verticalRulerTicks" :key="`ruler-y-${tick.value}`">
          <v-line :config="{ points: [34, tick.screen, 42, tick.screen], stroke: '#8493a0', strokeWidth: 1 }" />
          <v-text
            :config="{
              x: 2,
              y: tick.screen - 6,
              width: 29,
              text: String(tick.value),
              align: 'right',
              fontSize: 10,
              fill: '#5b6c77',
            }"
          />
        </template>
        <v-rect :config="{ x: 0, y: 0, width: 42, height: 25, fill: '#e8eef2', stroke: '#d3dce1', strokeWidth: 1 }" />
        <v-text :config="{ x: 5, y: 7, text: 'cm', fontSize: 10, fontStyle: 'bold', fill: '#4f6270' }" />
      </v-layer>
    </v-stage>
    <div class="canvas-navigation" role="group" aria-label="画布定位">
      <el-button size="small" :icon="Aim" title="居中并完整显示已绘制的墙体、房间和家具" @click="locateDesign"
        >定位设计</el-button
      >
      <el-button size="small" :icon="Location" title="回到坐标原点附近，恢复 100% 缩放" @click="resetViewport"
        >回到原点</el-button
      >
    </div>
    <div
      v-if="document.walls.length"
      class="topology-badge"
      :class="{ open: openWallEndpoints.length > 0 }"
      role="status"
    >
      {{ openWallEndpoints.length ? `墙体未闭合 · ${openWallEndpoints.length} 个端点` : '墙体已闭合' }}
    </div>
    <div class="canvas-overlay">
      {{
        areaSelection
          ? '区域已选 · 拖动选框整体移动 · Delete 删除'
          : tool === 'select'
            ? marquee
              ? '松开鼠标完成框选'
              : '空白处按下拖动框选 · 双击房间选择整间'
            : tool === 'wall'
              ? drawingStart
                ? shiftPressed
                  ? '水平/垂直锁定 · 右键 / Esc 取消'
                  : 'Shift 水平/垂直 · 右键 / Esc 取消'
                : '拖动绘制墙体 · Shift 水平/垂直'
              : tool === 'room'
                ? roomDraftPoints.length
                  ? '点击首点闭合 · 右键 / Esc 取消'
                  : '逐点标注房间边界'
                : tool === 'door' || tool === 'window'
                  ? '点击墙体放置'
                  : '滚轮缩放 · 空格拖动画布'
      }}
      ·
      {{ Number((viewport.zoom * 100).toFixed(1)) }}%
    </div>
  </div>
</template>
