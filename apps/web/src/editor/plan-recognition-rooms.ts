/**
 * 房间分割：距离场 + 多尺度种子 + 分水岭（替代原来的"栅格化墙 → 泛洪填色"）。
 *
 * 原来的做法有个硬伤：墙中间只要有门洞（30–80px 的缺口），泛洪就会从缺口灌过去，
 * 把两个房间连成一间，或者整层只剩一个大房间 —— 这就是"只识别到 3 个房间"的根因。
 *
 * 新做法的核心思路：
 *   1. distanceTransform —— 算每个像素到最近墙体的距离，房间中心是距离的"山峰"。
 *   2. multiScaleSeeds —— 在多个尺度上找距离山峰，作为每个房间的种子。
 *   3. watershedSeeds —— 从山峰往下"灌水"，两股水相遇的地方就是分界线；
 *      门洞处距离场是个鞍部（山脊穿过门洞），分水岭正好在那里切一刀 → 房间数正确。
 *   4. mergeAdjacentRooms —— 把过小的碎块并进邻居、把"中间根本没墙"的两块并回去。
 *
 * 全部手写，不引入任何 npm 依赖。
 */

export type RoomRegion = { label: number; area: number; left: number; right: number; top: number; bottom: number }

/**
 * 两遍 chamfer(3-4) 距离变换。barrier[i] 非 0 表示墙体，返回每个像素到最近墙体的距离（像素）。
 * 复杂度 O(宽*高)。
 */
export function distanceTransform(barrier: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9
  const distance = new Float32Array(width * height)
  for (let index = 0; index < distance.length; index += 1) distance[index] = barrier[index] ? 0 : INF
  const limit = Math.max(width, height)
  for (let y = 0; y < height; y += 1) {
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const index = base + x
      if (distance[index] === 0) continue
      let value = distance[index]
      if (x > 0) value = Math.min(value, distance[index - 1] + 3)
      if (y > 0) value = Math.min(value, distance[index - width] + 3)
      if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + 4)
      if (x < width - 1 && y > 0) value = Math.min(value, distance[index - width + 1] + 4)
      distance[index] = value
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const base = y * width
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = base + x
      if (distance[index] === 0) continue
      let value = distance[index]
      if (x < width - 1) value = Math.min(value, distance[index + 1] + 3)
      if (y < height - 1) value = Math.min(value, distance[index + width] + 3)
      if (x < width - 1 && y < height - 1) value = Math.min(value, distance[index + width + 1] + 4)
      if (x > 0 && y < height - 1) value = Math.min(value, distance[index + width - 1] + 4)
      distance[index] = value
    }
  }
  for (let index = 0; index < distance.length; index += 1) {
    const value = distance[index]
    distance[index] = value >= INF / 2 ? limit : value / 3
  }
  return distance
}

/** 可分离盒式模糊（滑动窗口），边缘按 clamp 处理。 */
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return source
  const window = radius * 2 + 1
  const horizontal = new Float32Array(source.length)
  const out = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    const base = y * width
    let sum = 0
    for (let k = -radius; k <= radius; k += 1) sum += source[base + Math.min(width - 1, Math.max(0, k))]
    for (let x = 0; x < width; x += 1) {
      horizontal[base + x] = sum / window
      sum -= source[base + Math.min(width - 1, Math.max(0, x - radius))]
      sum += source[base + Math.min(width - 1, Math.max(0, x + radius + 1))]
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let k = -radius; k <= radius; k += 1) sum += horizontal[Math.min(height - 1, Math.max(0, k)) * width + x]
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window
      sum -= horizontal[Math.min(height - 1, Math.max(0, y - radius)) * width + x]
      sum += horizontal[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x]
    }
  }
  return out
}

/**
 * 多尺度种子：在若干尺度上做高斯式平滑，取距离场的局部极大值作为房间种子，
 * 用"与已有种子的距离 ≥ 尺度"做非极大抑制，避免同一个房间冒出好几个种子。
 * 返回 Int32Array，0 表示非种子，>0 表示种子编号。
 */
