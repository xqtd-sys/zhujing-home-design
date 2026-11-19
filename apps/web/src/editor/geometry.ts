import type { PlanDocument, Point2D } from '@home-design/plan-schema'

export type Viewport = { x: number; y: number; zoom: number }
export const MIN_LOGICAL_COORDINATE = 0
export const MIN_CANVAS_ZOOM = 0.005
export const MAX_CANVAS_ZOOM = 2.5

export function clampLogicalPoint(point: Point2D): Point2D {
  return {
    x: Math.max(MIN_LOGICAL_COORDINATE, point.x),
    y: Math.max(MIN_LOGICAL_COORDINATE, point.y),
  }
}

export function clampViewportToNonNegative(viewport: Viewport, originOffset = 80): Viewport {
  return {
    ...viewport,
    x: Math.min(viewport.x, originOffset),
    y: Math.min(viewport.y, originOffset),
  }
}

export function fitDocumentViewport(
  document: Pick<PlanDocument, 'walls' | 'rooms' | 'furniture'>,
  width: number,
  height: number,
): Viewport {
  const points: Point2D[] = document.rooms.flatMap((room) => room.polygon)
  for (const wall of document.walls) {
    // Include square line caps at any wall angle.
    const margin = wall.thickness / Math.SQRT2
    for (const point of [wall.start, wall.end]) {
      points.push({ x: point.x - margin, y: point.y - margin }, { x: point.x + margin, y: point.y + margin })
    }
  }
  for (const item of document.furniture) {
    const angle = (item.rotation * Math.PI) / 180
    for (const x of [-item.width / 2, item.width / 2]) {
      for (const y of [-item.depth / 2, item.depth / 2]) {
        points.push({
          x: item.position.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: item.position.y + x * Math.sin(angle) + y * Math.cos(angle),
        })
      }
    }
  }
  if (!points.length || width <= 0 || height <= 0) return { x: 80, y: 80, zoom: 1 }
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y))
  // Leave room for the rulers, status badge and navigation controls.
  const left = 64,
    top = 70
  const availableWidth = Math.max(1, width - left - 32)
  const availableHeight = Math.max(1, height - top - 96)
  const zoom = Math.max(
    MIN_CANVAS_ZOOM,
    Math.min(1, availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)),
  )
  return {
    x: left + availableWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: top + availableHeight / 2 - ((minY + maxY) / 2) * zoom,
    zoom,
  }
}
export type Segment = { start: Point2D; end: Point2D }
export type WallEndpoint = {
  wallId: string
  endpoint: 'start' | 'end'
  point: Point2D
}
export type RulerTick = { value: number; screen: number }

export function logicalToScreen(point: Point2D, viewport: Viewport): Point2D {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }
}

export function screenToLogical(point: Point2D, viewport: Viewport): Point2D {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function segmentLength(segment: Segment): number {
  return distance(segment.start, segment.end)
}

export function pointOnSegment(segment: Segment, offset: number): Point2D {
  const length = segmentLength(segment)
  if (length === 0) return segment.start
  const ratio = offset / length
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  }
}

/** 墙体中心线的中点（家居语义吸附候选之一）。 */
export function wallMidpoint(wall: Segment): Point2D {
  return { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
}

/** 门窗沿墙的中心点与两端开口边缘（世界坐标），用于门窗语义吸附。 */
export function openingAnchorPoints(
  wall: Segment,
  opening: { offset: number; width: number },
): { center: Point2D; start: Point2D; end: Point2D } {
  return {
    center: pointOnSegment(wall, opening.offset + opening.width / 2),
    start: pointOnSegment(wall, opening.offset),
    end: pointOnSegment(wall, opening.offset + opening.width),
  }
}

/** 线段的屏幕/几何角度，返回 [0, 360) 的度数。 */
export function segmentAngleDegrees(segment: Segment): number {
  const degrees = (Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x) * 180) / Math.PI
  return (degrees + 360) % 360
}

/** 从一个端点按给定长度与角度推算另一个端点（用于墙体长度/角度精确输入）。 */
export function wallFromLengthAngle(start: Point2D, length: number, angleDeg: number): Point2D {
  const radians = (angleDeg * Math.PI) / 180
  return { x: start.x + Math.cos(radians) * length, y: start.y + Math.sin(radians) * length }
}

