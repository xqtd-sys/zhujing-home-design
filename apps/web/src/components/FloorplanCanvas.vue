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
  snapToWallEndpoints,
  snapOrthogonalPoint,
  type Viewport,
} from '../editor/geometry'
import { cloneReactive } from '../editor/clone'

const props = defineProps<{ document: PlanDocument; tool: 'select' | 'wall' | 'door' | 'window' | 'room' }>()
const assets = useAssetsStore()
const emit = defineEmits<{
  'update:document': [document: PlanDocument]
  history: []
  selection: [selection: { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null]
  undo: []
  redo: []
}>()

const host = ref<HTMLElement | null>(null)
const stage = ref<any>(null)
const width = ref(800)
const height = ref(600)
const viewport = ref<Viewport>({ x: 80, y: 80, zoom: 1 })
const tool = computed(() => props.tool)
const selectedWallId = ref<string | null>(null)
const selectedOpeningId = ref<string | null>(null)
const selectedRoomId = ref<string | null>(null)
const selectedFurnitureId = ref<string | null>(null)
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
let resizeObserver: ResizeObserver | undefined

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
const sortedFurniture = computed(() => [...props.document.furniture].sort((a, b) => a.zIndex - b.zIndex))

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
}

function snapPoint(
  point: Point2D,
  excluded?: { wallId: string; endpoint: 'start' | 'end' },
  axisOrigin?: Point2D,
): Point2D {
  const candidates = props.document.walls.flatMap((wall) =>
    (['start', 'end'] as const)
      .filter((endpoint) => wall.id !== excluded?.wallId || endpoint !== excluded.endpoint)
      .map((endpoint) => wall[endpoint]),
  )
  if (axisOrigin) {
    return clampLogicalPoint(snapOrthogonalPoint(
      axisOrigin,
      point,
      candidates,
      viewport.value,
      props.document.settings.gridSize,
      props.document.settings.snapEnabled,
    ))
  }
  return clampLogicalPoint(
    snapToWallEndpoints(
      point,
      candidates,
      viewport.value,
      props.document.settings.gridSize,
      props.document.settings.snapEnabled,
    ),
  )
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
    return
  }
  if (tool.value === 'room') {
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
    const width = tool.value === 'door' ? 90 : 120
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
    const openingHeight = tool.value === 'door' ? 210 : 120
    const sillHeight = tool.value === 'door' ? 0 : 90
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
  if (event.target !== event.currentTarget) return
  setSelection(null)
}

function updateWallPreview() {
  if (!drawingStart.value) return
  const point = pointerPosition(null)
  if (point) drawingPoint.value = snapPoint(point, undefined, shiftPressed.value ? drawingStart.value : undefined)
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
  updateWallPreview()
  if (tool.value === 'room' && roomDraftPoints.value.length) {
    const point = pointerPosition(event)
    if (point) roomHoverPoint.value = snapPoint(point)
  }
}

