/**
 * 顶视户型图识别（纯计算，不依赖 DOM / Canvas，可在 Node 里直接单测）。
 *
 * 输入是一张灰度图（由调用方用 Canvas 采样得到），输出是一套可以直接写进
 * PlanDocument 的墙体 / 房间 / 门。整条流水线都是确定性的像素运算：
 *
 *   灰度 → Otsu 二值化 → 横竖扫描找出粗线带 → 合并共线/双线 → 端点吸附
 *   → 按用户给的"总宽"换算 cm → 缺口识别成门 → 空白区域泛洪得到房间
 *
 * 明确的适用范围与限制：
 * - 只支持**顶视、正交**户型图（墙是水平/垂直的粗线）。斜墙、弧墙会被忽略。
 * - 不做透视校正：斜拍的照片、效果图不能反推平面尺寸。
 * - 文字/标注/家具符号靠"线长阈值"过滤，字体很大或家具线条很长时可能误判。
 * - 尺寸比例必须由调用方给出（图纸总宽），因为图片本身没有物理单位。
 */
import type { Point2D } from '@home-design/plan-schema'
import { countInk, openMask } from './plan-recognition-morph.ts'
import { bandsToSegments, extractBands } from './plan-recognition-lines.ts'
import type { Band, RawSegment } from './plan-recognition-lines.ts'
import { buildIntegral, segmentConfidence, selectWalls } from './plan-recognition-candidates.ts'
import type { Candidate } from './plan-recognition-candidates.ts'
import { closeOpenJunctions, clusterJunctions, splitTJunctions } from './plan-recognition-junctions.ts'
import { distanceTransform, mergeAdjacentRooms, multiScaleSeeds, watershedSeeds } from './plan-recognition-rooms.ts'
import { chooseWorkingMaskV2, enhanceContrast, estimateSkewAngle, rotateGray } from './plan-recognition-preprocess.ts'

// 底层掩膜操作和线带提取分别拆到了 plan-recognition-morph.ts / plan-recognition-lines.ts，
// 这里重新导出，保持对外 API 不变（测试和其它模块仍从本文件 import）。
export { closeMask, countInk, dilateMask, downsampleGray, erodeMask, openMask, removeSmallComponents } from './plan-recognition-morph.ts'
export { bandsToSegments, extractBands, findRuns } from './plan-recognition-lines.ts'
export type { Band, RawSegment } from './plan-recognition-lines.ts'

/** 灰度图：data 按行优先存储，0 = 黑，255 = 白。 */
export type GrayImage = { width: number; height: number; data: Uint8Array }

/** 二值墨迹图：1 = 墨迹（墙线），0 = 空白。 */
export type InkMask = { width: number; height: number; data: Uint8Array }

/** 像素坐标下的墙线：orientation 为 h 时 from/to 是 x、cross 是 y。 */
export type PixelSegment = { orientation: 'h' | 'v'; from: number; to: number; cross: number; thickness: number }

export type RecognizeOptions = {
  /** 识别结果的总宽（cm），用来标定比例；默认 1200（12 米）。 */
  targetWidthCm?: number
  /** 生成的墙体高度（cm），默认 280。 */
  wallHeight?: number
  /** 是否把空白区域识别成房间，默认 true。 */
  detectRooms?: boolean
  /** 是否把共线墙之间的缺口识别成门，默认 true。 */
  detectDoors?: boolean
  /** 最小墙长（像素）；不传按图幅自动取短边的 2%。 */
  minWallLengthPx?: number
  /** 二值化阈值（0-255）；不传用 Otsu 自动阈值。 */
  threshold?: number
  /** 双线墙合并距离（像素），默认 14。 */
  mergeDoubleLinesPx?: number
  /** 房间最小面积（cm²），默认 15000（1.5㎡）。 */
  minRoomAreaCm2?: number
  /** 是否把图里的家具符号识别成家具，默认 true。 */
  detectFurniture?: boolean
  /**
   * 可用的家具素材库（用于把识别出的家具外框映射到具体素材）。
   * 不传时用内置的 4 个基础素材（沙发/床/餐桌/柜子，与种子数据同一批 UUID）。
   */
  furnitureAssets?: RecognizeAsset[]
  /** 自动摆正：估计倾斜角并旋转（仅 |angle|>0.7° 才真正旋转），默认 true。 */
  autoDeskew?: boolean
  /** 是否先用 CLAHE 做局部对比度增强，默认 false（电子线稿不需要，手机照片可开）。 */
  enhanceContrast?: boolean
  /** 工作掩膜策略：'v1' 只用开运算（旧行为）；'auto' 三策略打分（默认）。 */
  maskStrategy?: 'v1' | 'auto'
  /** 候选图全局择优（去重复墙/去假交叉），默认 true。 */
  dedupeWalls?: boolean
  /** 墙节点聚类 + 开口闭合（消橙点），默认 true。 */
  joinWalls?: boolean
  /** T 型拆分（把穿过 T 接的墙在交点处打断），默认 false（会改变墙段数量）。 */
  splitJunctions?: boolean
  /** 房间分割模式：'watershed' 距离场分水岭（新，默认）；'flood' 旧泛洪。 */
  roomSegmentation?: 'watershed' | 'flood'
}

/** 家具素材的最小信息，用来把识别出的家具框映射到素材。 */
export type RecognizeAsset = {
  id: string
  name: string
  baseWidth: number
  baseDepth: number
  baseHeight: number
}

/** 识别出的家具，字段与 PlanDocument.furniture 一一对应。 */
export type RecognizedFurniture = {
  id: string
  assetId: string
  name: string
  position: Point2D
  rotation: number
  width: number
  depth: number
  height: number
  locked: boolean
  zIndex: number
}

/** 内置家具素材，UUID 与 `CreateFurnitureCatalog` 迁移里的种子数据一致。 */
const DEFAULT_FURNITURE_ASSETS: RecognizeAsset[] = [
  { id: 'a1111111-1111-4111-8111-111111111111', name: '沙发', baseWidth: 200, baseDepth: 90, baseHeight: 85 },
  { id: 'a2222222-2222-4222-8222-222222222222', name: '床', baseWidth: 180, baseDepth: 200, baseHeight: 55 },
  { id: 'a3333333-3333-4333-8333-333333333333', name: '餐桌', baseWidth: 140, baseDepth: 80, baseHeight: 75 },
  { id: 'a4444444-4444-4444-8444-444444444444', name: '柜子', baseWidth: 120, baseDepth: 45, baseHeight: 200 },
]

export type RecognizedWall = { id: string; start: Point2D; end: Point2D; thickness: number; height: number }
export type RecognizedRoom = { id: string; name: string; polygon: Point2D[] }
export type RecognizedOpening = {
  id: string
  wallId: string
  type: 'door'
  offset: number
  width: number
  height: number
  sillHeight: number
}

