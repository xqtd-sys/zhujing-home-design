/**
 * 预处理：对比度增强（CLAHE 简化版）、自动摆正（倾斜角估计 + 旋转）、多策略去噪打分。
 *
 * 这一层是为了"拍歪了 / 拍暗了 / 背景脏"的真实照片，纯线稿的电子图用不上（可关）。
 * 所有函数都是纯函数、不碰 DOM，能直接在 Web Worker 里跑。
 */
import type { GrayImage, InkMask } from './plan-recognition.ts'
import { closeMask, countInk, downsampleGray, openMask, removeSmallComponents } from './plan-recognition-morph.ts'
import { collectCandidates } from './plan-recognition-candidates.ts'

/**
 * 局部对比度增强（CLAHE 的简化实现）：把图切成 tiles×tiles 的小块，
 * 每块单独做直方图均衡并限制对比度（clipLimit），块与块之间双线性插值消除接缝。
 * 能把"手机拍的发灰户型图"拉回黑白分明，方便后面 Otsu 二值化。
 */
export function enhanceContrast(gray: GrayImage, tiles = 8, clipLimit = 2.5): GrayImage {
  const { width, height, data } = gray
  if (width < 2 || height < 2) return gray
  const tileW = Math.max(1, Math.ceil(width / tiles))
  const tileH = Math.max(1, Math.ceil(height / tiles))
  const tilesX = Math.ceil(width / tileW)
  const tilesY = Math.ceil(height / tileH)
  const maps: Uint8Array[] = []
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const histogram = new Float64Array(256)
      let count = 0
      const yEnd = Math.min(height, (ty + 1) * tileH)
      const xEnd = Math.min(width, (tx + 1) * tileW)
      for (let y = ty * tileH; y < yEnd; y += 1) {
        const base = y * width
        for (let x = tx * tileW; x < xEnd; x += 1) {
          histogram[data[base + x]] += 1
          count += 1
        }
      }
      if (count === 0) {
        maps.push(new Uint8Array(256).map((_, index) => index))
        continue
      }
      const limit = Math.max(1, (clipLimit * count) / 256)
      let excess = 0
      for (let value = 0; value < 256; value += 1) {
        if (histogram[value] > limit) {
          excess += histogram[value] - limit
          histogram[value] = limit
        }
      }
      const topUp = excess / 256
      for (let value = 0; value < 256; value += 1) histogram[value] += topUp
      const lut = new Uint8Array(256)
      let accumulated = 0
      for (let value = 0; value < 256; value += 1) {
        accumulated += histogram[value]
        lut[value] = Math.min(255, Math.round((accumulated / count) * 255))
      }
      maps.push(lut)
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const gridY = (y - tileH / 2) / tileH
    let y0 = Math.floor(gridY)
    const fy = gridY - y0
    let y1 = Math.min(tilesY - 1, y0 + 1)
    y0 = Math.min(tilesY - 1, Math.max(0, y0))
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const gridX = (x - tileW / 2) / tileW
      let x0 = Math.floor(gridX)
      const fx = gridX - x0
      let x1 = Math.min(tilesX - 1, x0 + 1)
      x0 = Math.min(tilesX - 1, Math.max(0, x0))
      const value = data[base + x]
      const m00 = maps[y0 * tilesX + x0][value]
      const m10 = maps[y0 * tilesX + x1][value]
      const m01 = maps[y1 * tilesX + x0][value]
      const m11 = maps[y1 * tilesX + x1][value]
      const top = m00 * (1 - fx) + m10 * fx
      const bottom = m01 * (1 - fx) + m11 * fx
      out[base + x] = Math.round(top * (1 - fy) + bottom * fy)
    }
  }
  return { width, height, data: out }
}

/**
 * 估计"内容倾斜角"（度）。做法：缩到 128px，对每个候选角度把墨迹投影到两个轴上，
 * 投影越尖锐（Σ行和² + Σ列和² 越大）说明墙线越贴合坐标轴。
 *
 * 约定：返回值直接喂给 rotateGray 就能把图摆正（两者用同一套旋转符号）。
 * 角度范围 [-maxDeg, maxDeg]，步长 stepDeg，返回值保留 2 位小数。
 */