/** 把角度归一化到 [0, 360) 并吸附到最近的 `stepDeg` 步进（默认 15°，用于旋转吸附）。 */
export function snapAngleStep(degrees: number, stepDeg = 15): number {
  const normalized = ((degrees % 360) + 360) % 360
  if (stepDeg <= 0) return normalized
  const snapped = Math.round(normalized / stepDeg) * stepDeg
  return ((snapped % 360) + 360) % 360
}

/* ------------------------------------------------------------------ *
 * 家具包围盒与多选对齐 / 等间距（《家居设计平台改进建议》五、七）
 * ------------------------------------------------------------------ */

export type FurnitureLike = {
  id: string
  position: Point2D
  width: number
  depth: number
  rotation: number
}

export type FurnitureBox = {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

function rotateBy(x: number, y: number, degrees: number): Point2D {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/** 旋转家具在世界坐标下的轴对齐包围盒（与画布一致的旋转中心/方向）。 */
export function furnitureBox(item: FurnitureLike): FurnitureBox {
  const corners = [
    { x: -item.width / 2, y: -item.depth / 2 },
    { x: item.width / 2, y: -item.depth / 2 },
    { x: item.width / 2, y: item.depth / 2 },
    { x: -item.width / 2, y: item.depth / 2 },
  ].map((corner) => {
    const rotated = rotateBy(corner.x, corner.y, item.rotation)
    return { x: item.position.x + rotated.x, y: item.position.y + rotated.y }
  })
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'

/** 多选对齐：返回每个家具应有的新位置（只平移，不改尺寸/旋转）。 */
export function alignFurniture(items: FurnitureLike[], mode: AlignMode): Array<{ id: string; position: Point2D }> {
  if (items.length < 2) return []
  const boxes = items.map((item) => ({ item, box: furnitureBox(item) }))
  const target =
    mode === 'left'
      ? Math.min(...boxes.map((entry) => entry.box.left))
      : mode === 'right'
        ? Math.max(...boxes.map((entry) => entry.box.right))
        : mode === 'top'
          ? Math.min(...boxes.map((entry) => entry.box.top))
          : mode === 'bottom'
            ? Math.max(...boxes.map((entry) => entry.box.bottom))
            : mode === 'center-x'
              ? boxes.reduce((sum, entry) => sum + entry.box.centerX, 0) / boxes.length
              : boxes.reduce((sum, entry) => sum + entry.box.centerY, 0) / boxes.length
  return boxes.map(({ item, box }) => {
    const dx =
      mode === 'left' ? target - box.left : mode === 'right' ? target - box.right : mode === 'center-x' ? target - box.centerX : 0
    const dy =
      mode === 'top' ? target - box.top : mode === 'bottom' ? target - box.bottom : mode === 'center-y' ? target - box.centerY : 0
    return { id: item.id, position: { x: item.position.x + dx, y: item.position.y + dy } }
  })
}

/** 等间距分布：首尾不动，中间项按“间隙相等”重排（沿 x 用宽度，沿 y 用深度）。 */
export function distributeFurniture(
  items: FurnitureLike[],
  axis: 'x' | 'y',
): Array<{ id: string; position: Point2D }> {
  if (items.length < 3) return []
  const boxes = items.map((item) => ({ item, box: furnitureBox(item) }))
  const sorted = [...boxes].sort((a, b) => (axis === 'x' ? a.box.left - b.box.left : a.box.top - b.box.top))
  const span = axis === 'x' ? sorted[sorted.length - 1].box.right - sorted[0].box.left : sorted[sorted.length - 1].box.bottom - sorted[0].box.top
  const total = sorted.reduce((sum, entry) => sum + (axis === 'x' ? entry.item.width : entry.item.depth), 0)
  const gap = (span - total) / (sorted.length - 1)
  const startEdge = axis === 'x' ? sorted[0].box.left : sorted[0].box.top
  let cursor = startEdge
  return sorted.map(({ item, box }) => {
    const delta = axis === 'x' ? cursor - box.left : cursor - box.top
    const position =
      axis === 'x' ? { x: item.position.x + delta, y: item.position.y } : { x: item.position.x, y: item.position.y + delta }
    cursor += (axis === 'x' ? item.width : item.depth) + gap
    return { id: item.id, position }
  })
}

export function projectPointToSegment(
  point: Point2D,
  segment: Segment,
): { point: Point2D; offset: number; distance: number } {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { point: segment.start, offset: 0, distance: distance(point, segment.start) }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared),
  )
  const projected = { x: segment.start.x + dx * t, y: segment.start.y + dy * t }
  return { point: projected, offset: Math.sqrt(lengthSquared) * t, distance: distance(point, projected) }
}

/** 判断点是否落在多边形边上（含端点），用于把贴墙的房间边界算作“区域内”。 */
export function pointOnPolygonBoundary(point: Point2D, polygon: Point2D[], tolerance = 0.5): boolean {
  if (polygon.length < 2) return false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    if (projectPointToSegment(point, { start: polygon[previous], end: polygon[index] }).distance <= tolerance) {
      return true
    }
  }
  return false
}