export type RecognizedFloorplan = {
  walls: RecognizedWall[]
  rooms: RecognizedRoom[]
  openings: RecognizedOpening[]
  furniture: RecognizedFurniture[]
  /** 最终的墙线（像素坐标），用于导入预览叠加绘制。 */
  segments: PixelSegment[]
  /** 墙体包围盒（像素）。 */
  bounds: { left: number; right: number; top: number; bottom: number }
  /** 把原始图片铺到画布上时用的 cm 坐标（可直接当参考底图）。 */
  transform: { x: number; y: number; width: number; height: number; scale: number; rotation: number }
  stats: {
    wallCount: number
    roomCount: number
    openingCount: number
    furnitureCount: number
    widthCm: number
    heightCm: number
    thicknessCm: number
  }
  warnings: string[]
}

const MARGIN_CM = 100
const MIN_WALL_LENGTH_CM = 10
const MIN_WALL_THICKNESS_CM = 5
const MAX_WALL_THICKNESS_CM = 50
const DEFAULT_WALL_HEIGHT_CM = 280
const MIN_DOOR_CM = 45
const MAX_DOOR_CM = 260
const MAX_POLYGON_POINTS = 100
const MAX_COORD_CM = 10000

/* ------------------------------------------------------------------ 基础图像 */

/** RGBA 转灰度；半透明像素按白底合成，避免透明背景被当成墨迹。 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let index = 0, offset = 0; index < data.length; index += 1, offset += 4) {
    const alpha = rgba[offset + 3]
    if (alpha === 0) {
      data[index] = 255
      continue
    }
    const luminance = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]
    data[index] = Math.round(alpha === 255 ? luminance : (luminance * alpha + 255 * (255 - alpha)) / 255)
  }
  return { width, height, data }
}

/** Otsu 自动阈值：让前景/背景两类像素的类间方差最大。 */
export function otsuThreshold(gray: GrayImage): number {
  const histogram = new Array<number>(256).fill(0)
  let total = 0
  let sum = 0
  for (const value of gray.data) {
    histogram[value] += 1
    total += 1
    sum += value
  }
  let sumBackground = 0
  let weightBackground = 0
  let bestThreshold = 128
  let bestVariance = -1
  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break
    sumBackground += level * histogram[level]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      bestThreshold = level
    }
  }
  return bestThreshold
}

/** 二值化：默认"深色是墙"。整图偏暗（深色底）时自动反相。 */
export function binarize(gray: GrayImage, threshold?: number): InkMask {
  const cut = threshold ?? otsuThreshold(gray)
  const data = new Uint8Array(gray.width * gray.height)
  let ink = 0
  for (let index = 0; index < data.length; index += 1) {
    if (gray.data[index] <= cut) {
      data[index] = 1
      ink += 1
    }
  }
  if (data.length > 0 && ink / data.length > 0.5) {
    // 深色背景 + 浅色线条的图纸：反相后统一成"墨迹为 1"。
    for (let index = 0; index < data.length; index += 1) data[index] = data[index] ? 0 : 1
  }
  return { width: gray.width, height: gray.height, data }
}

/* countInk / openMask 等底层掩膜操作已迁移到 plan-recognition-morph.ts（见文件顶部 re-export）。 */

/* ------------------------------------------------------------------ 线带提取 */

/* RawSegment 与 bandsToSegments 已迁移到 plan-recognition-lines.ts（见文件顶部 re-export）。 */

/** 合并同一条线上的碎段（文字/交叉把墙打断成几截时用）。 */
export function mergeCollinear(segments: RawSegment[]): RawSegment[] {
  const result: RawSegment[] = []
  for (const orientation of ['h', 'v'] as const) {
    const list = segments
      .filter((segment) => segment.orientation === orientation)
      .sort((a, b) => a.cross - b.cross || a.from - b.from)
      .map((segment) => ({ ...segment }))
    const clusters: RawSegment[] = []
    for (const segment of list) {
      let target: RawSegment | undefined
      for (const cluster of clusters) {
        const tolerance = Math.max(2, Math.min(cluster.thickness, segment.thickness))
        const sameLine = Math.abs(cluster.cross - segment.cross) <= tolerance
        const touching = segment.from <= cluster.to + tolerance && segment.to >= cluster.from - tolerance
        if (sameLine && touching) {
          target = cluster
          break
        }
      }
      if (!target) {
        clusters.push({ ...segment })
        continue
      }
      const weight = target.thickness + segment.thickness || 1
      target.cross = (target.cross * target.thickness + segment.cross * segment.thickness) / weight
      target.from = Math.min(target.from, segment.from)
      target.to = Math.max(target.to, segment.to)
      target.thickness = Math.max(target.thickness, segment.thickness)
    }
    result.push(...clusters)
  }
  return result
}

/**
 * 合并"双线墙"：有些图纸把一堵墙画成两条平行细线，中间留白。
 * 距离在 maxDistancePx 内、且长度方向大量重叠的两条线视为同一堵墙。
 *
 * 实现上不能写成"两两配对、每合并一次就重扫全表"——那是 O(n³)，
 * 一张噪点多的图能跑到几十秒并卡死主线程。这里按 cross 排序后只比较
 * 相距 maxDistancePx 以内的候选，代价接近 O(n log n + n·窗口)。
 */
export function mergeParallelFaces(segments: RawSegment[], maxDistancePx: number): RawSegment[] {
  const result: RawSegment[] = []
  for (const orientation of ['h', 'v'] as const) {
    const list = segments
      .filter((segment) => segment.orientation === orientation)
      .sort((a, b) => a.cross - b.cross || a.from - b.from)
    const faces: RawSegment[] = []
    for (const segment of list) {
      let target: RawSegment | undefined
      // faces 按 cross 递增，只有末尾若干个可能落在窗口内。
      // 往回扫时限制检查个数，避免顺序被轻微打乱时退化成全表扫描。
      let checked = 0
      for (let index = faces.length - 1; index >= 0; index -= 1) {
        const face = faces[index]
        if (segment.cross - face.cross > maxDistancePx) break
        checked += 1
        if (checked > 64) break
        const distance = Math.abs(face.cross - segment.cross)
        if (distance <= 1e-6 || distance > maxDistancePx) continue
        const overlap = Math.min(face.to, segment.to) - Math.max(face.from, segment.from)
        if (overlap < 0.5 * Math.min(face.to - face.from, segment.to - segment.from)) continue
        target = face
        break
      }
      if (!target) {
        faces.push({ ...segment })
        continue
      }
      // 合并后的 cross 取两条线的中点，thickness 变成"两线间距 + 平均线宽"。
      const distance = Math.abs(target.cross - segment.cross)
      target.from = Math.min(target.from, segment.from)
      target.to = Math.max(target.to, segment.to)
      target.thickness = distance + (target.thickness + segment.thickness) / 2
      target.cross = (target.cross + segment.cross) / 2
    }
    result.push(...faces)
  }
  // 合并会改变 cross，可能让两条 face 落到同一位置，最后再按原规则收一次。
  return result
}

/**
 * 估计"双线墙"两条线之间的典型间距。
 *
 * 图纸比例未知，墙画成两条平行线时中间留白可能从 6px 到 40px 不等，
 * 写死一个 `mergeDoubleLinesPx=14` 遇到粗一点的图就完全不合并，
 * 结果每堵墙都变成两条，数量翻倍、拐角全对不上（画布上满屏橙色"未连接"）。
 *
 * 双线墙的间距在所有平行线对里通常是最小、最集中的那一簇，所以：
 * 收集"长度方向大量重叠"的平行线对间距，取最小一簇的中位数。
 */
