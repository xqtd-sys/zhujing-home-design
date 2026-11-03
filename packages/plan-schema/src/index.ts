import { z } from 'zod'

type Coordinate = { x: number; y: number }

export function polygonArea(points: Coordinate[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

function orientation(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: Coordinate, b: Coordinate, point: Coordinate): boolean {
  const epsilon = 1e-8
  return (
    Math.abs(orientation(a, b, point)) <= epsilon &&
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon
  )
}

function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0) return true
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

export function polygonSelfIntersects(points: Coordinate[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length
      if (first === second || firstNext === second || secondNext === first) continue
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true
    }
  }
  return false
}

export const Point2DSchema = z.object({
  x: z.number().finite().min(0).max(10000),
  y: z.number().finite().min(0).max(10000),
})

const MaterialIdSchema = z.string().min(1).max(64)
const EntityIdSchema = z.string().uuid()

const WallSchema = z
  .object({
    id: EntityIdSchema,
    start: Point2DSchema,
    end: Point2DSchema,
    thickness: z.number().finite().min(5).max(50),
    height: z.number().finite().min(200).max(500),
    materialId: MaterialIdSchema.optional(),
  })
  .refine((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) >= 10, {
    message: '墙体长度不能小于 10cm',
  })

const RoomSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(64),
    polygon: z.array(Point2DSchema).min(3).max(100),
    floorMaterialId: MaterialIdSchema.optional(),
  })
  .superRefine((room, context) => {
    const uniquePoints = new Set(room.polygon.map((point) => `${point.x},${point.y}`))
    if (uniquePoints.size !== room.polygon.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['polygon'], message: '房间顶点不能重复' })
    }
    if (polygonArea(room.polygon) === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['polygon'], message: '房间面积必须大于 0' })
    }
    if (polygonSelfIntersects(room.polygon)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['polygon'], message: '房间多边形不能自相交' })
    }
  })

export const PlanDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    unit: z.literal('cm'),
    settings: z.object({
      gridSize: z.number().finite().positive().max(1000),
      snapEnabled: z.boolean(),
      defaultWallHeight: z.number().finite().min(200).max(500),
      defaultWallThickness: z.number().finite().min(5).max(50),
      defaultWallMaterialId: MaterialIdSchema,
      defaultFloorMaterialId: MaterialIdSchema,
    }),
    walls: z.array(WallSchema).max(500),
    rooms: z.array(RoomSchema).max(100),
    openings: z
      .array(
        z.object({
          id: EntityIdSchema,
          wallId: EntityIdSchema,
          type: z.enum(['door', 'window']),
          offset: z.number().finite().nonnegative().max(20000),
          width: z.number().finite().min(20).max(500),
          height: z.number().finite().min(20).max(500),
          sillHeight: z.number().finite().nonnegative().max(500),
        }),
      )
      .max(500),
    furniture: z
      .array(
        z.object({
          id: EntityIdSchema,
          assetId: EntityIdSchema,
          position: Point2DSchema,
          rotation: z.number().finite().min(0).lt(360),
          width: z.number().finite().positive().max(2000),
          depth: z.number().finite().positive().max(2000),
          height: z.number().finite().positive().max(2000),
          locked: z.boolean(),
          zIndex: z.number().int().min(-100000).max(100000),
        }),
      )
      .max(1000),
  })
  .strict()
  .superRefine((document, context) => {
    const allIds = [
      ...document.walls.map((item) => item.id),
      ...document.rooms.map((item) => item.id),
      ...document.openings.map((item) => item.id),
      ...document.furniture.map((item) => item.id),
    ]
    if (new Set(allIds).size !== allIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '方案对象 ID 必须唯一' })
    }

    const walls = new Map(document.walls.map((wall) => [wall.id, wall]))
    for (const [index, opening] of document.openings.entries()) {
      const wall = walls.get(opening.wallId)
      if (!wall) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['openings', index, 'wallId'],
          message: '门窗引用的墙体不存在',
        })
        continue
      }
      const wallLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
      if (opening.offset + opening.width > wallLength) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', index], message: '门窗超出墙体范围' })
      }
      if (opening.sillHeight + opening.height > wall.height) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', index], message: '门窗高度超出墙体' })
      }
      if (opening.type === 'door' && opening.sillHeight !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['openings', index, 'sillHeight'],
          message: '门的窗台高度必须为 0',
        })
      }
    }

    const groupedOpenings = new Map<string, typeof document.openings>()
    for (const opening of document.openings) {
      const group = groupedOpenings.get(opening.wallId) ?? []
      group.push(opening)
      groupedOpenings.set(opening.wallId, group)
    }
    for (const openings of groupedOpenings.values()) {
      const sorted = [...openings].sort((a, b) => a.offset - b.offset)
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].offset < sorted[index - 1].offset + sorted[index - 1].width) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: '同一墙体上的门窗不能重叠' })
        }
      }
    }
  })

export type Point2D = z.infer<typeof Point2DSchema>
export type PlanDocument = z.infer<typeof PlanDocumentSchema>

export const EMPTY_PLAN_DOCUMENT: PlanDocument = {
  schemaVersion: 1,
  unit: 'cm',
  settings: {
    gridSize: 10,
    snapEnabled: true,
    defaultWallHeight: 280,
    defaultWallThickness: 20,
    defaultWallMaterialId: 'wall-white',
    defaultFloorMaterialId: 'floor-light',
  },
  walls: [],
  rooms: [],
  openings: [],
  furniture: [],
}