/** 射线法判断点是否在多边形内部；边界点返回 false，需要时配合 pointOnPolygonBoundary 使用。 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** 区域选择用：内部或边界都算选中，避免恰好压线的墙/家具被漏掉。 */
export function pointInPolygonInclusive(point: Point2D, polygon: Point2D[], tolerance = 0.5): boolean {
  return pointOnPolygonBoundary(point, polygon, tolerance) || pointInPolygon(point, polygon)
}

/** 轴对齐矩形（框选范围），坐标与墙体/家具一致，单位 cm。 */
export type Rect = { minX: number; minY: number; maxX: number; maxY: number }

/** 由框选的两个角点构造规范化矩形（支持任意拖动方向）。 */
export function rectFromPoints(a: Point2D, b: Point2D): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

export function pointInRect(point: Point2D, rect: Rect): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
}

/** 两个矩形是否相交（含边界接触），用于家具包围盒与框选范围的判定。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function crossProduct(origin: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function pointOnSegmentTolerant(point: Point2D, segment: Segment, epsilon = 1e-9): boolean {
  if (Math.abs(crossProduct(segment.start, segment.end, point)) > epsilon) return false
  return (
    point.x >= Math.min(segment.start.x, segment.end.x) - epsilon &&
    point.x <= Math.max(segment.start.x, segment.end.x) + epsilon &&
    point.y >= Math.min(segment.start.y, segment.end.y) - epsilon &&
    point.y <= Math.max(segment.start.y, segment.end.y) + epsilon
  )
}

/** 两条线段是否相交（含端点接触与共线重叠），框选用：墙只有一部分落在框内也算选中。 */
export function segmentsIntersect(a: Segment, b: Segment): boolean {
  const d1 = crossProduct(b.start, b.end, a.start)
  const d2 = crossProduct(b.start, b.end, a.end)
  const d3 = crossProduct(a.start, a.end, b.start)
  const d4 = crossProduct(a.start, a.end, b.end)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return (
    pointOnSegmentTolerant(a.start, b) ||
    pointOnSegmentTolerant(a.end, b) ||
    pointOnSegmentTolerant(b.start, a) ||
    pointOnSegmentTolerant(b.end, a)
  )
}

/** 线段与矩形是否相交（端点在框内，或穿过任意一条边）。 */
export function segmentIntersectsRect(segment: Segment, rect: Rect): boolean {
  if (pointInRect(segment.start, rect) || pointInRect(segment.end, rect)) return true
  const edges: Segment[] = [
    { start: { x: rect.minX, y: rect.minY }, end: { x: rect.maxX, y: rect.minY } },
    { start: { x: rect.maxX, y: rect.minY }, end: { x: rect.maxX, y: rect.maxY } },
    { start: { x: rect.maxX, y: rect.maxY }, end: { x: rect.minX, y: rect.maxY } },
    { start: { x: rect.minX, y: rect.maxY }, end: { x: rect.minX, y: rect.minY } },
  ]
  return edges.some((edge) => segmentsIntersect(segment, edge))
}

/** 多边形与矩形是否相交：顶点在框内、框角在多边形内、或边线穿过矩形。 */
export function polygonIntersectsRect(polygon: Point2D[], rect: Rect): boolean {
  if (polygon.length < 2) return false
  if (polygon.some((point) => pointInRect(point, rect))) return true
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
  if (corners.some((corner) => pointInPolygonInclusive(corner, polygon))) return true
  for (let index = 0; index < polygon.length; index += 1) {
    const edge = { start: polygon[index], end: polygon[(index + 1) % polygon.length] }
    if (segmentIntersectsRect(edge, rect)) return true
  }
  return false
}