export function multiScaleSeeds(
  distance: Float32Array,
  width: number,
  height: number,
  sigmas: number[],
): Int32Array {
  const seeds = new Int32Array(width * height)
  if (width < 3 || height < 3) return seeds
  let maxDistance = 0
  for (let index = 0; index < distance.length; index += 1) if (distance[index] > maxDistance) maxDistance = distance[index]
  if (maxDistance <= 0) return seeds
  const minSeparation = Math.max(6, Math.round(Math.min(width, height) * 0.01))
  const taken: Array<{ x: number; y: number }> = []
  let next = 0
  const order = [...sigmas].sort((a, b) => b - a)
  for (const sigma of order) {
    const radius = Math.max(1, Math.round(sigma))
    const smooth = boxBlur(distance, width, height, radius)
    const threshold = Math.max(2, sigma * 1.2)
    const need = Math.max(minSeparation, sigma * 1.5)
    for (let y = 2; y < height - 2; y += 1) {
      const base = y * width
      for (let x = 2; x < width - 2; x += 1) {
        const index = base + x
        if (seeds[index]) continue
        const value = smooth[index]
        if (value < threshold) continue
        let isMax = true
        for (let dy = -1; dy <= 1 && isMax; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (smooth[index + dy * width + dx] > value) {
              isMax = false
              break
            }
          }
        }
        if (!isMax) continue
        // 平台去重：只有在平台左/上边界才认（避免一条山脊上冒出很多种子）
        if (value <= smooth[index - 1] && value <= smooth[index - width]) continue
        let ok = true
        for (const seed of taken) {
          if (Math.hypot(seed.x - x, seed.y - y) < need) {
            ok = false
            break
          }
        }
        if (!ok) continue
        next += 1
        seeds[index] = next
        taken.push({ x, y })
        if (next >= 256) return seeds
      }
    }
  }
  return seeds
}

/**
 * 分水岭：按距离从高到低灌水（计数排序实现，O(宽*高)），
 * 每个未标记像素跟随"最高的已标记邻居"，两股水相遇处即为分界线。
 */
export function watershedSeeds(
  distance: Float32Array,
  seeds: Int32Array,
  width: number,
  height: number,
): Int32Array {
  const labels = new Int32Array(seeds.length)
  let maxKey = 0
  for (let index = 0; index < distance.length; index += 1) {
    const value = Math.round(distance[index])
    if (value > maxKey) maxKey = value
  }
  const bucketCount = maxKey + 1
  const counts = new Int32Array(bucketCount + 1)
  let free = 0
  for (let index = 0; index < distance.length; index += 1) {
    if (seeds[index]) {
      labels[index] = seeds[index]
      continue
    }
    if (distance[index] <= 0) continue
    counts[Math.min(maxKey, Math.max(0, Math.round(distance[index]))) + 1] += 1
    free += 1
  }
  for (let key = 1; key <= bucketCount; key += 1) counts[key] += counts[key - 1]
  const order = new Int32Array(free)
  const cursor = counts.slice()
  for (let index = 0; index < distance.length; index += 1) {
    if (seeds[index] || distance[index] <= 0) continue
    const key = Math.min(maxKey, Math.max(0, Math.round(distance[index])))
    order[cursor[key]] = index
    cursor[key] += 1
  }
  // order 已按距离升序（counting sort），从尾巴往前遍历就是"从高到低"
  for (let position = order.length - 1; position >= 0; position -= 1) {
    const index = order[position]
    if (labels[index]) continue
    const x = index % width
    const y = (index - x) / width
    let bestLabel = 0
    let bestDistance = -1
    if (x > 0 && labels[index - 1] && distance[index - 1] > bestDistance) {
      bestDistance = distance[index - 1]
      bestLabel = labels[index - 1]
    }
    if (x < width - 1 && labels[index + 1] && distance[index + 1] > bestDistance) {
      bestDistance = distance[index + 1]
      bestLabel = labels[index + 1]
    }
    if (y > 0 && labels[index - width] && distance[index - width] > bestDistance) {
      bestDistance = distance[index - width]
      bestLabel = labels[index - width]
    }
    if (y < height - 1 && labels[index + width] && distance[index + width] > bestDistance) {
      bestDistance = distance[index + width]
      bestLabel = labels[index + width]
    }
    if (bestLabel) labels[index] = bestLabel
  }
  return labels
}

/** 从标签图统计区域：面积 + 外接框。 */
export function regionsFromLabels(labels: Int32Array, width: number, height: number): RoomRegion[] {
  const byLabel = new Map<number, RoomRegion>()
  for (let y = 0; y < height; y += 1) {
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const label = labels[base + x]
      if (!label) continue
      const region = byLabel.get(label)
      if (region) {
        region.area += 1
        if (x < region.left) region.left = x
        if (x > region.right) region.right = x
        if (y < region.top) region.top = y
        if (y > region.bottom) region.bottom = y
      } else {
        byLabel.set(label, { label, area: 1, left: x, right: x, top: y, bottom: y })
      }
    }
  }
  return [...byLabel.values()]
}

