/**
 * 候选墙图：把"线带"升级成"带置信度的候选墙"，再用全局择优挑出一组互不冲突的墙。
 *
 * 解决的问题：原来的流程是"谁先被扫出来就用谁"，同一条墙被画成两根线、或者一堵墙
 * 被门洞切出的两段都保留，最后靠 collapseDuplicateWalls / pruneIsolatedShorts 亡羊补牢。
 * 现在改成先收集完整候选集，再按置信度做一次全局贪心（近似最大权独立集）：
 *   - 同向且几乎重合的两条 → 只留置信度高的那条（去重复墙）
 *   - 异向且互相穿过对方"内部"（不是 T 接、L 接）→ 只留一条（去假交叉）
 *
 * 依赖方向：本文件 → plan-recognition-lines.ts，单向，不会循环引用。
 */
import type { InkMask } from './plan-recognition.ts'
import { bandsToSegments, extractBands } from './plan-recognition-lines.ts'
import type { RawSegment } from './plan-recognition-lines.ts'

/** 一条候选墙：几何 + 置信度。confidence ∈ [0,1]，越大越像真墙。 */
export type Candidate = {
  orientation: 'h' | 'v'
  from: number
  to: number
  cross: number
  thickness: number
  /** 归一化置信度：墨迹占比 × 长度占比。 */
  confidence: number
  /** 带宽内真实的墨迹长度（像素），用来区分"实心墙"和"虚线/网格"。 */
  inkLength: number
}

export type SelectWallsOptions = {
  /** 异向墙在内部相交时是否算冲突（默认 true；只想去重复墙时传 false）。 */
  crossConflict?: boolean
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function clampInt(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  const rounded = Math.round(value)
  return rounded < low ? low : rounded > high ? high : rounded
}

/** 掩膜积分图，(width+1)*(height+1)，用于 O(1) 求任意矩形内的墨迹像素数。 */
export function buildIntegral(mask: InkMask): Int32Array {
  const { width, height, data } = mask
  const stride = width + 1
  const integral = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    const rowBase = y * width
    const prevBase = y * stride
    const curBase = (y + 1) * stride
    for (let x = 0; x < width; x += 1) {
      if (data[rowBase + x]) rowSum += 1
      integral[curBase + x + 1] = integral[prevBase + x + 1] + rowSum
    }
  }
  return integral
}

/** 积分图上求 [left,right) × [top,bottom) 的墨迹像素和。 */
export function sumRect(
  integral: Int32Array,
  stride: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  if (right <= left || bottom <= top) return 0
  const a = integral[top * stride + left]
  const b = integral[top * stride + right]
  const c = integral[bottom * stride + left]
  const d = integral[bottom * stride + right]
  return d - b - c + a
}

/** 一条候选墙的"墨迹占比"：带宽 thickness 内的墨迹像素 / 带宽面积，∈ [0,1]。 */
export function segmentConfidence(mask: InkMask, integral: Int32Array, segment: RawSegment): number {
  const half = Math.max(0.5, segment.thickness / 2)
  const stride = mask.width + 1
  if (segment.orientation === 'h') {
    const left = clampInt(segment.from, 0, mask.width)
    const right = clampInt(segment.to, 0, mask.width)
    const top = clampInt(segment.cross - half, 0, mask.height)
    const bottom = clampInt(segment.cross + half, 0, mask.height)
    const area = (right - left) * (bottom - top)
    if (area <= 0) return 0
    return clamp01(sumRect(integral, stride, left, top, right, bottom) / area)
  }
  const top = clampInt(segment.from, 0, mask.height)
  const bottom = clampInt(segment.to, 0, mask.height)
  const left = clampInt(segment.cross - half, 0, mask.width)
  const right = clampInt(segment.cross + half, 0, mask.width)
  const area = (right - left) * (bottom - top)
  if (area <= 0) return 0
  return clamp01(sumRect(integral, stride, left, top, right, bottom) / area)
}

/**
 * 收集候选墙：先用比正式阈值更宽松的最短长度做线带提取（宁多勿少），
 * 再给每条打分。真正的取舍交给 selectWalls。
 */