export function estimateDoubleLineDistance(segments: RawSegment[], minSide: number): number {
  const gaps: number[] = []
  const maxGap = Math.max(6, Math.round(minSide * 0.12))
  for (const orientation of ['h', 'v'] as const) {
    const list = segments
      .filter((segment) => segment.orientation === orientation)
      .sort((a, b) => a.cross - b.cross)
    for (let i = 0; i < list.length; i += 1) {
      let checked = 0
      for (let j = i + 1; j < list.length; j += 1) {
        const gap = list[j].cross - list[i].cross
        if (gap <= 0) continue
        if (gap > maxGap) break
        checked += 1
        if (checked > 40) break
        const shorter = Math.min(list[i].to - list[i].from, list[j].to - list[j].from)
        if (shorter <= 0) continue
        const overlap = Math.min(list[i].to, list[j].to) - Math.max(list[i].from, list[j].from)
        // 双线墙两条线的长度几乎一样、几乎完全重叠。
        if (overlap >= shorter * 0.6) gaps.push(gap)
      }
    }
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  const smallest = gaps[0]
  const cluster = gaps.filter((gap) => gap <= smallest * 1.5)
  const typical = cluster[Math.floor(cluster.length / 2)]
  // 小于 3px 的多半是同一笔画被切出来的两次行程，不值得合并。
  return typical < 3 ? 0 : Math.round(typical)
}

/** 端点吸附：横墙端点吸到最近的竖墙上（反之亦然），让拐角真正闭合。 */
export function snapEndpoints(segments: RawSegment[]): RawSegment[] {
  const horizontals = segments.filter((segment) => segment.orientation === 'h')
  const verticals = segments.filter((segment) => segment.orientation === 'v')
  for (const horizontal of horizontals) {
    const tolerance = Math.max(3, horizontal.thickness)
    for (const key of ['from', 'to'] as const) {
      let best = horizontal[key]
      let bestDelta = tolerance
      for (const vertical of verticals) {
        if (vertical.from - tolerance > horizontal.cross || vertical.to + tolerance < horizontal.cross) continue
        const delta = Math.abs(vertical.cross - horizontal[key])
        if (delta <= bestDelta) {
          bestDelta = delta
          best = vertical.cross
        }
      }
      horizontal[key] = best
    }
  }
  for (const vertical of verticals) {
    const tolerance = Math.max(3, vertical.thickness)
    for (const key of ['from', 'to'] as const) {
      let best = vertical[key]
      let bestDelta = tolerance
      for (const horizontal of horizontals) {
        if (horizontal.from - tolerance > vertical.cross || horizontal.to + tolerance < vertical.cross) continue
        const delta = Math.abs(horizontal.cross - vertical[key])
        if (delta <= bestDelta) {
          bestDelta = delta
          best = horizontal.cross
        }
      }
      vertical[key] = best
    }
  }
  return segments
}

/**
 * 清掉"孤立的碎块"：房间名、尺寸数字、图例、标注箭头在二值图里也是短粗线，
 * 会被当成墙。它们的共同点是**和墙网没有任何交点**，而真实的短墙（垛子）
 * 一定搭在别的墙上。所以：保留够长的线，再迭代补上与已保留线相交的短线。
 */
export function pruneIsolatedShorts(segments: RawSegment[], minLong: number, tolerance: number): RawSegment[] {
  const kept = segments.filter((segment) => segment.to - segment.from >= minLong)
  if (kept.length === 0) return segments
  const intersects = (a: RawSegment, b: RawSegment): boolean => {
    if (a.orientation === b.orientation) return false
    const horizontal = a.orientation === 'h' ? a : b
    const vertical = a.orientation === 'h' ? b : a
    return (
      vertical.cross >= horizontal.from - tolerance &&
      vertical.cross <= horizontal.to + tolerance &&
      horizontal.cross >= vertical.from - tolerance &&
      horizontal.cross <= vertical.to + tolerance
    )
  }
  let changed = true
  while (changed) {
    changed = false
    for (const segment of segments) {
      if (kept.includes(segment)) continue
      if (kept.some((other) => intersects(segment, other))) {
        kept.push(segment)
        changed = true
      }
    }
  }
  return kept
}

/* ------------------------------------------------------------------ 门与墙 */

type CmSegment = { orientation: 'h' | 'v'; from: number; to: number; cross: number; thickness: number }
type DoorCandidate = { orientation: 'h' | 'v'; cross: number; from: number; to: number }

/**
 * 把同一直线上、中间留了一段 45–260cm 缺口的墙合并成一堵墙，
 * 缺口就是门洞。返回合并后的墙和门的候选位置。
 */
export function extractDoors(
  segments: CmSegment[],
  minDoorCm = MIN_DOOR_CM,
  maxDoorCm = MAX_DOOR_CM,
): { walls: CmSegment[]; doors: DoorCandidate[] } {
  const walls: CmSegment[] = []
  const doors: DoorCandidate[] = []
  for (const orientation of ['h', 'v'] as const) {
    const list = segments
      .filter((segment) => segment.orientation === orientation)
      .sort((a, b) => a.cross - b.cross || a.from - b.from)
    const consumed = new Set<number>()
    for (let i = 0; i < list.length; i += 1) {
      if (consumed.has(i)) continue
      const current: CmSegment = { ...list[i] }
      for (let j = i + 1; j < list.length; j += 1) {
        if (consumed.has(j)) continue
        const next = list[j]
        if (Math.abs(next.cross - current.cross) > Math.max(2, current.thickness)) continue
        const gap = next.from - current.to
        if (gap < minDoorCm || gap > maxDoorCm) continue
        doors.push({
          orientation,
          cross: current.cross,
          from: current.to,
          to: next.from,
        })
        current.to = next.to
        current.thickness = Math.max(current.thickness, next.thickness)
        consumed.add(j)
      }
      consumed.add(i)
      walls.push(current)
    }
  }
  return { walls, doors }
}

/* ------------------------------------------------------------------ 房间 */

type Region = { label: number; area: number; left: number; right: number; top: number; bottom: number }

/**
 * 已被判定为"房子外面"的像素标记。
 * 必须与 `-1`（尚未访问）区分开，否则外层扫描会反复重扫同一片连通背景。
 */
const OUTSIDE_LABEL = -2

/**
 * 对空白区域做连通域标记（4 连通），得到房间候选。
 * 触碰图幅边界的区域视为"房子外面"，标成 -1 直接丢弃。
 */
export function findRegions(mask: InkMask, box: { left: number; right: number; top: number; bottom: number }): {
  labels: Int32Array
  regions: Region[]
} {
  const { width, height } = mask
  const labels = new Int32Array(width * height).fill(-1)
  const regions: Region[] = []
  const left = Math.max(0, Math.floor(box.left))
  const right = Math.min(width - 1, Math.ceil(box.right))
  const top = Math.max(0, Math.floor(box.top))
  const bottom = Math.min(height - 1, Math.ceil(box.bottom))
  const stack: number[] = []
  const pending: number[] = []
  let nextLabel = 0
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const start = y * width + x
      if (mask.data[start] || labels[start] !== -1) continue
      const region: Region = { label: nextLabel, area: 0, left: x, right: x, top: y, bottom: y }
      pending.length = 0
      stack.length = 0
      labels[start] = nextLabel
      stack.push(start)
      let touchesBorder = false
      while (stack.length > 0) {
        const index = stack.pop() as number
        pending.push(index)
        const cx = index % width
        const cy = (index - cx) / width
        region.area += 1
        if (cx < region.left) region.left = cx
        if (cx > region.right) region.right = cx
        if (cy < region.top) region.top = cy
        if (cy > region.bottom) region.bottom = cy
        if (cx <= left || cx >= right || cy <= top || cy >= bottom) touchesBorder = true
        if (cx > left) {
          const next = index - 1
          if (!mask.data[next] && labels[next] === -1) {
            labels[next] = nextLabel
            stack.push(next)
          }
        }
        if (cx < right) {
          const next = index + 1
          if (!mask.data[next] && labels[next] === -1) {
            labels[next] = nextLabel
            stack.push(next)
          }
        }
        if (cy > top) {
          const next = index - width
          if (!mask.data[next] && labels[next] === -1) {
            labels[next] = nextLabel
            stack.push(next)
          }
        }
        if (cy < bottom) {
          const next = index + width
          if (!mask.data[next] && labels[next] === -1) {
            labels[next] = nextLabel
            stack.push(next)
          }
        }
      }
      if (touchesBorder) {
        // 用 -2 这个独立哨兵标记“图外”，不能重置回 -1：
        // 重置回 -1 会让外层循环把同一片连通背景重新当成未访问区域，
        // 对一张几乎占满全图的背景做 O(面积²) 的重复泛洪，直接卡死主线程。
        for (const index of pending) labels[index] = OUTSIDE_LABEL
        continue
      }
      regions.push(region)
      nextLabel += 1
    }
  }
  return { labels, regions }
}