export function snapToGrid(point: Point2D, gridSize: number): Point2D {
  if (gridSize <= 0) return point
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize }
}

export function snapToPoints(point: Point2D, candidates: Point2D[], threshold: number): Point2D {
  let closest = point
  let closestDistance = threshold
  for (const candidate of candidates) {
    const candidateDistance = distance(point, candidate)
    if (candidateDistance <= closestDistance) {
      closest = candidate
      closestDistance = candidateDistance
    }
  }
  return closest
}

export function snapToWallEndpoints(
  point: Point2D,
  candidates: Point2D[],
  viewport: Viewport,
  gridSize: number,
  gridEnabled: boolean,
  screenThreshold = 8,
): Point2D {
  const endpoint = snapToPoints(point, candidates, screenThreshold / viewport.zoom)
  if (endpoint !== point) return endpoint
  return gridEnabled ? snapToGrid(point, gridSize) : point
}

export function snapOrthogonalPoint(
  origin: Point2D,
  point: Point2D,
  candidates: Point2D[],
  viewport: Viewport,
  gridSize: number,
  gridEnabled: boolean,
): Point2D {
  const horizontal = Math.abs(point.x - origin.x) >= Math.abs(point.y - origin.y)
  const project = (target: Point2D): Point2D =>
    horizontal ? { x: target.x, y: origin.y } : { x: origin.x, y: target.y }
  // Only endpoints on the locked axis may attract the cursor. Project again
  // after grid snapping to preserve an origin that is not on the grid.
  const aligned = candidates.filter((candidate) =>
    horizontal ? Math.abs(candidate.y - origin.y) < 1e-6 : Math.abs(candidate.x - origin.x) < 1e-6,
  )
  return project(snapToWallEndpoints(project(point), aligned, viewport, gridSize, gridEnabled))
}

/** A wall-shaped object that snapping can reference (only geometry is needed). */
export type WallLike = { id: string; start: Point2D; end: Point2D }

export type ObjectSnapKind = 'endpoint' | 'body'
export type ObjectSnap = { point: Point2D; kind: ObjectSnapKind; wallId?: string }

/** Snap to nearby wall endpoints first, then to a wall's centerline (body). */
export function snapToWallGeometry(
  point: Point2D,
  walls: WallLike[],
  viewport: Viewport,
  screenThreshold = 12,
  options: {
    excludeWallId?: string
    excludeEndpoint?: 'start' | 'end'
    extraPoints?: Point2D[]
  } = {},
): ObjectSnap | null {
  const threshold = screenThreshold / Math.max(viewport.zoom, Number.EPSILON)
  let bestPoint: Point2D | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestWallId: string | undefined
  let bestKind: ObjectSnapKind = 'endpoint'
  // Endpoints always win over body projections, even when the body happens to be a hair closer.
  for (const wall of walls) {
    for (const key of ['start', 'end'] as const) {
      if (wall.id === options.excludeWallId && options.excludeEndpoint === key) continue
      const candidateDistance = distance(point, wall[key])
      if (candidateDistance <= threshold && candidateDistance < bestDistance) {
        bestPoint = wall[key]
        bestDistance = candidateDistance
        bestWallId = wall.id
        bestKind = 'endpoint'
      }
    }
  }
  for (const candidate of options.extraPoints ?? []) {
    const candidateDistance = distance(point, candidate)
    if (candidateDistance <= threshold && candidateDistance < bestDistance) {
      bestPoint = candidate
      bestDistance = candidateDistance
      bestWallId = undefined
      bestKind = 'endpoint'
    }
  }
  if (bestPoint) return { point: bestPoint, kind: bestKind, wallId: bestWallId }
  // Fall back to the nearest point on any wall centerline so walls can form clean T/L junctions.
  for (const wall of walls) {
    if (wall.id === options.excludeWallId) continue
    const projection = projectPointToSegment(point, wall)
    if (projection.distance <= threshold && projection.distance < bestDistance) {
      bestPoint = projection.point
      bestDistance = projection.distance
      bestWallId = wall.id
      bestKind = 'body'
    }
  }
  return bestPoint ? { point: bestPoint, kind: bestKind, wallId: bestWallId } : null
}

