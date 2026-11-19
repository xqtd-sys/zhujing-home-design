/**
 * 墙节点（junction）处理：端点聚类 → T 型拆分 → 开口闭合。
 *
 * 解决什么问题：原来的识别结果里，两堵本该在这里交汇的墙，端点可能差 3–5px，
 * 画布上就会亮一堆"橙点"（findOpenWallEndpoints 认为它们没连上）；同时 T 型
 * 交接处如果一条墙直接从另一条墙身上穿过去（不打断），后面的房间分割和 3D 挤墙
 * 都会算错。
 *
 * 三步：
 *   1. clusterJunctions —— 把所有墙端点按 tol 做网格哈希聚类，合并成同一个节点，
 *      并把端点吸附到节点坐标（吸附后端点坐标完全一致，橙点自然消失）。
 *   2. splitTJunctions —— 节点落在某条墙的"内部"（不是端点）时，在那一点把墙拆成两段，
 *      让每个墙端点都对应一个真实节点。
 *   3. closeOpenJunctions —— 只连了一堵墙的"悬空节点"（degree==1），沿墙方向延长到
 *      最近的垂直墙，把没画完的墙角补上（最大延长 maxExtend）。
 *
 * 本文件不依赖其它识别模块，结构类型 JunctionWall 与 Candidate / CmSegment 兼容。
 */

export type JunctionWall = {
  orientation: 'h' | 'v'
  from: number
  to: number
  cross: number
  thickness: number
  confidence?: number
}

export type Junction = { id: string; x: number; y: number; weight: number }

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 一条墙的两个端点（像素/厘米坐标都行，只要全程单位一致）。 */
function endpointsOf(wall: JunctionWall): Array<{ x: number; y: number }> {
  return wall.orientation === 'h'
    ? [
        { x: wall.from, y: wall.cross },
        { x: wall.to, y: wall.cross },
      ]
    : [
        { x: wall.cross, y: wall.from },
        { x: wall.cross, y: wall.to },
      ]
}

/**
 * 端点聚类：网格哈希 + 查 3×3 邻格（tol 归一化后相邻格足够覆盖），
 * 命中就并入已有节点（坐标按权重加权平均），否则新建。
 * 返回吸附后的墙、节点列表，以及一个 snap(x,y) 用于把任意点吸到最近节点。
 */
export function clusterJunctions(
  walls: JunctionWall[],
  tol: number,
): { walls: JunctionWall[]; junctions: Junction[]; snap: (x: number, y: number) => Junction } {
  const cell = Math.max(1e-6, tol)
  const grid = new Map<string, number[]>()
  const junctions: Junction[] = []
  const cellKey = (cx: number, cy: number): string => `${cx},${cy}`

  const findNear = (x: number, y: number): number => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    let best = -1
    let bestDistance = tol
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const list = grid.get(cellKey(cx + dx, cy + dy))
        if (!list) continue
        for (const index of list) {
          const junction = junctions[index]
          const distance = Math.hypot(junction.x - x, junction.y - y)
          if (distance <= bestDistance) {
            bestDistance = distance
            best = index
          }
        }
      }
    }
    return best
  }

  for (const wall of walls) {
    const weight = Math.max(0.05, wall.confidence ?? 1)
    for (const point of endpointsOf(wall)) {
      const found = findNear(point.x, point.y)
      if (found < 0) {
        const index = junctions.length
        junctions.push({ id: '', x: point.x, y: point.y, weight })
        const key = cellKey(Math.floor(point.x / cell), Math.floor(point.y / cell))
        const list = grid.get(key)
        if (list) list.push(index)
        else grid.set(key, [index])
      } else {
        const junction = junctions[found]
        const total = junction.weight + weight
        junction.x = (junction.x * junction.weight + point.x * weight) / total
        junction.y = (junction.y * junction.weight + point.y * weight) / total
        junction.weight = total
      }
    }
  }

  junctions.forEach((junction, index) => {
    junction.id = `J${index + 1}`
  })

  // 聚类中心的加权平均可能让节点离开原来的网格格，所以 snap 走全表最近（节点数量有限，够快）
  const snap = (x: number, y: number): Junction => {
    let best = 0
    let bestDistance = Infinity
    for (let index = 0; index < junctions.length; index += 1) {
      const distance = Math.hypot(junctions[index].x - x, junctions[index].y - y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    }
    return junctions[best]
  }

  const snappedWalls = walls.map((wall) => {
    if (wall.orientation === 'h') {
      const a = snap(wall.from, wall.cross)
      const b = snap(wall.to, wall.cross)
      return {
        ...wall,
        from: round1(Math.min(a.x, b.x)),
        to: round1(Math.max(a.x, b.x)),
        cross: round1((a.y + b.y) / 2),
      }
    }
    const a = snap(wall.cross, wall.from)
    const b = snap(wall.cross, wall.to)
    return {
      ...wall,
      from: round1(Math.min(a.y, b.y)),
      to: round1(Math.max(a.y, b.y)),
      cross: round1((a.x + b.x) / 2),
    }
  })

  return { walls: snappedWalls, junctions, snap }
}