/** 4 邻域方向（顺时针）：上、右、下、左。 */
const NEIGHBORS: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

/**
 * 用"边界边行走"提取区域外轮廓。
 *
 * 对每个 inside 像素的 4 条外侧邻接各生成一条晶格单位边（点用晶格坐标，
 * 即像素 x,y 的左上角），再沿未走过的边走成一圈。比 Moore 邻域跟踪稳：
 * 对凹多边形、带洞、单像素宽的区域都成立，也不会在起点提前退出。
 */
export function traceRegion(labels: Int32Array, width: number, height: number, region: Region): Point2D[] {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === region.label

  const key = (x: number, y: number): string => `${x},${y}`
  const edges = new Map<string, string[]>()
  const addEdge = (ax: number, ay: number, bx: number, by: number): void => {
    const from = key(ax, ay)
    const to = key(bx, by)
    const list = edges.get(from)
    if (list) list.push(to)
    else edges.set(from, [to])
  }

  for (let y = region.top; y <= region.bottom; y += 1) {
    for (let x = region.left; x <= region.right; x += 1) {
      if (!inside(x, y)) continue
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y) // 上侧边，向右
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1) // 右侧边，向下
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1) // 下侧边，向左
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y) // 左侧边，向上
    }
  }
  if (edges.size === 0) return []

  const start = edges.keys().next().value as string
  const [startX, startY] = start.split(',').map(Number)
  const points: Point2D[] = [{ x: startX, y: startY }]
  let current = start
  const limit = edges.size + 4
  for (let step = 0; step < limit; step += 1) {
    const list = edges.get(current)
    if (!list || list.length === 0) break
    const next = list.shift() as string
    if (next === start) break
    const [nx, ny] = next.split(',').map(Number)
    points.push({ x: nx, y: ny })
    current = next
  }
  return points
}

/** 去掉共线的中间点，把逐像素轮廓压成折线。 */
export function simplifyPolygon(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points
  const result: Point2D[] = []
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross =
      (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x)
    if (Math.abs(cross) > 1e-9) result.push(current)
  }
  return result.length >= 3 ? result : points
}

/** 保证多边形顶点数不超过 schema 上限，超了就等距抽稀。 */
export function limitPolygon(points: Point2D[], maxPoints = MAX_POLYGON_POINTS): Point2D[] {
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  const result: Point2D[] = []
  for (let index = 0; index < maxPoints; index += 1) result.push(points[Math.floor(index * step)])
  return result
}

/* ------------------------------------------------------------------ 工具 */

let idSeed = 0

/** 生成 UUID v4 形式的 id（schema 要求 UUID）。优先用 crypto.randomUUID。 */
export function createId(): string {
  const cryptoObject = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID()
  idSeed += 1
  const hex = (value: number): string => value.toString(16).padStart(2, '0')
  const bytes = new Array<number>(16).fill(0).map((_, index) => (index + idSeed * 37) % 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const text = bytes.map(hex).join('')
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** 多边形有向面积（正 = 顺时针，在 y 向下的屏幕坐标里）。 */
export function signedArea(points: Point2D[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return sum / 2
}

/** 检测自交，避免生成 schema 不接受的房间多边形。 */
export function isSelfIntersecting(points: Point2D[]): boolean {
  const count = points.length
  const cross = (a: Point2D, b: Point2D, c: Point2D): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  for (let i = 0; i < count; i += 1) {
    const a1 = points[i]
    const a2 = points[(i + 1) % count]
    for (let j = i + 1; j < count; j += 1) {
      if (i === j) continue
      if (i === (j + 1) % count || j === (i + 1) % count) continue
      const b1 = points[j]
      const b2 = points[(j + 1) % count]
      const d1 = cross(a1, a2, b1)
      const d2 = cross(a1, a2, b2)
      const d3 = cross(b1, b2, a1)
      const d4 = cross(b1, b2, a2)
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true
    }
  }
  return false
}

/**
 * 收掉同一位置重复的墙。
 *
 * 墙体有填充、或用双线画但两条线间距不统一时，`mergeParallelFaces` 会留下
 * 两条几乎重合的墙带——画布上就表现为"墙重复"、数量翻倍。
 * 同方向、墙线位置相差不超过一个墙厚、长度方向大量重叠的两条，只留一条
 * （范围取并集、厚度取更厚的那条）。
 */
function collapseDuplicateWalls(segments: CmSegment[]): CmSegment[] {
  const result: CmSegment[] = []
  for (const orientation of ['h', 'v'] as const) {
    const list = segments
      .filter((segment) => segment.orientation === orientation)
      .sort((a, b) => a.cross - b.cross || b.to - b.from - (a.to - a.from))
    const kept: CmSegment[] = []
    for (const segment of list) {
      const duplicate = kept.find((other) => {
        const tolerance = Math.max(4, Math.max(other.thickness, segment.thickness) * 0.9)
        if (Math.abs(other.cross - segment.cross) > tolerance) return false
        const overlap = Math.min(other.to, segment.to) - Math.max(other.from, segment.from)
        const shorter = Math.min(other.to - other.from, segment.to - segment.from)
        return shorter > 0 && overlap >= shorter * 0.7
      })
      if (duplicate) {
        duplicate.from = Math.min(duplicate.from, segment.from)
        duplicate.to = Math.max(duplicate.to, segment.to)
        duplicate.thickness = Math.max(duplicate.thickness, segment.thickness)
        continue
      }
      kept.push({ ...segment })
    }
    result.push(...kept)
  }
  return result
}

/**
 * 删掉"零碎的孤立小簇"。
 *
 * 门窗弧线、尺寸线、文字笔画被拉成小墙带时，往往互相挨在一起（一个汉字就是几笔
 * 相接的短横短竖），形成一小簇互相连接、却与主体结构完全不相连的碎墙。
 * 做法：把墙按"是否相接"聚成连通簇，整簇最长墙都不到 `minExtentCm` 的直接丢掉。
 * 真实的房间再小也总有一面墙连着主体，所以不会误删。
 */
function dropNoiseClusters(segments: CmSegment[], minExtentCm = 110): CmSegment[] {
  const touch = (a: CmSegment, b: CmSegment): boolean => {
    const tolerance = Math.max(6, Math.max(a.thickness, b.thickness) * 1.5)
    if (a.orientation === b.orientation) {
      if (Math.abs(a.cross - b.cross) > tolerance) return false
      return Math.min(a.to, b.to) >= Math.max(a.from, b.from) - tolerance
    }
    const horizontal = a.orientation === 'h' ? a : b
    const vertical = a.orientation === 'h' ? b : a
    return (
      vertical.cross >= horizontal.from - tolerance &&
      vertical.cross <= horizontal.to + tolerance &&
      horizontal.cross >= vertical.from - tolerance &&
      horizontal.cross <= vertical.to + tolerance
    )
  }

  const parent = segments.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== root) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (touch(segments[i], segments[j])) {
        const a = find(i)
        const b = find(j)
        if (a !== b) parent[a] = b
      }
    }
  }

  const longestByRoot = new Map<number, number>()
  segments.forEach((segment, index) => {
    const root = find(index)
    const length = segment.to - segment.from
    longestByRoot.set(root, Math.max(longestByRoot.get(root) ?? 0, length))
  })

  return segments.filter((segment, index) => (longestByRoot.get(find(index)) ?? 0) >= minExtentCm)
}

