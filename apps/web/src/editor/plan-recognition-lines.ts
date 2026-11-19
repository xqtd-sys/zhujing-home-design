/**
 * 线带提取：沿水平/垂直方向扫描墨迹，把相邻且重叠的行程合并成"粗线"。
 *
 * 这是整个识别器最核心的底层一步 —— 它把二值掩膜变成"候选墙段"。
 * 单独成文件是为了让候选图模块（plan-recognition-candidates.ts）能直接复用，
 * 依赖方向保持单向：plan-recognition.ts → 本文件。
 */
import type { InkMask } from './plan-recognition.ts'

/** 一条粗线的原始描述：from/to 是长度方向范围，crossStart/crossEnd 是厚度方向范围。 */
export type Band = { from: number; to: number; crossStart: number; crossEnd: number }

/** 候选墙段的统一结构（像素坐标）。 */
export type RawSegment = { orientation: 'h' | 'v'; from: number; to: number; cross: number; thickness: number }

export function findRuns(line: (index: number) => number, count: number, minLength: number): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let index = 0; index < count; index += 1) {
    if (line(index)) {
      if (start < 0) start = index
    } else if (start >= 0) {
      if (index - start >= minLength) runs.push([start, index])
      start = -1
    }
  }
  if (start >= 0 && count - start >= minLength) runs.push([start, count])
  return runs
}

/**
 * 沿一个方向扫描墨迹，把相邻且重叠的行程合并成"线带"。
 * 线带就是一条粗线：from/to 是长度方向的范围，crossStart/crossEnd 是厚度方向的范围。
 */
export function extractBands(mask: InkMask, orientation: 'h' | 'v', minLength: number): Band[] {
  type Run = { row: number; from: number; to: number }
  const runs: Run[] = []
  if (orientation === 'h') {
    for (let y = 0; y < mask.height; y += 1) {
      const row = y * mask.width
      for (const [from, to] of findRuns((x) => mask.data[row + x], mask.width, minLength)) {
        runs.push({ row: y, from, to })
      }
    }
  } else {
    for (let x = 0; x < mask.width; x += 1) {
      for (const [from, to] of findRuns((y) => mask.data[y * mask.width + x], mask.height, minLength)) {
        runs.push({ row: x, from, to })
      }
    }
  }

  const open: Band[] = []
  const closed: Band[] = []
  let index = 0
  while (index < runs.length) {
    const row = runs[index].row
    const rowRuns: Run[] = []
    while (index < runs.length && runs[index].row === row) {
      rowRuns.push(runs[index])
      index += 1
    }
    const used = new Set<number>()
    const stillOpen: Band[] = []
    for (const band of open) {
      if (band.crossEnd !== row) {
        closed.push(band)
        continue
      }
      let best = -1
      let bestOverlap = 0
      for (let i = 0; i < rowRuns.length; i += 1) {
        if (used.has(i)) continue
        const overlap = Math.min(band.to, rowRuns[i].to) - Math.max(band.from, rowRuns[i].from)
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          best = i
        }
      }
      // 只有"长度相近、且几乎完全重叠"的行程才属于同一条粗线。
      // 否则 L 形拐角处横墙的 360px 行程会把竖墙的 8px 行程吞进去，
      // 整张图纸被并成一个大色块（这是最初版本的 bug）。
      const bandLength = band.to - band.from
      const runLength = best >= 0 ? rowRuns[best].to - rowRuns[best].from : 0
      const shorter = Math.min(bandLength, runLength)
      const longer = Math.max(bandLength, runLength)
      if (best >= 0 && shorter >= longer * 0.5 && bestOverlap >= shorter * 0.8) {
        used.add(best)
        band.from = Math.min(band.from, rowRuns[best].from)
        band.to = Math.max(band.to, rowRuns[best].to)
        band.crossEnd = row + 1
        stillOpen.push(band)
      } else {
        closed.push(band)
      }
    }
    for (let i = 0; i < rowRuns.length; i += 1) {
      if (used.has(i)) continue
      stillOpen.push({ from: rowRuns[i].from, to: rowRuns[i].to, crossStart: row, crossEnd: row + 1 })
    }
    open.length = 0
    open.push(...stillOpen)
  }
  closed.push(...open)
  return closed
}

export function bandsToSegments(bands: Band[], orientation: 'h' | 'v'): RawSegment[] {
  return bands.map((band) => ({
    orientation,
    from: band.from,
    to: band.to,
    cross: (band.crossStart + band.crossEnd) / 2,
    thickness: band.crossEnd - band.crossStart,
  }))
}