export type FreeSnapKind = ObjectSnapKind | 'grid' | 'none'

/** Snap to wall geometry first, then to the grid. Respects the magnet toggle via the caller. */
export function snapToWallsAndGrid(
  point: Point2D,
  walls: WallLike[],
  viewport: Viewport,
  gridSize: number,
  gridEnabled: boolean,
  screenThreshold = 12,
  options: {
    excludeWallId?: string
    excludeEndpoint?: 'start' | 'end'
    extraPoints?: Point2D[]
  } = {},
): { point: Point2D; kind: FreeSnapKind; wallId?: string } {
  const object = snapToWallGeometry(point, walls, viewport, screenThreshold, options)
  if (object) return object
  if (gridEnabled) return { point: snapToGrid(point, gridSize), kind: 'grid' }
  return { point, kind: 'none' }
}

/** Project a point onto the nearest ray of `stepDeg` degrees when within the tolerance. */
export function constrainToAngle(start: Point2D, point: Point2D, stepDeg: number, toleranceDeg: number): Point2D {
  if (stepDeg <= 0) return point
  const dx = point.x - start.x
  const dy = point.y - start.y
  if (Math.hypot(dx, dy) < 1e-6) return point
  const angle = Math.atan2(dy, dx)
  const step = (stepDeg * Math.PI) / 180
  const nearest = Math.round(angle / step) * step
  let diff = Math.abs(angle - nearest)
  if (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI)
  if (diff > (toleranceDeg * Math.PI) / 180) return point
  const along = dx * Math.cos(nearest) + dy * Math.sin(nearest)
  return { x: start.x + Math.cos(nearest) * along, y: start.y + Math.sin(nearest) * along }
}

export type DrawSnapKind = ObjectSnapKind | 'angle' | 'grid' | 'none'

/**
 * Snapping used while drawing a brand-new wall:
 * object snap (endpoints / centerlines) > auto angle lock > grid.
 */
export function snapWallDrawPoint(
  start: Point2D,
  point: Point2D,
  walls: WallLike[],
  viewport: Viewport,
  gridSize: number,
  gridEnabled: boolean,
  options: {
    screenThreshold?: number
    extraPoints?: Point2D[]
    angleStepDeg?: number
    angleToleranceDeg?: number
  } = {},
): { point: Point2D; kind: DrawSnapKind; wallId?: string } {
  const object = snapToWallGeometry(point, walls, viewport, options.screenThreshold ?? 12, {
    extraPoints: options.extraPoints,
  })
  if (object) return object
  const angled = constrainToAngle(start, point, options.angleStepDeg ?? 0, options.angleToleranceDeg ?? 0)
  const isAngled = angled !== point
  const base = isAngled ? angled : point
  if (!gridEnabled || gridSize <= 0) return { point: base, kind: isAngled ? 'angle' : 'none' }
  if (!isAngled) return { point: snapToGrid(base, gridSize), kind: 'grid' }
  // Keep the point on the locked ray while snapping its spacing to the grid.
  const length = distance(start, base)
  const snappedLength = Math.max(gridSize, Math.round(length / gridSize) * gridSize)
  const dir = length < 1e-9 ? { x: 1, y: 0 } : { x: (base.x - start.x) / length, y: (base.y - start.y) / length }
  return { point: { x: start.x + dir.x * snappedLength, y: start.y + dir.y * snappedLength }, kind: 'angle' }
}

/* ------------------------------------------------------------------ *
 * 统一吸附引擎（《家居设计平台改进建议》三.1 ~ 三.4、十一）
 * 目标：类型化候选 + 吸附优先级 + 8px 进入 / 14px 释放滞后，避免抖动。
 * ------------------------------------------------------------------ */

export type SnapKind =
  | 'wall-vertex' // 墙体端点
  | 'wall-intersection' // 墙体交点
  | 'room-corner' // 房间角点
  | 'wall-midpoint' // 墙体中点
  | 'furniture-corner' // 家具角点
  | 'opening-center' // 门窗中心
  | 'opening-edge' // 门窗开口边缘
  | 'furniture-center' // 家具中心
  | 'furniture-edge-mid' // 家具边中点
  | 'wall-line' // 墙体中心线（线吸附）
  | 'edge-line' // 水平/垂直对齐线
  | 'distance' // 标准间距吸附（10/30/60cm）
  | 'grid'
  | 'none'