/* ------------------------------------------------------------------ 家具 */

/** 射线法判断点是否在多边形内（用于确认家具框落在哪个房间里）。 */
function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses = a.y > point.y !== b.y > point.y
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** 用长边/短边和素材基准尺寸的接近程度挑一个最合适的素材。 */
function pickFurnitureAsset(widthCm: number, depthCm: number, assets: RecognizeAsset[]): RecognizeAsset {
  const longSide = Math.max(widthCm, depthCm)
  const shortSide = Math.min(widthCm, depthCm)
  let best = assets[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const asset of assets) {
    const assetLong = Math.max(asset.baseWidth, asset.baseDepth)
    const assetShort = Math.min(asset.baseWidth, asset.baseDepth)
    const score =
      Math.abs(Math.log(longSide / Math.max(1, assetLong))) +
      Math.abs(Math.log(shortSide / Math.max(1, assetShort))) * 1.4
    if (score < bestScore) {
      bestScore = score
      best = asset
    }
  }
  return best
}

/**
 * 家具识别：家具在户型图里通常是一圈线描出来的矩形，内部是空白（或浅色填充），
 * 所以它在墨迹图里正好是一个"被围住的小空腔"。房间本身也是空腔，用"面积必须
 * 显著小于所在房间"这一条把它排除掉。必须在**原始墨迹图**上找，因为开运算会把
 * 家具的细线抹掉。
 */
function detectFurniture(
  mask: InkMask,
  box: { left: number; right: number; top: number; bottom: number },
  left: number,
  top: number,
  scale: number,
  rooms: RecognizedRoom[],
  assets: RecognizeAsset[],
): RecognizedFurniture[] {
  if (rooms.length === 0 || assets.length === 0) return []
  const { regions } = findRegions(mask, box)

  type Candidate = {
    left: number
    right: number
    top: number
    bottom: number
    area: number
    widthCm: number
    depthCm: number
  }

  const roomBounds = rooms.map((room) => {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const point of room.polygon) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    return { polygon: room.polygon, area: Math.abs(signedArea(room.polygon)), minX, minY, maxX, maxY }
  })

  const toX = (px: number) => (px - left) * scale + MARGIN_CM
  const toY = (py: number) => (py - top) * scale + MARGIN_CM

  const candidates: Candidate[] = []
  for (const region of regions) {
    const widthPx = region.right - region.left + 1
    const heightPx = region.bottom - region.top + 1
    const widthCm = widthPx * scale
    const depthCm = heightPx * scale
    const areaCm2 = region.area * scale * scale
    if (areaCm2 < 1200 || areaCm2 > 60000) continue
    const shortSide = Math.min(widthCm, depthCm)
    const longSide = Math.max(widthCm, depthCm)
    if (shortSide < 25 || longSide > 320) continue
    if (longSide / Math.max(1, shortSide) > 3.4) continue
    if (region.area / (widthPx * heightPx) < 0.45) continue
    const centerX = toX((region.left + region.right) / 2)
    const centerY = toY((region.top + region.bottom) / 2)
    const host = roomBounds.find((item) => pointInPolygon({ x: centerX, y: centerY }, item.polygon))
    if (!host) continue
    // 房间本体的空腔几乎和房间一样大，必须排除；家具面积要明显小于房间。
    if (areaCm2 > host.area * 0.8) continue
    candidates.push({
      left: region.left,
      right: region.right,
      top: region.top,
      bottom: region.bottom,
      area: region.area,
      widthCm,
      depthCm,
    })
  }

  // 家具内部再画线会产生"嵌套空腔"，只保留最外层（已被更大的框完全包住的丢掉）。
  candidates.sort((a, b) => b.area - a.area)
  const kept: Candidate[] = []
  for (const candidate of candidates) {
    const nested = kept.some(
      (outer) =>
        candidate.left >= outer.left &&
        candidate.right <= outer.right &&
        candidate.top >= outer.top &&
        candidate.bottom <= outer.bottom,
    )
    if (!nested) kept.push(candidate)
  }

  const furniture: RecognizedFurniture[] = []
  for (const candidate of kept.slice(0, 1000)) {
    const asset = pickFurnitureAsset(candidate.widthCm, candidate.depthCm, assets)
    furniture.push({
      id: createId(),
      assetId: asset.id,
      name: asset.name,
      position: {
        x: clamp(Math.round(toX((candidate.left + candidate.right) / 2)), 0, MAX_COORD_CM),
        y: clamp(Math.round(toY((candidate.top + candidate.bottom) / 2)), 0, MAX_COORD_CM),
      },
      rotation: 0,
      width: clamp(Math.round(candidate.widthCm), 1, 2000),
      depth: clamp(Math.round(candidate.depthCm), 1, 2000),
      height: clamp(Math.round(asset.baseHeight), 1, 2000),
      locked: false,
      zIndex: furniture.length + 1,
    })
  }
  return furniture
}

/* ------------------------------------------------------------------ 主入口 */

/**
 * 决定用原始墨迹图，还是"开运算去细线"后的墨迹图来提墙。
 *
 * 粗墙图（真实渲染的户型图）：开运算后墙仍在、家具与标注被抹掉 → 用开运算结果。
 * 细线图 / 双线画法：开运算几乎把线抹光 → 保留原图，交给双线合并逻辑处理。
 * 从 radius=1 起逐步加大，取"最大且仍保住 35% 墨迹"的半径，自适应墙的粗细。
 */