export function estimateSkewAngle(gray: GrayImage, maxDeg = 10, stepDeg = 0.5): number {
  const thumb = downsampleGray(gray, 128)
  const { width, height, data } = thumb
  if (width < 8 || height < 8) return 0
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const samplesX: number[] = []
  const samplesY: number[] = []
  const samplesW: number[] = []
  for (let y = 0; y < height; y += 1) {
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const weight = 255 - data[base + x]
      if (weight > 40) {
        samplesX.push(x - centerX)
        samplesY.push(y - centerY)
        samplesW.push(weight)
      }
    }
  }
  if (samplesW.length < 24) return 0
  let bestAngle = 0
  let bestScore = -1
  for (let angle = -maxDeg; angle <= maxDeg + 1e-9; angle += stepDeg) {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rows = new Float64Array(height + 2)
    const cols = new Float64Array(width + 2)
    for (let index = 0; index < samplesW.length; index += 1) {
      const px = samplesX[index]
      const py = samplesY[index]
      const weight = samplesW[index]
      const u = px * cos - py * sin
      const v = px * sin + py * cos
      const rowIndex = Math.round(v + centerY) + 1
      const colIndex = Math.round(u + centerX) + 1
      if (rowIndex >= 0 && rowIndex < rows.length) rows[rowIndex] += weight
      if (colIndex >= 0 && colIndex < cols.length) cols[colIndex] += weight
    }
    let score = 0
    for (let index = 0; index < rows.length; index += 1) score += rows[index] * rows[index]
    for (let index = 0; index < cols.length; index += 1) score += cols[index] * cols[index]
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }
  return Math.round(bestAngle * 100) / 100
}

/**
 * 绕中心旋转灰度图（双线性插值，画布尺寸不变，四角空白填白）。
 *
 * 尺寸保持不变是刻意的：这样识别结果里的像素坐标、transform、背景底图都还在同一个
 * 坐标系里，预览叠加不会错位。代价是旋转角度较大时四角会被裁掉（户型图一般有留白，
 * 影响可以忽略，且我们只在 |angle| > 0.7° 时才真正旋转）。
 */
export function rotateGray(gray: GrayImage, angleDeg: number): GrayImage {
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-6) {
    return { width: gray.width, height: gray.height, data: Uint8Array.from(gray.data) }
  }
  const { width, height, data } = gray
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const out = new Uint8Array(width * height).fill(255)
  const sample = (sx: number, sy: number): number => {
    if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) return 255
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const x1 = Math.min(width - 1, x0 + 1)
    const y1 = Math.min(height - 1, y0 + 1)
    const fx = sx - x0
    const fy = sy - y0
    const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx
    const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx
    return Math.round(top * (1 - fy) + bottom * fy)
  }
  for (let y = 0; y < height; y += 1) {
    const dy = y - centerY
    const base = y * width
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX
      const sx = dx * cos + dy * sin + centerX
      const sy = -dx * sin + dy * cos + centerY
      out[base + x] = sample(sx, sy)
    }
  }
  return { width, height, data: out }
}

/** 给一版去噪掩膜打分：候选墙平均置信度 + 长墙条数加成。分数越高越像"干净的真户型图"。 */
function scoreMask(mask: InkMask, minSide: number): number {
  const candidates = collectCandidates(mask, Math.max(4, Math.round(minSide * 0.02)))
  if (candidates.length === 0) return 0
  const total = candidates.reduce((sum, candidate) => sum + candidate.confidence, 0)
  const longOnes = candidates.filter((candidate) => candidate.to - candidate.from >= minSide * 0.3).length
  return total / candidates.length + longWallsWeight(longOnes)
}

function longWallsWeight(count: number): number {
  return count * 0.06
}

/**
 * 多策略选工作掩膜（chooseWorkingMask 的第二版）：分别生成
 *   ① 只开运算 ② 闭+开 ③ 闭+开+去小连通域
 * 三版，用"候选墙平均置信度 + 长墙条数"打分挑最好的一版。
 *
 * 比只看"墨迹占比是否保留 35%"稳得多：淡墙/断墙被闭运算补上后置信度会上升，
 * 而噪点被开运算/去连通域清掉后平均置信度也会上升。
 */
export function chooseWorkingMaskV2(mask: InkMask, minSide: number): InkMask {
  const rawInk = countInk(mask)
  if (rawInk === 0) return mask
  const radius = Math.max(1, Math.min(4, Math.round(minSide * 0.0018)))
  const minInk = mask.width * mask.height * 0.002
  const variants: InkMask[] = []
  variants.push(openMask(mask, radius))
  const closedOpened = openMask(closeMask(mask, Math.max(1, radius - 1)), radius)
  variants.push(closedOpened)
  const cleaned = removeSmallComponents(closedOpened, Math.max(8, Math.round(minSide * minSide * 0.00002)), 8)
  variants.push(cleaned)

  let best: InkMask | null = null
  let bestScore = -1
  for (const variant of variants) {
    if (countInk(variant) < minInk) continue
    const score = scoreMask(variant, minSide)
    if (score > bestScore) {
      bestScore = score
      best = variant
    }
  }
  return best ?? mask
}