/** 数值越大越优先；网格永远最低，不能抢走语义点。 */
export const SNAP_PRIORITY: Record<SnapKind, number> = {
  'wall-vertex': 100,
  'wall-intersection': 95,
  'room-corner': 90,
  'wall-midpoint': 87,
  'furniture-corner': 85,
  'opening-center': 80,
  'opening-edge': 78,
  'furniture-center': 75,
  'furniture-edge-mid': 70,
  'wall-line': 60,
  'edge-line': 45,
  distance: 40,
  grid: 10,
  none: 0,
}

export const SNAP_ENTER_PX = 8
export const SNAP_RELEASE_PX = 14

export type PointAnchor = {
  id: string
  kind: SnapKind
  point: Point2D
  priority?: number
  label?: string
  sourceId?: string
}

export type LineAnchor = {
  id: string
  kind: SnapKind
  segment: Segment
  priority?: number
  label?: string
  sourceId?: string
}

/** 可吸附的几何锚点：点（端点/角点/中心）或线段（墙体中心线）。 */
export type SnapAnchor = PointAnchor | LineAnchor

export type AxisAnchor = {
  id: string
  axis: 'x' | 'y'
  value: number
  kind: SnapKind
  priority?: number
  label?: string
  sourceId?: string
}

type ResolvedAnchor = {
  anchor: SnapAnchor
  snapPoint: Point2D
  px: number
  priority: number
  label: string
}

function anchorProjection(point: Point2D, anchor: SnapAnchor): { point: Point2D; distance: number } {
  if ('segment' in anchor) {
    const projection = projectPointToSegment(point, anchor.segment)
    return { point: projection.point, distance: projection.distance }
  }
  return { point: anchor.point, distance: distance(point, anchor.point) }
}

function priorityOf(kind: SnapKind, explicit?: number): number {
  return explicit ?? SNAP_PRIORITY[kind] ?? 0
}

/** 更高优先级的候选可以抢占当前目标：同级看距离，跨优先级层级（≥10）可略远一点。 */
function canChallenge(
  currentPx: number,
  currentPriority: number,
  itemPx: number,
  itemPriority: number,
  enterPx: number,
): boolean {
  if (itemPx > enterPx || itemPriority <= currentPriority) return false
  return itemPriority - currentPriority >= 10 || itemPx < currentPx - 1
}

/** 在“释放阈值”内保留当前目标，只有出现明显更优（更高优先级且更近）的目标才切换，防止抖动。 */
function pickAnchor(
  resolved: ResolvedAnchor[],
  currentId: string | null | undefined,
  enterPx: number,
  releasePx: number,
): ResolvedAnchor | null {
  const current = currentId ? resolved.find((item) => item.anchor.id === currentId) ?? null : null
  if (current && current.px <= releasePx) {
    const challenger = resolved
      .filter(
        (item) =>
          item.anchor.id !== current.anchor.id &&
          canChallenge(current.px, current.priority, item.px, item.priority, enterPx),
      )
      .sort((a, b) => b.priority - a.priority || a.px - b.px)[0]
    return challenger ?? current
  }
  return resolved.filter((item) => item.px <= enterPx).sort((a, b) => b.priority - a.priority || a.px - b.px)[0] ?? null
}

export type PointSnapResult = {
  point: Point2D
  kind: SnapKind
  anchorId: string | null
  label: string
  target: Point2D | null
  sourceId?: string
}

export type PointSnapOptions = {
  enterPx?: number
  releasePx?: number
  currentId?: string | null
  gridSize?: number
  gridEnabled?: boolean
}