function chooseWorkingMask(mask: InkMask, minSide: number): InkMask {
  const maxRadius = Math.max(1, Math.min(4, Math.round(minSide * 0.0018)))
  const rawInk = countInk(mask)
  if (rawInk === 0) return mask
  const minInk = mask.width * mask.height * 0.002
  let best = mask
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const opened = openMask(mask, radius)
    const openInk = countInk(opened)
    if (openInk / rawInk >= 0.35 && openInk > minInk) {
      best = opened
    } else {
      break
    }
  }
  return best
}

/**
 * 识别一张顶视户型图，产出可直接写进 PlanDocument 的墙/房间/门。
 *
 * 坐标为 cm，原点在图幅左上角（会额外留 MARGIN_CM 边距），
 * 保证所有点都落在 schema 的 0–10000 范围内。
 */
export function recognizeFloorplan(gray: GrayImage, options: RecognizeOptions = {}): RecognizedFloorplan {
  const warnings: string[] = []

  // 预处理：手机拍的照片偏暗发灰，先做 CLAHE 局部对比度增强（默认关，电子线稿不需要）。
  let working = gray
  if (options.enhanceContrast) working = enhanceContrast(working)

  // 自动摆正：估计整体倾斜角，超过 0.7° 才真正旋转；旋转不改变画布尺寸，坐标系保持一致。
  let rotation = 0
  if (options.autoDeskew ?? true) {
    const angle = estimateSkewAngle(working)
    if (Math.abs(angle) > 0.7) {
      working = rotateGray(working, angle)
      rotation = angle
    }
  }

  const minSide = Math.min(working.width, working.height)
  const minWallLengthPx = Math.max(4, options.minWallLengthPx ?? Math.round(minSide * 0.02))
  const mask = binarize(working, options.threshold)

  // 真实户型图（尤其彩色渲染图）里有大量家具轮廓、红色标注、尺寸线、文字笔画，
  // 它们又细又长，会被误当成墙，一张图能识别出几十面碎墙。墙是最粗的深色结构，
  // 所以先做去噪：
  //   'v1'   —— 旧行为，只用开运算把细于 (2*radius+1) 的结构整条抹掉；双线图回退原图。
  //   'auto' —— 三策略（开 / 闭+开 / 闭+开+去小连通域）分别打分，取候选墙质量最好的一版。
  // 用"候选墙平均置信度 + 长墙条数"打分，比只看墨迹占比稳：断墙被闭运算补上后分数会上升。
  const workingMask =
    (options.maskStrategy ?? 'auto') === 'v1'
      ? chooseWorkingMask(mask, minSide)
      : chooseWorkingMaskV2(mask, minSide)

  const horizontal = bandsToSegments(extractBands(workingMask, 'h', minWallLengthPx), 'h')
  const vertical = bandsToSegments(extractBands(workingMask, 'v', minWallLengthPx), 'v')
  let raw = mergeCollinear([...horizontal, ...vertical])
  // 双线墙的线间距随图纸比例变化（6–40px），写死一个值要么漏合并、要么把两堵相邻墙并成一堵，
  // 所以先从图里估出这组双线的典型间距，再交给 mergeParallelFaces。
  const doubleLineDistance = options.mergeDoubleLinesPx ?? estimateDoubleLineDistance(raw, minSide)
  if (doubleLineDistance > 0) {
    raw = mergeParallelFaces(raw, doubleLineDistance)
    raw = mergeCollinear(raw)
  }
  raw = snapEndpoints(raw)

  // 只保留墙带：太细的是文字/尺寸线，太粗的是家具或图框。
  // 墙厚用"长线"、并按长度加权估中位数：尺寸线又细又长，简单中位数会被它拉低，
  // 一旦把墙厚估成 2px，2px 的尺寸线就全被当成墙留下（横贯整张图的假墙）。
  const longSegments = raw.filter((segment) => segment.to - segment.from >= minWallLengthPx * 5)
  const reference = longSegments.length > 0 ? longSegments : raw
  const weighted = reference
    .map((segment) => ({ thickness: segment.thickness, weight: segment.to - segment.from }))
    .sort((a, b) => a.thickness - b.thickness)
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  let medianThickness = weighted.length > 0 ? weighted[weighted.length - 1].thickness : 3
  if (totalWeight > 0) {
    let accumulated = 0
    for (const item of weighted) {
      accumulated += item.weight
      if (accumulated >= totalWeight / 2) {
        medianThickness = item.thickness
        break
      }
    }
  }
  const minThickness = Math.max(2, medianThickness * 0.35)
  const maxThickness = Math.max(medianThickness * 3.2, medianThickness + 4)
  raw = raw.filter(
    (segment) =>
      segment.thickness >= minThickness &&
      segment.thickness <= maxThickness &&
      segment.to - segment.from >= minWallLengthPx,
  )

  if (raw.length === 0) {
    return emptyResult(gray, warnings, '没有在图片里找到水平的墙线，请换一张线条更清晰、正着拍的户型图。')
  }

  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const segment of raw) {
    if (segment.orientation === 'h') {
      left = Math.min(left, segment.from)
      right = Math.max(right, segment.to)
      top = Math.min(top, segment.cross)
      bottom = Math.max(bottom, segment.cross)
    } else {
      left = Math.min(left, segment.cross)
      right = Math.max(right, segment.cross)
      top = Math.min(top, segment.from)
      bottom = Math.max(bottom, segment.to)
    }
  }
  const spanWidth = Math.max(1, right - left)
  const spanHeight = Math.max(1, bottom - top)

  // 房间名/尺寸数字是孤立碎块，和墙网没有交点，清掉；搭在墙上的短垛子会保留。
  // 阈值相对图幅：至少占短边的 12%，免得小字块在缩略图上也被当成一条墙。
  raw = pruneIsolatedShorts(
    raw,
    Math.max(minWallLengthPx * 2, Math.round(Math.min(spanWidth, spanHeight) * 0.12)),
    Math.max(2, medianThickness),
  )

  // 候选图全局择优：按置信度从高到低贪心选墙，去掉"同一条线的两副面孔"（重复墙），
  // 同时保留真交叉（横竖墙相交不算冲突）。比原来的 collapseDuplicateWalls 更稳：
  // 后者只看几何重叠，遇到"一条粗墙被提取成两三条平行窄墙"就束手无策。
  if (options.dedupeWalls ?? true) {
    const integral = buildIntegral(mask)
    const pool: Candidate[] = raw.map((segment) => ({
      orientation: segment.orientation,
      from: segment.from,
      to: segment.to,
      cross: segment.cross,
      thickness: segment.thickness,
      confidence: segmentConfidence(mask, integral, segment),
      inkLength: segment.to - segment.from,
    }))
    raw = selectWalls(pool, Math.max(2, medianThickness)).map((candidate) => ({
      orientation: candidate.orientation,
      from: candidate.from,
      to: candidate.to,
      cross: candidate.cross,
      thickness: candidate.thickness,
    }))
  }

  // junction：把几乎重合的端点聚类成同一个节点；再视配置把 T 接的墙拆开、把 degree==1 的
  // 开口沿墙方向补到对面的墙上。做完后每个墙端点都落在某个节点坐标上，
  // 画布上的"开口橙点"就不再亮起了。
  if (options.joinWalls ?? true) {
    const tolerance = Math.max(2, Math.round(medianThickness))
    const toRaw = (wall: { orientation: 'h' | 'v'; from: number; to: number; cross: number; thickness: number }): RawSegment => ({
      orientation: wall.orientation,
      from: wall.from,
      to: wall.to,
      cross: wall.cross,
      thickness: wall.thickness,
    })
    const clustered = clusterJunctions(raw, tolerance)
    raw = clustered.walls.map(toRaw)
    let junctions = clustered.junctions
    if (options.splitJunctions) {
      raw = splitTJunctions(raw, junctions, tolerance).map(toRaw)
      junctions = clusterJunctions(raw, tolerance).junctions
    }
    raw = closeOpenJunctions(raw, junctions, 400).map(toRaw)
  }

  const targetWidthCm = clamp(options.targetWidthCm ?? 1200, 200, 6000)
  const scale = targetWidthCm / spanWidth

  // 水平段：长度方向 = x（减 left），厚度方向 = y（减 top）；
  // 垂直段：长度方向 = y（减 top），厚度方向 = x（减 left）。
  const toCm = (segment: RawSegment): CmSegment => ({
    orientation: segment.orientation,
    from:
      (segment.orientation === 'h' ? segment.from - left : segment.from - top) * scale + MARGIN_CM,
    to: (segment.orientation === 'h' ? segment.to - left : segment.to - top) * scale + MARGIN_CM,
    cross:
      (segment.orientation === 'h' ? segment.cross - top : segment.cross - left) * scale + MARGIN_CM,
    thickness: clamp(segment.thickness * scale, MIN_WALL_THICKNESS_CM, MAX_WALL_THICKNESS_CM),
  })
  const cmSegments = dropNoiseClusters(collapseDuplicateWalls(raw.map(toCm)))

  const wallHeight = clamp(options.wallHeight ?? DEFAULT_WALL_HEIGHT_CM, 200, 500)
  const doorsEnabled = options.detectDoors ?? true
  const split = doorsEnabled
    ? extractDoors(cmSegments)
    : { walls: cmSegments, doors: [] as DoorCandidate[] }

  const walls: RecognizedWall[] = []
  for (const segment of split.walls) {
    const length = segment.to - segment.from
    if (length < MIN_WALL_LENGTH_CM) continue
    const start: Point2D =
      segment.orientation === 'h'
        ? { x: clamp(segment.from, 0, MAX_COORD_CM), y: clamp(segment.cross, 0, MAX_COORD_CM) }
        : { x: clamp(segment.cross, 0, MAX_COORD_CM), y: clamp(segment.from, 0, MAX_COORD_CM) }
    const end: Point2D =
      segment.orientation === 'h'
        ? { x: clamp(segment.to, 0, MAX_COORD_CM), y: clamp(segment.cross, 0, MAX_COORD_CM) }
        : { x: clamp(segment.cross, 0, MAX_COORD_CM), y: clamp(segment.to, 0, MAX_COORD_CM) }
    walls.push({
      id: createId(),
      start,
      end,
      thickness: Math.round(segment.thickness * 10) / 10,
      height: wallHeight,
    })
  }

  if (walls.length === 0) {
    return emptyResult(gray, warnings, '识别到了线条，但没有一条够长够粗的墙，请确认这是一张顶视户型图。')
  }

  // 门：缺口必须落在某堵墙上，且宽度合法。
  const openings: RecognizedOpening[] = []
  if (doorsEnabled) {
    for (const door of split.doors) {
      const width = door.to - door.from
      if (width < MIN_DOOR_CM || width > MAX_DOOR_CM) continue
      const centerCross = door.cross
      const centerLength = (door.from + door.to) / 2
      let host: RecognizedWall | undefined
      for (const wall of walls) {
        const horizontal = wall.start.y === wall.end.y
        if (horizontal !== (door.orientation === 'h')) continue
        const cross = horizontal ? wall.start.y : wall.start.x
        if (Math.abs(cross - centerCross) > Math.max(6, wall.thickness)) continue
        const from = horizontal ? Math.min(wall.start.x, wall.end.x) : Math.min(wall.start.y, wall.end.y)
        const to = horizontal ? Math.max(wall.start.x, wall.end.x) : Math.max(wall.start.y, wall.end.y)
        if (centerLength < from || centerLength > to) continue
        host = wall
        break
      }
      if (!host) continue
      const horizontal = host.start.y === host.end.y
      const hostFrom = horizontal ? Math.min(host.start.x, host.end.x) : Math.min(host.start.y, host.end.y)
      const offset = centerLength - width / 2 - hostFrom
      const hostLength = horizontal
        ? Math.abs(host.end.x - host.start.x)
        : Math.abs(host.end.y - host.start.y)
      if (offset < 0 || offset + width > hostLength) continue
      openings.push({
        id: createId(),
        wallId: host.id,
        type: 'door',
        offset: Math.round(offset * 10) / 10,
        width: Math.round(width * 10) / 10,
        height: Math.min(200, Math.round(wallHeight * 0.75)),
        sillHeight: 0,
      })
    }
  }

  // 房间分割：
  //   'watershed'（默认）—— 距离场 + 多尺度种子 + 分水岭。门洞处距离场是一个鞍部，
  //     分水岭正好在那里切一刀，即使墙上有 30–80px 门洞，也不会把两间房连成一片。
  //   'flood' —— 旧做法：把合并了门洞的墙重新栅格化，再对空白区域泛洪。
  const rooms: RecognizedRoom[] = []
  if (options.detectRooms ?? true) {
    const roomMode = options.roomSegmentation ?? 'watershed'
    const minRoomAreaCm2 = options.minRoomAreaCm2 ?? 15000
    let roomIndex = 0
    const pushRoom = (outline: Array<{ x: number; y: number }>): void => {
      if (outline.length < 3) return
      const polygon = limitPolygon(
        outline.map((point) => ({
          x: Math.round(clamp((point.x - left) * scale + MARGIN_CM, 0, MAX_COORD_CM) * 10) / 10,
          y: Math.round(clamp((point.y - top) * scale + MARGIN_CM, 0, MAX_COORD_CM) * 10) / 10,
        })),
      )
      if (Math.abs(signedArea(polygon)) < minRoomAreaCm2) return
      if (isSelfIntersecting(polygon)) {
        warnings.push('有 1 个房间的轮廓自交，已跳过（通常是因为墙线没闭合）。')
        return
      }
      roomIndex += 1
      rooms.push({ id: createId(), name: `房间 ${roomIndex}`, polygon })
    }

    if (roomMode === 'flood') {
      // 用合并过门洞的墙（split.walls）而不是原始断线：门洞两侧本来是一堵墙，
      // 补上缺口后房间才会被正确分开，否则整层会连成一个大房间。
      const closingSegments: RawSegment[] = split.walls.map((segment) => ({
        orientation: segment.orientation,
        from: (segment.from - MARGIN_CM) / scale + (segment.orientation === 'h' ? left : top),
        to: (segment.to - MARGIN_CM) / scale + (segment.orientation === 'h' ? left : top),
        cross: (segment.cross - MARGIN_CM) / scale + (segment.orientation === 'h' ? top : left),
        thickness: segment.thickness / scale,
      }))
      const regionMask = rasterizeWalls(working.width, working.height, closingSegments, Math.max(2, medianThickness))
      const { labels, regions } = findRegions(regionMask, { left, right, top, bottom })
      const minAreaPx = minRoomAreaCm2 / (scale * scale)
      for (const region of regions) {
        if (region.area < minAreaPx) continue
        pushRoom(simplifyPolygon(traceRegion(labels, working.width, working.height, region)))
      }
    } else {
      // 用最终墙线栅格化出"障碍图"（墙=1），然后算距离场。
      const regionMask = rasterizeWalls(working.width, working.height, raw, Math.max(2, medianThickness))
      const barrier = new Uint8Array(regionMask.width * regionMask.height)
      for (let index = 0; index < barrier.length; index += 1) barrier[index] = regionMask.data[index] ? 1 : 0
      const distance = distanceTransform(barrier, working.width, working.height)
      // 尺度按"像素/米"给：0.5–2.5 米，兼顾小卫生间和大客厅。
      const pxPerMeter = 100 / scale
      const sigmas = [0.5, 1, 1.5, 2, 2.5].map((meters) => Math.max(1, meters * pxPerMeter))
      const seeds = multiScaleSeeds(distance, working.width, working.height, sigmas)
      const labeled = watershedSeeds(distance, seeds, working.width, working.height)
      const merged = mergeAdjacentRooms(labeled, working.width, working.height, {
        minArea: 10000 / (scale * scale),
        maxMergedArea: working.width * working.height * 0.6,
        sharedRatio: 0.25,
        minShared: Math.max(2, 200 / scale),
      })
      const minAreaPx = minRoomAreaCm2 / (scale * scale)
      for (const region of merged.regions) {
        if (region.area < minAreaPx) continue
        pushRoom(simplifyPolygon(traceRegion(merged.labels, working.width, working.height, region)))
      }
    }
  }

  const furniture =
    options.detectFurniture ?? true
      ? detectFurniture(
          mask,
          { left, right, top, bottom },
          left,
          top,
          scale,
          rooms,
          options.furnitureAssets ?? DEFAULT_FURNITURE_ASSETS,
        )
      : []

  const widthCm = Math.round((spanWidth * scale + MARGIN_CM * 2) * 10) / 10
  const heightCm = Math.round((spanHeight * scale + MARGIN_CM * 2) * 10) / 10
  const thicknessCm =
    Math.round((walls.reduce((sum, wall) => sum + wall.thickness, 0) / walls.length) * 10) / 10

  if (walls.length >= 500) warnings.push('墙体数量已达上限，多余的墙被丢弃。')
  if (rooms.length === 0) warnings.push('没有识别出封闭房间，可能是墙线没有围合（比如门洞太多）。')

  return {
    walls: walls.slice(0, 500),
    rooms: rooms.slice(0, 100),
    openings: openings.slice(0, 500),
    furniture: furniture.slice(0, 1000),
    segments: raw.map((segment) => ({
      orientation: segment.orientation,
      from: segment.from,
      to: segment.to,
      cross: segment.cross,
      thickness: segment.thickness,
    })),
    bounds: { left, right, top, bottom },
    transform: {
      x: MARGIN_CM - left * scale,
      y: MARGIN_CM - top * scale,
      width: working.width * scale,
      height: working.height * scale,
      scale,
      rotation,
    },
    stats: {
      wallCount: walls.length,
      roomCount: rooms.length,
      openingCount: openings.length,
      furnitureCount: furniture.length,
      widthCm,
      heightCm,
      thicknessCm,
    },
    warnings,
  }
}