function onStagePointerUp(event: any) {
  if (event.evt?.button != null && event.evt.button !== 0 && event.evt.button !== 1) return
  if (isPanning.value) {
    stopPanning()
    return
  }
  shiftPressed.value = !!event.evt?.shiftKey
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

function setSelection(selection: { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null) {
  selectedWallId.value = selection?.type === 'wall' ? selection.id : null
  selectedOpeningId.value = selection?.type === 'opening' ? selection.id : null
  selectedRoomId.value = selection?.type === 'room' ? selection.id : null
  selectedFurnitureId.value = selection?.type === 'furniture' ? selection.id : null
  emit('selection', selection)
}

function selectWall(id: string) {
  if (!canDragObjects.value) return
  setSelection({ type: 'wall', id })
}

function moveWall(id: string, event: any) {
  const wall = props.document.walls.find((item) => item.id === id)
  if (!wall) return
  // Konva reports a draggable node's position in its parent layer's logical coordinates.
  const dx = event.target.x()
  const dy = event.target.y()
  event.target.position({ x: 0, y: 0 })
  const document = cloneDocument()
  const target = document.walls.find((item) => item.id === id)
  if (!target) return
  const adjustedDx = Math.max(dx, -Math.min(target.start.x, target.end.x))
  const adjustedDy = Math.max(dy, -Math.min(target.start.y, target.end.y))
  target.start = { x: target.start.x + adjustedDx, y: target.start.y + adjustedDy }
  target.end = { x: target.end.x + adjustedDx, y: target.end.y + adjustedDy }
  updateDocument(document)
}

function moveEndpoint(id: string, endpoint: 'start' | 'end', event: any) {
  const document = cloneDocument()
  const target = document.walls.find((item) => item.id === id)
  if (!target) return
  const point = snapPoint({ x: event.target.x(), y: event.target.y() }, { wallId: id, endpoint })
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
  setSelection({ type: 'opening', id })
}

function selectRoom(id: string) {
  if (!canDragObjects.value) return
  setSelection({ type: 'room', id })
}

function selectFurniture(id: string) {
  if (!canDragObjects.value) return
  setSelection({ type: 'furniture', id })
}

function moveFurniture(id: string, event: any) {
  const document = cloneDocument()
  const furniture = document.furniture.find((item) => item.id === id)
  if (!furniture || furniture.locked) return
  const position = { x: event.target.x(), y: event.target.y() }
  furniture.position = clampLogicalPoint(
    document.settings.snapEnabled ? snapToGrid(position, document.settings.gridSize) : position,
  )
  if (!updateDocument(document)) {
    event.target.position(props.document.furniture.find((item) => item.id === id)!.position)
  }
}

function moveRoomVertex(roomId: string, vertexIndex: number, event: any) {
  const document = cloneDocument()
  const room = document.rooms.find((item) => item.id === roomId)
  if (!room) return
  const nextPoint = snapPoint({ x: event.target.x(), y: event.target.y() })
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
  const wall = props.document.walls.find((item) => item.id === opening.wallId)
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
  drawingStart.value = null
  drawingPoint.value = null
  roomDraftPoints.value = []
  roomHoverPoint.value = null
}

function clearInteraction() {
  cancelDrawing()
  setSelection(null)
}

watch(tool, cancelDrawing)

function stopPanning() {
  isPanning.value = false
  panStart.value = null
  panOrigin.value = null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onKeyDown(event: KeyboardEvent) {
  // Text editing and dialogs own their keyboard shortcuts.
  if (isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return
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
  // Stage mouseup commits first; a remaining wall was released outside it.
  if (drawingStart.value) cancelDrawing()
}

function locateDesign() {
  stopPanning()
  viewport.value = clampViewportToNonNegative(fitDocumentViewport(props.document, width.value, height.value))
}

function resetViewport() {
  stopPanning()
  viewport.value = { x: 80, y: 80, zoom: 1 }
}

defineExpose({
  clearInteraction,
  deleteSelected,
  addFurnitureAtCenter,
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
        <v-line
          v-for="(line, index) in gridLines"
          :key="`grid-${index}`"
          :config="{
            points: line.points,
            stroke: line.major ? '#dce3da' : '#edf0e9',
            strokeWidth: 1 / viewport.zoom,
            listening: false,
          }"
        />
        <template v-for="room in document.rooms" :key="room.id">
          <v-line
            :config="{
              points: flattenPoints(room.polygon),
              closed: true,
              fill: room.id === selectedRoomId ? '#c9dfd2' : '#e2e9dc',
              stroke: room.id === selectedRoomId ? '#17604f' : '#a6b8aa',
              strokeWidth: 2 / viewport.zoom,
              opacity: 0.72,
              listening: tool === 'select',
            }"
            @click="selectRoom(room.id)"
            @tap="selectRoom(room.id)"
          />
          <v-text
            :config="{
              x: roomCenter(room.polygon).x - 45 / viewport.zoom,
              y: roomCenter(room.polygon).y - 12 / viewport.zoom,
              width: 90 / viewport.zoom,
              text: `${room.name}\n${(polygonArea(room.polygon) / 10000).toFixed(2)} m²`,
              align: 'center',
              fontSize: 12 / viewport.zoom,
              lineHeight: 1.35,
              fill: '#50645a',
              listening: false,
            }"
          />
        </template>
        <v-line
          v-for="wall in document.walls"
          :key="wall.id"
          :config="{
            points: [wall.start.x, wall.start.y, wall.end.x, wall.end.y],
            stroke: wall.id === selectedWallId ? '#17604f' : '#526c60',
            strokeWidth: wall.thickness,
            lineCap: 'square',
            hitStrokeWidth: Math.max(wall.thickness, 18),
            draggable: canDragObjects,
            shadowColor: '#7b8d82',
            shadowBlur: wall.id === selectedWallId ? 8 : 0,
          }"
          @click="selectWall(wall.id)"
          @tap="selectWall(wall.id)"
          @dragstart="selectWall(wall.id)"
          @dragend="moveWall(wall.id, $event)"
        />
        <v-text
          v-for="wall in document.walls"
          :key="`${wall.id}-dimension`"
          :config="{
            x: wallLabelPosition(wall).x - 42 / viewport.zoom,
            y: wallLabelPosition(wall).y - 8 / viewport.zoom,
            width: 84 / viewport.zoom,
            text: `${Math.round(segmentLength(wall))} cm`,
            align: 'center',
            fontSize: 11 / viewport.zoom,
            fill: wall.id === selectedWallId ? '#17604f' : '#718079',
            listening: false,
          }"
        />
        <template v-for="opening in document.openings" :key="opening.id">
          <v-line
            :config="{
              points: openingPoints(opening),
              stroke: '#e9eeea',
              strokeWidth: (document.walls.find((wall) => wall.id === opening.wallId)?.thickness ?? 20) + 5,
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
            <v-path
              v-if="opening.type === 'door'"
              :config="{
                data: `M0 0 L0 ${opening.width} M${opening.width} 0 A${opening.width} ${opening.width} 0 0 1 0 ${opening.width}`,
                stroke: opening.id === selectedOpeningId ? '#17604f' : '#9e6a42',
                strokeWidth: 1.5 / viewport.zoom,
              }"
            />
            <v-line
              v-else
              :config="{
                points: [0, -4, opening.width, -4, opening.width, 4, 0, 4, 0, -4],
                stroke: opening.id === selectedOpeningId ? '#17604f' : '#4c8a9b',
                strokeWidth: 1.5 / viewport.zoom,
              }"
            />
          </v-group>
        </template>
        <v-group
          v-for="furniture in sortedFurniture"
          :key="furniture.id"
          :config="{
            x: furniture.position.x,
            y: furniture.position.y,
            rotation: furniture.rotation,
            draggable: canDragObjects && !furniture.locked,
          }"
          @click="selectFurniture(furniture.id)"
          @tap="selectFurniture(furniture.id)"
          @dragstart="selectFurniture(furniture.id)"
          @dragend="moveFurniture(furniture.id, $event)"
        >
          <v-rect
            :config="{
              x: -furniture.width / 2,
              y: -furniture.depth / 2,
              width: furniture.width,
              height: furniture.depth,
              fill: furnitureAsset(furniture.assetId)?.color ?? '#9aa69d',
              stroke: furniture.id === selectedFurnitureId ? '#17604f' : '#60766b',
              strokeWidth: (furniture.id === selectedFurnitureId ? 3 : 1) / viewport.zoom,
              cornerRadius: 3 / viewport.zoom,
              shadowColor: '#718079',
              shadowBlur: furniture.id === selectedFurnitureId ? 7 / viewport.zoom : 0,
            }"
          />
          <v-path
            :config="{
              data: furnitureDetailPath(furniture.assetId),
              x: -furniture.width / 2,
              y: -furniture.depth / 2,
              scaleX: furniture.width / 100,
              scaleY: furniture.depth / 100,
              stroke: '#496357',
              fill: '#ffffff28',
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
              text: furnitureAsset(furniture.assetId)?.name ?? '家具',
              align: 'center',
              fontSize: 12 / viewport.zoom,
              fill: '#263b33',
              listening: false,
            }"
          />
        </v-group>
        <template v-if="selectedWall && tool === 'select'">
          <v-circle
            :config="{
              x: selectedWall.start.x,
              y: selectedWall.start.y,
              radius: 7 / viewport.zoom,
              fill: '#fff',
              stroke: '#17604f',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragend="moveEndpoint(selectedWall.id, 'start', $event)"
          />
          <v-circle
            :config="{
              x: selectedWall.end.x,
              y: selectedWall.end.y,
              radius: 7 / viewport.zoom,
              fill: '#fff',
              stroke: '#17604f',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
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
        <template v-if="selectedRoom && tool === 'select'">
          <v-circle
            v-for="(point, index) in selectedRoom.polygon"
            :key="`${selectedRoom.id}-${index}`"
            :config="{
              x: point.x,
              y: point.y,
              radius: 6 / viewport.zoom,
              fill: '#fff',
              stroke: '#17604f',
              strokeWidth: 2 / viewport.zoom,
              draggable: canDragObjects,
            }"
            @dragend="moveRoomVertex(selectedRoom.id, index, $event)"
          />
        </template>
        <v-line
          v-if="drawingStart && drawingPoint"
          :config="{
            points: [drawingStart.x, drawingStart.y, drawingPoint.x, drawingPoint.y],
            stroke: '#23775c',
            strokeWidth: props.document.settings.defaultWallThickness,
            dash: [8, 6],
            opacity: 0.8,
            listening: false,
          }"
        />
        <v-line
          v-if="roomDraftPoints.length"
          :config="{
            points: flattenPoints(roomHoverPoint ? [...roomDraftPoints, roomHoverPoint] : roomDraftPoints),
            stroke: '#23775c',
            strokeWidth: 2 / viewport.zoom,
            dash: [8 / viewport.zoom, 5 / viewport.zoom],
            fill: '#dce9df',
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
            fill: index === 0 ? '#17604f' : '#fff',
            stroke: '#17604f',
            strokeWidth: 2 / viewport.zoom,
            listening: false,
          }"
        />
      </v-layer>
      <v-layer :config="{ listening: false }">
        <v-rect :config="{ x: 0, y: 0, width, height: 25, fill: '#f8faf8ee', stroke: '#cbd7cf', strokeWidth: 1 }" />
        <v-rect :config="{ x: 0, y: 0, width: 42, height, fill: '#f8faf8ee', stroke: '#cbd7cf', strokeWidth: 1 }" />
        <template v-for="tick in horizontalRulerTicks" :key="`ruler-x-${tick.value}`">
          <v-line :config="{ points: [tick.screen, 17, tick.screen, 25], stroke: '#788a80', strokeWidth: 1 }" />
          <v-text :config="{ x: tick.screen + 3, y: 3, text: String(tick.value), fontSize: 10, fill: '#61736a' }" />
        </template>
        <template v-for="tick in verticalRulerTicks" :key="`ruler-y-${tick.value}`">
          <v-line :config="{ points: [34, tick.screen, 42, tick.screen], stroke: '#788a80', strokeWidth: 1 }" />
          <v-text
            :config="{
              x: 2,
              y: tick.screen - 6,
              width: 29,
              text: String(tick.value),
              align: 'right',
              fontSize: 10,
              fill: '#61736a',
            }"
          />
        </template>
        <v-rect :config="{ x: 0, y: 0, width: 42, height: 25, fill: '#edf2ee', stroke: '#cbd7cf', strokeWidth: 1 }" />
        <v-text :config="{ x: 5, y: 7, text: 'cm', fontSize: 10, fontStyle: 'bold', fill: '#50645a' }" />
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
        tool === 'wall'
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