/** 点吸附（墙体绘制/端点拖动/房间顶点）：墙体语义点 > 角点/中心 > 线投影 > 网格。 */
export function resolvePointSnap(
  point: Point2D,
  anchors: SnapAnchor[],
  viewport: Viewport,
  options: PointSnapOptions = {},
): PointSnapResult {
  const enterPx = options.enterPx ?? SNAP_ENTER_PX
  const releasePx = options.releasePx ?? SNAP_RELEASE_PX
  const zoom = Math.max(viewport.zoom, Number.EPSILON)
  const resolved: ResolvedAnchor[] = anchors.map((anchor) => {
    const projection = anchorProjection(point, anchor)
    return {
      anchor,
      snapPoint: projection.point,
      px: projection.distance * zoom,
      priority: priorityOf(anchor.kind, anchor.priority),
      label: anchor.label ?? '',
    }
  })
  const chosen = pickAnchor(resolved, options.currentId, enterPx, releasePx)
  if (chosen) {
    return {
      point: chosen.snapPoint,
      kind: chosen.anchor.kind,
      anchorId: chosen.anchor.id,
      label: chosen.label,
      target: chosen.snapPoint,
      sourceId: chosen.anchor.sourceId,
    }
  }
  if (options.gridEnabled && options.gridSize && options.gridSize > 0) {
    return { point: snapToGrid(point, options.gridSize), kind: 'grid', anchorId: null, label: '网格', target: null }
  }
  return { point, kind: 'none', anchorId: null, label: '', target: null }
}

function nearestDelta(moving: number[], value: number): number {
  let bestDelta = 0
  let best = Number.POSITIVE_INFINITY
  for (const item of moving) {
    const delta = value - item
    if (Math.abs(delta) < best) {
      best = Math.abs(delta)
      bestDelta = delta
    }
  }
  return bestDelta
}

type ResolvedAxis = {
  id: string
  /** 参考边缘坐标（辅助线画在这里） */
  value: number
  kind: SnapKind
  label?: string
  px: number
  delta: number
  priority: number
}

function pickAxis(
  resolved: ResolvedAxis[],
  currentId: string | null | undefined,
  enterPx: number,
  releasePx: number,
): ResolvedAxis | null {
  const current = currentId ? resolved.find((item) => item.id === currentId) ?? null : null
  if (current && current.px <= releasePx) {
    const challenger = resolved
      .filter(
        (item) =>
          item.id !== current.id && canChallenge(current.px, current.priority, item.px, item.priority, enterPx),
      )
      .sort((a, b) => b.priority - a.priority || a.px - b.px)[0]
    return challenger ?? current
  }
  return resolved.filter((item) => item.px <= enterPx).sort((a, b) => b.priority - a.priority || a.px - b.px)[0] ?? null
}

export type AxisSnapResult = {
  dx: number
  dy: number
  xKind: SnapKind
  yKind: SnapKind
  xId: string | null
  yId: string | null
  guideXs: number[]
  guideYs: number[]
  labels: string[]
}

export type AxisSnapOptions = {
  enterPx?: number
  releasePx?: number
  currentXId?: string | null
  currentYId?: string | null
  gridSize?: number
  gridEnabled?: boolean
  /** 标准间距（cm），如 [10, 30, 60]；为空时只做 0 间距对齐。 */
  gaps?: number[]
}