/** 把墙线按厚度画回一张二值图，用于房间泛洪（比原始像素更干净）。 */
function rasterizeWalls(width: number, height: number, segments: RawSegment[], pad: number): InkMask {
  const data = new Uint8Array(width * height)
  const half = Math.max(1, Math.round(pad / 2))
  for (const segment of segments) {
    const thickness = Math.max(2, Math.round(segment.thickness))
    const from = Math.max(0, Math.floor(segment.from))
    const to = Math.min(segment.orientation === 'h' ? width - 1 : height - 1, Math.ceil(segment.to))
    const center = Math.round(segment.cross)
    const low = Math.max(0, center - Math.floor(thickness / 2) - half)
    const high = Math.min((segment.orientation === 'h' ? height : width) - 1, center + Math.ceil(thickness / 2) + half)
    for (let cross = low; cross <= high; cross += 1) {
      for (let along = from; along <= to; along += 1) {
        const index = segment.orientation === 'h' ? cross * width + along : along * width + cross
        if (index >= 0 && index < data.length) data[index] = 1
      }
    }
  }
  return { width, height, data }
}

function emptyResult(gray: GrayImage, warnings: string[], warning: string): RecognizedFloorplan {
  warnings.push(warning)
  return {
    walls: [],
    rooms: [],
    openings: [],
    furniture: [],
    segments: [],
    bounds: { left: 0, right: gray.width, top: 0, bottom: gray.height },
    transform: { x: 0, y: 0, width: gray.width, height: gray.height, scale: 1, rotation: 0 },
    stats: {
      wallCount: 0,
      roomCount: 0,
      openingCount: 0,
      furnitureCount: 0,
      widthCm: 0,
      heightCm: 0,
      thicknessCm: 0,
    },
    warnings,
  }
}

