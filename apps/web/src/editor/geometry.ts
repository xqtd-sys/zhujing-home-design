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

export function findOpenWallEndpoints(
  walls: Array<{ id: string; start: Point2D; end: Point2D }>,
  tolerance = 1e-6,
): WallEndpoint[] {
  const endpoints = walls.flatMap<WallEndpoint>((wall) => [
    { wallId: wall.id, endpoint: 'start', point: wall.start },
    { wallId: wall.id, endpoint: 'end', point: wall.end },
  ])
  return endpoints.filter(
    (endpoint, index) =>
      !endpoints.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && distance(endpoint.point, candidate.point) <= tolerance,
      ),
  )
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