export function collectCandidates(mask: InkMask, minLengthPx: number): Candidate[] {
  const minSide = Math.min(mask.width, mask.height)
  const collectLength = Math.max(3, Math.round(minLengthPx * 0.5))
  const integral = buildIntegral(mask)
  const segments: RawSegment[] = [
    ...bandsToSegments(extractBands(mask, 'h', collectLength), 'h'),
    ...bandsToSegments(extractBands(mask, 'v', collectLength), 'v'),
  ]
  const lengthNorm = Math.max(1, minSide * 0.25)
  const candidates: Candidate[] = []
  for (const segment of segments) {
    const length = segment.to - segment.from
    if (length <= 0) continue
    const inkRatio = segmentConfidence(mask, integral, segment)
    const confidence = clamp01(inkRatio) * clamp01(length / lengthNorm)
    candidates.push({
      orientation: segment.orientation,
      from: segment.from,
      to: segment.to,
      cross: segment.cross,
      thickness: segment.thickness,
      confidence,
      inkLength: Math.round(inkRatio * length),
    })
  }
  return candidates
}

/** 两条候选墙是否"只能留一条"。tol 为 cross 方向的平行容差（像素）。 */
export function conflicts(a: Candidate, b: Candidate, tol: number): boolean {
  const lenA = a.to - a.from
  const lenB = b.to - b.from
  if (lenA <= 0 || lenB <= 0) return false
  if (a.orientation === b.orientation) {
    // 同向：cross 接近且重叠够多 → 同一条墙的重复描边
    const sameLine = Math.abs(a.cross - b.cross) <= Math.max(tol, Math.min(a.thickness, b.thickness))
    if (!sameLine) return false
    const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from)
    return overlap >= 0.6 * Math.min(lenA, lenB)
  }
  // 异向：求交点，只有交点落在"两条墙都靠中间"的时候才算真交叉冲突；
  // 落在端点附近的是 T 接 / L 接，是正常节点，不能删。
  const horizontal = a.orientation === 'h' ? a : b
  const vertical = a.orientation === 'h' ? b : a
  if (horizontal.to === horizontal.from || vertical.to === vertical.from) return false
  const t = (vertical.cross - horizontal.from) / (horizontal.to - horizontal.from)
  const s = (horizontal.cross - vertical.from) / (vertical.to - vertical.from)
  return t > 0.15 && t < 0.85 && s > 0.15 && s < 0.85
}

/**
 * 全局择优：按置信度降序贪心接受，再跑一轮 swap 改进（用一条高置信墙顶掉
 * 一组低置信的冲突墙）。近似最大权独立集，O(n²)，n≤800 时几十毫秒。
 */
export function selectWalls(candidates: Candidate[], tol: number, options: SelectWallsOptions = {}): Candidate[] {
  const crossConflict = options.crossConflict ?? true
  const isConflict = (a: Candidate, b: Candidate): boolean => {
    if (!crossConflict && a.orientation !== b.orientation) return false
    return conflicts(a, b, tol)
  }
  const sorted = [...candidates].sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence
    return y.to - y.from - (x.to - x.from)
  })
  const accepted: Candidate[] = []
  const rejected: Candidate[] = []
  for (const candidate of sorted) {
    if (candidate.confidence <= 0) continue
    if (accepted.some((other) => isConflict(candidate, other))) rejected.push(candidate)
    else accepted.push(candidate)
  }
  // 一轮 swap：被拒的墙如果能一次性顶掉所有与之冲突、且总置信度更低的已选墙，就换进来
  for (const candidate of rejected) {
    const blockers = accepted.filter((other) => isConflict(candidate, other))
    if (blockers.length === 0) continue
    const blockerWeight = blockers.reduce((sum, item) => sum + item.confidence, 0)
    if (candidate.confidence - blockerWeight <= 0.02) continue
    for (const blocker of blockers) {
      const index = accepted.indexOf(blocker)
      if (index >= 0) accepted.splice(index, 1)
    }
    accepted.push(candidate)
  }
  return accepted
}