/* ------------------------------------------------------------------ 落到文档 */

/**
 * 把识别结果合并进一份已有的 PlanDocument。
 * mode='replace' 会清掉原有的墙/房间/门；识别到家具时家具也一并替换，
 * 否则保留用户原有的家具（避免"只重导墙"时把手工摆的家具清空）。
 * mode='append' 全部追加。
 */
export function applyRecognizedFloorplan(
  document: {
    walls: unknown[]
    rooms: unknown[]
    openings: unknown[]
    furniture: unknown[]
  },
  result: RecognizedFloorplan,
  mode: 'replace' | 'append' = 'replace',
): {
  walls: RecognizedWall[]
  rooms: RecognizedRoom[]
  openings: RecognizedOpening[]
  furniture: RecognizedFurniture[]
} {
  const base =
    mode === 'replace'
      ? { walls: [] as RecognizedWall[], rooms: [] as RecognizedRoom[], openings: [] as RecognizedOpening[] }
      : {
          walls: document.walls as RecognizedWall[],
          rooms: document.rooms as RecognizedRoom[],
          openings: document.openings as RecognizedOpening[],
        }
  const existingFurniture = document.furniture as RecognizedFurniture[]
  let furniture: RecognizedFurniture[]
  if (mode === 'replace') {
    // 识别到家具就整份替换；没识别到就保留用户原来摆的家具。
    furniture = result.furniture.length > 0 ? result.furniture : existingFurniture
  } else {
    furniture = [...existingFurniture, ...result.furniture]
  }
  return {
    walls: [...base.walls, ...result.walls],
    rooms: [...base.rooms, ...result.rooms],
    openings: [...base.openings, ...result.openings],
    furniture,
  }
}