/**
 * T 型拆分：节点落在一条墙的内部（投影 t∈(0.12,0.88) 且垂距 ≤ tol）时，
 * 在节点处把墙拆成两段，两段都保留原来的 thickness / confidence。
 */
export function splitTJunctions(walls: JunctionWall[], junctions: Junction[], tol: number): JunctionWall[] {
  const result: JunctionWall[] = []
  for (const wall of walls) {
    const length = wall.to - wall.from
    if (length <= 0) {
      result.push(wall)
      continue
    }
    const cuts: number[] = []
    for (const junction of junctions) {
      if (wall.orientation === 'h') {
        const perpendicular = Math.abs(junction.y - wall.cross)
        if (perpendicular > tol) continue
        const t = (junction.x - wall.from) / length
        if (t > 0.12 && t < 0.88) cuts.push(junction.x)
      } else {
        const perpendicular = Math.abs(junction.x - wall.cross)
        if (perpendicular > tol) continue
        const t = (junction.y - wall.from) / length
        if (t > 0.12 && t < 0.88) cuts.push(junction.y)
      }
    }
    if (cuts.length === 0) {
      result.push(wall)
      continue
    }
    cuts.sort((a, b) => a - b)
    let cursor = wall.from
    for (const cut of cuts) {
      if (cut - cursor > 1e-6) result.push({ ...wall, from: round1(cursor), to: round1(cut) })
      cursor = Math.max(cursor, cut)
    }
    if (wall.to - cursor > 1e-6) result.push({ ...wall, from: round1(cursor), to: round1(wall.to) })
  }
  return result
}

/**
 * 判断点是否已经"贴"在另一堵垂直墙的身上（T 型接法，但没有生成节点）。
 *
 * 为什么需要它：`splitTJunctions` 是可选步骤，默认不拆；不拆的时候，一条墙的端点
 * 虽然已经顶在另一条墙的侧面，但它不是任何墙的端点，于是被算成 degree==1 的悬空端，
 * 接着被 `closeOpenJunctions` 沿着自身方向一路延长到最外侧的墙 —— 房间会被多切一刀。
 */
function touchesWallBody(walls: JunctionWall[], point: { x: number; y: number }, self: JunctionWall): boolean {
  for (const other of walls) {
    if (other === self || other.orientation === self.orientation) continue
    const low = Math.min(other.from, other.to)
    const high = Math.max(other.from, other.to)
    const along = self.orientation === 'h' ? point.x : point.y
    const across = self.orientation === 'h' ? point.y : point.x
    if (along < low - 0.5 || along > high + 0.5) continue
    // 半厚 + 1px 容差：墙线本身有宽度，端点落在墙身上就算连上了。
    if (Math.abs(across - other.cross) <= Math.max(2, other.thickness / 2 + 1)) return true
  }
  return false
}

/**
 * 开口闭合：只属于一个节点（degree==1）的墙端点，沿自身方向延长到最近的"垂直墙"，
 * 把漏画的墙角补上。垂直墙必须在延长方向上、距离 ≤ maxExtend，且其长度范围覆盖该端点。
 */