/** 轴向吸附（家具拖动）：边缘对齐 > 标准间距 > 网格；x/y 各自独立且带滞后。 */
export function resolveAxisSnap(
  values: { xs: number[]; ys: number[] },
  anchors: AxisAnchor[],
  viewport: Viewport,
  options: AxisSnapOptions = {},
): AxisSnapResult {
  const enterPx = options.enterPx ?? SNAP_ENTER_PX
  const releasePx = options.releasePx ?? SNAP_RELEASE_PX
  const zoom = Math.max(viewport.zoom, Number.EPSILON)
  const gaps = options.gaps ?? []
  const resolveAxis = (axis: 'x' | 'y', moving: number[], currentId?: string | null) => {
    const resolved: ResolvedAxis[] = []
    for (const anchor of anchors) {
      if (anchor.axis !== axis) continue
      let best = Number.POSITIVE_INFINITY
      for (const value of moving) best = Math.min(best, Math.abs(anchor.value - value))
      resolved.push({
        id: anchor.id,
        value: anchor.value,
        kind: anchor.kind,
        label: anchor.label,
        px: best * zoom,
        delta: nearestDelta(moving, anchor.value),
        priority: priorityOf(anchor.kind, anchor.priority),
      })
      // 标准间距：家具边缘距离参考边缘 10/30/60cm 等。
      for (const gap of gaps) {
        if (gap <= 0) continue
        for (const sign of [1, -1] as const) {
          const target = anchor.value + sign * gap
          let bestGap = Number.POSITIVE_INFINITY
          for (const value of moving) bestGap = Math.min(bestGap, Math.abs(target - value))
          resolved.push({
            id: `distance:${anchor.id}:${sign}:${gap}`,
            value: anchor.value,
            kind: 'distance',
            label: `间距 ${gap}cm`,
            px: bestGap * zoom,
            delta: nearestDelta(moving, target),
            priority: SNAP_PRIORITY.distance,
          })
        }
      }
    }
    return pickAxis(resolved, currentId, enterPx, releasePx)
  }
  const x = resolveAxis('x', values.xs, options.currentXId)
  const y = resolveAxis('y', values.ys, options.currentYId)
  const gridEnabled = Boolean(options.gridEnabled && options.gridSize && options.gridSize > 0)
  const grid = options.gridSize ?? 0
  let dx = x?.delta ?? 0
  let dy = y?.delta ?? 0
  let xKind: SnapKind = x ? x.kind : 'none'
  let yKind: SnapKind = y ? y.kind : 'none'
  if (!x && gridEnabled) {
    dx = Math.round(values.xs[0] / grid) * grid - values.xs[0]
    xKind = 'grid'
  }
  if (!y && gridEnabled) {
    dy = Math.round(values.ys[0] / grid) * grid - values.ys[0]
    yKind = 'grid'
  }
  const labels: string[] = []
  if (x?.label) labels.push(x.label)
  if (y?.label) labels.push(y.label)
  return {
    dx,
    dy,
    xKind,
    yKind,
    xId: x ? x.id : null,
    yId: y ? y.id : null,
    guideXs: x ? [x.value] : [],
    guideYs: y ? [y.value] : [],
    labels,
  }
}

export function findOpenWallEndpoints(
  walls: Array<{ id: string; start: Point2D; end: Point2D }>,
  tolerance = 0.2,
): WallEndpoint[] {
  const endpoints = walls.flatMap<WallEndpoint>((wall) => [
    { wallId: wall.id, endpoint: 'start', point: wall.start },
    { wallId: wall.id, endpoint: 'end', point: wall.end },
  ])
  const connected = (point: Point2D, wallId: string): boolean =>
    walls.some((wall) => {
      if (wall.id === wallId) return false
      // 端点与另一堵墙的端点重合，或落在另一堵墙的墙身上（T 型 / 十字接点）。
      // 识别出来的户型图端点会按 0.1cm 取整，T 型接点也不在对方端点上，
      // 只用"端点对端点 + 1e-6"会把正常闭合的墙全部误判成开口（画布上满屏橙点）。
      if (distance(point, wall.start) <= tolerance || distance(point, wall.end) <= tolerance) {
        return true
      }
      return pointNearSegment(point, wall.start, wall.end, tolerance)
    })
  return endpoints.filter((endpoint) => !connected(endpoint.point, endpoint.wallId))
}

/** 点到线段的距离是否在容差内（含端点外延容差）。 */
function pointNearSegment(point: Point2D, start: Point2D, end: Point2D, tolerance: number): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) return distance(point, start) <= tolerance
  const raw = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const t = Math.max(0, Math.min(1, raw))
  const projectionX = start.x + t * dx
  const projectionY = start.y + t * dy
  return Math.hypot(point.x - projectionX, point.y - projectionY) <= tolerance
}

export function rulerStepForZoom(zoom: number, minimumScreenSpacing = 64): number {
  const minimumLogicalSpacing = minimumScreenSpacing / Math.max(zoom, Number.EPSILON)
  const magnitude = 10 ** Math.floor(Math.log10(minimumLogicalSpacing))
  const normalized = minimumLogicalSpacing / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

export function axisRulerTicks(size: number, offset: number, zoom: number, step: number): RulerTick[] {
  if (size <= 0 || zoom <= 0 || step <= 0) return []
  const logicalStart = -offset / zoom
  const logicalEnd = (size - offset) / zoom
  const first = Math.ceil(logicalStart / step) * step
  const ticks: RulerTick[] = []
  for (let value = first; value <= logicalEnd; value += step) {
    const normalizedValue = Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(12))
    ticks.push({ value: normalizedValue, screen: normalizedValue * zoom + offset })
  }
  return ticks
}