export type MergeOptions = {
  /** 面积小于该值的区域并入邻居。 */
  minArea?: number
  /** 合并后面积超过该值就不合并（防止把整层并成一间）。 */
  maxMergedArea?: number
  /** 公共边界要超过"较短周长"的这个比例才合并。 */
  sharedRatio?: number
  /** 公共边界的绝对下限（像素）。 */
  minShared?: number
}

/**
 * 合并相邻区域：
 *   1. 面积 < minArea 的碎块并入公共边界最长的邻居；
 *   2. 公共边界 > max(minShared, sharedRatio × 较短周长) 且合并后面积 ≤ maxMergedArea 的两块合并
 *      （即"中间其实没墙"，只是分水岭在鞍部切多了）。
 */
export function mergeAdjacentRooms(
  labels: Int32Array,
  width: number,
  height: number,
  options: MergeOptions = {},
): { labels: Int32Array; regions: RoomRegion[] } {
  const minArea = options.minArea ?? 0
  const maxMergedArea = options.maxMergedArea ?? Number.POSITIVE_INFINITY
  const sharedRatio = options.sharedRatio ?? 0.25
  const minShared = options.minShared ?? 1
  const regions = regionsFromLabels(labels, width, height)
  if (regions.length <= 1) return { labels, regions }

  const parent = new Map<number, number>()
  for (const region of regions) parent.set(region.label, region.label)
  const find = (label: number): number => {
    let root = label
    while (parent.get(root) !== root) root = parent.get(root) as number
    while (parent.get(label) !== root) {
      const next = parent.get(label) as number
      parent.set(label, root)
      label = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  // 统计相邻标签对的公共边界长度
  const shared = new Map<number, number>()
  const pairKey = (a: number, b: number): number => (a < b ? a * 1_000_003 + b : b * 1_000_003 + a)
  for (let y = 0; y < height; y += 1) {
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const label = labels[base + x]
      if (!label) continue
      if (x < width - 1) {
        const right = labels[base + x + 1]
        if (right && right !== label) {
          const key = pairKey(label, right)
          shared.set(key, (shared.get(key) ?? 0) + 1)
        }
      }
      if (y < height - 1) {
        const below = labels[base + width + x]
        if (below && below !== label) {
          const key = pairKey(label, below)
          shared.set(key, (shared.get(key) ?? 0) + 1)
        }
      }
    }
  }

  const info = new Map<number, RoomRegion>()
  for (const region of regions) info.set(region.label, { ...region })
  const perimeterOf = (region: RoomRegion): number => 2 * (region.right - region.left + region.bottom - region.top)

  // 1. 小碎块并入公共边界最长的邻居
  if (minArea > 0) {
    const smallOnes = regions.filter((region) => region.area < minArea).sort((a, b) => a.area - b.area)
    for (const region of smallOnes) {
      const root = find(region.label)
      if (root !== region.label) continue
      let bestNeighbor = 0
      let bestShared = 0
      for (const [key, length] of shared) {
        const a = Math.floor(key / 1_000_003)
        const b = key % 1_000_003
        if (a !== region.label && b !== region.label) continue
        const other = a === region.label ? b : a
        if (find(other) === root) continue
        if (length > bestShared) {
          bestShared = length
          bestNeighbor = other
        }
      }
      if (bestNeighbor) union(region.label, bestNeighbor)
    }
  }

  // 2. 公共边界足够长的相邻块合并
  const pairs = [...shared.entries()].sort((a, b) => b[1] - a[1])
  for (const [key, length] of pairs) {
    const a = Math.floor(key / 1_000_003)
    const b = key % 1_000_003
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) continue
    const regionA = info.get(rootA)
    const regionB = info.get(rootB)
    if (!regionA || !regionB) continue
    const need = Math.max(minShared, sharedRatio * Math.min(perimeterOf(regionA), perimeterOf(regionB)))
    if (length < need) continue
    if (regionA.area + regionB.area > maxMergedArea) continue
    union(rootA, rootB)
  }

  // 3. 重新编号
  const remap = new Map<number, number>()
  const out = new Int32Array(labels.length)
  let next = 0
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index]
    if (!label) continue
    const root = find(label)
    let mapped = remap.get(root)
    if (mapped === undefined) {
      next += 1
      mapped = next
      remap.set(root, mapped)
    }
    out[index] = mapped
  }
  return { labels: out, regions: regionsFromLabels(out, width, height) }
}