export function closeOpenJunctions(
  walls: JunctionWall[],
  junctions: Junction[],
  maxExtend: number,
): JunctionWall[] {
  if (maxExtend <= 0 || junctions.length === 0) return walls
  // 统计每个节点被多少墙端点使用
  const usage = new Map<string, number>()
  const junctionAt = (x: number, y: number): Junction | null => {
    let best: Junction | null = null
    let bestDistance = Infinity
    for (const junction of junctions) {
      const distance = Math.hypot(junction.x - x, junction.y - y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = junction
      }
    }
    return best && bestDistance <= 1e-3 ? best : null
  }
  for (const wall of walls) {
    for (const point of endpointsOf(wall)) {
      const junction = junctionAt(point.x, point.y)
      if (!junction) continue
      usage.set(junction.id, (usage.get(junction.id) ?? 0) + 1)
    }
  }

  const result: JunctionWall[] = []
  for (const wall of walls) {
    let { from, to, cross } = wall
    const endpoints: Array<{ x: number; y: number }> = endpointsOf(wall)
    for (let which = 0; which < 2; which += 1) {
      const point = endpoints[which]
      const junction = junctionAt(point.x, point.y)
      if (!junction) continue
      if ((usage.get(junction.id) ?? 0) !== 1) continue
      // 端点已经顶在另一条墙的侧面（T 型接法）时不必再延长：那已经是连上的，
      // 再往外拉只会把一整间房切碎。`splitTJunctions` 打开时这里通常不会命中，
      // 关闭时（默认）正是靠这行拦住"多切一刀"。
      if (touchesWallBody(walls, point, wall)) continue
      if (wall.orientation === 'h') {
        const sign = which === 0 ? -1 : 1
        let bestX: number | null = null
        let bestDistance = Infinity
        for (const other of walls) {
          if (other === wall || other.orientation !== 'v') continue
          const distance = (other.cross - point.x) * sign
          if (distance <= 0 || distance > maxExtend) continue
          if (point.y < Math.min(other.from, other.to) - 0.5 || point.y > Math.max(other.from, other.to) + 0.5) continue
          if (distance < bestDistance) {
            bestDistance = distance
            bestX = other.cross
          }
        }
        if (bestX !== null) {
          // 如果延长方向上还有一条共线的墙（同一 cross、端点就在前方 maxExtend 之内），
          // 说明这里是一个"门洞"而不是漏画的墙角 —— 补上会把门焊死，必须跳过。
          const collinearAhead = walls.some((other) => {
            if (other === wall || other.orientation !== 'h') return false
            if (Math.abs(other.cross - cross) > Math.max(2, wall.thickness)) return false
            return sign > 0
              ? other.from >= point.x - 0.5 && other.from - point.x <= maxExtend
              : other.to <= point.x + 0.5 && point.x - other.to <= maxExtend
          })
          if (!collinearAhead) {
            if (which === 0) from = round1(bestX)
            else to = round1(bestX)
          }
        }
      } else {
        const sign = which === 0 ? -1 : 1
        let bestY: number | null = null
        let bestDistance = Infinity
        for (const other of walls) {
          if (other === wall || other.orientation !== 'h') continue
          const distance = (other.cross - point.y) * sign
          if (distance <= 0 || distance > maxExtend) continue
          if (point.x < Math.min(other.from, other.to) - 0.5 || point.x > Math.max(other.from, other.to) + 0.5) continue
          if (distance < bestDistance) {
            bestDistance = distance
            bestY = other.cross
          }
        }
        if (bestY !== null) {
          const collinearAhead = walls.some((other) => {
            if (other === wall || other.orientation !== 'v') return false
            if (Math.abs(other.cross - cross) > Math.max(2, wall.thickness)) return false
            return sign > 0
              ? other.from >= point.y - 0.5 && other.from - point.y <= maxExtend
              : other.to <= point.y + 0.5 && point.y - other.to <= maxExtend
          })
          if (!collinearAhead) {
            if (which === 0) from = round1(bestY)
            else to = round1(bestY)
          }
        }
      }
    }
    if (from !== wall.from || to !== wall.to || cross !== wall.cross) result.push({ ...wall, from, to, cross })
    else result.push(wall)
  }
  return result
}
