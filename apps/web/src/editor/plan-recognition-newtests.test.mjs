/**
 * 新增识别模块的单元测试（对应改造方案 §5.3）。
 * 覆盖：倾斜角估计、候选墙冲突判定、全局择优、节点聚类、T 型拆分、
 * 距离变换、分水岭、房间合并。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { estimateSkewAngle, rotateGray } from './plan-recognition-preprocess.ts'
import { conflicts, collectCandidates, selectWalls } from './plan-recognition-candidates.ts'
import { clusterJunctions, splitTJunctions } from './plan-recognition-junctions.ts'
import { distanceTransform, mergeAdjacentRooms, multiScaleSeeds, regionsFromLabels, watershedSeeds } from './plan-recognition-rooms.ts'

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

function createCanvas(width, height, fill = WHITE) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill[0]
    data[index * 4 + 1] = fill[1]
    data[index * 4 + 2] = fill[2]
    data[index * 4 + 3] = fill[3]
  }
  return { width, height, data }
}

function fillRect(canvas, left, top, right, bottom, color = BLACK) {
  for (let y = Math.max(0, top); y < Math.min(canvas.height, bottom); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(canvas.width, right); x += 1) {
      const offset = (y * canvas.width + x) * 4
      canvas.data[offset] = color[0]
      canvas.data[offset + 1] = color[1]
      canvas.data[offset + 2] = color[2]
      canvas.data[offset + 3] = color[3]
    }
  }
}

function grayOf(canvas) {
  const data = new Uint8Array(canvas.width * canvas.height)
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(
      canvas.data[index * 4] * 0.299 + canvas.data[index * 4 + 1] * 0.587 + canvas.data[index * 4 + 2] * 0.114,
    )
  }
  return { width: canvas.width, height: canvas.height, data }
}

function strokeFrame(canvas, left, top, right, bottom, thickness) {
  fillRect(canvas, left, top, right, top + thickness)
  fillRect(canvas, left, bottom - thickness, right, bottom)
  fillRect(canvas, left, top, left + thickness, bottom)
  fillRect(canvas, right - thickness, top, right, bottom)
}

function makePlanGray() {
  const canvas = createCanvas(400, 300)
  strokeFrame(canvas, 20, 20, 380, 280, 8)
  return grayOf(canvas)
}

test('estimateSkewAngle 能估出约 3 度的倾斜，且返回值喂给 rotateGray 后能摆正', () => {
  const gray = makePlanGray()
  const rotated = rotateGray(gray, 3)
  const angle = estimateSkewAngle(rotated)
  assert.ok(Math.abs(angle) >= 2.5 && Math.abs(angle) <= 3.5, `估出的角度应约 3 度，实际 ${angle}`)
  const corrected = rotateGray(rotated, angle)
  const residual = estimateSkewAngle(corrected)
  assert.ok(Math.abs(residual) < 1, `摆正后残余角度应接近 0，实际 ${residual}`)
})

test('conflicts：平行重叠的两条墙冲突，T 接（端点相交）不冲突', () => {
  const a = { orientation: 'h', from: 0, to: 200, cross: 100, thickness: 6, confidence: 1, inkLength: 200 }
  const parallel = { orientation: 'h', from: 10, to: 190, cross: 103, thickness: 6, confidence: 1, inkLength: 180 }
  const tee = { orientation: 'v', from: 100, to: 300, cross: 200, thickness: 6, confidence: 1, inkLength: 200 }
  assert.equal(conflicts(a, parallel, 3), true)
  assert.equal(conflicts(a, tee, 3), false)
})

test('selectWalls：10 条候选（3 条重复墙 + 7 条真墙）择优后剩 7 条', () => {
  const real = []
  for (let index = 0; index < 7; index += 1) {
    real.push({
      orientation: 'h',
      from: 0,
      to: 200,
      cross: 40 + index * 60,
      thickness: 6,
      confidence: 0.9,
      inkLength: 200,
    })
  }
  const duplicates = [0, 1, 2].map((offset) => ({
    orientation: 'h',
    from: 0,
    to: 200,
    cross: 41 + offset,
    thickness: 6,
    confidence: 0.5,
    inkLength: 200,
  }))
  const selected = selectWalls([...real, ...duplicates], 3)
  assert.equal(selected.length, 7)
})

test('clusterJunctions：端点相差 0.08 的两条墙归到同一个节点', () => {
  const walls = [
    { orientation: 'h', from: 0, to: 100, cross: 100, thickness: 6 },
    { orientation: 'v', from: 100, to: 200, cross: 100.08, thickness: 6 },
  ]
  const { junctions, walls: snapped } = clusterJunctions(walls, 2)
  // 三个位置：(0,100) / (100,100) 与 (100.08,100) 合并 / (100.08,200)
  assert.equal(junctions.length, 3)
  assert.equal(snapped[0].to, snapped[1].from)
})

test('splitTJunctions：横墙中段被竖墙接上时拆成两段', () => {
  const walls = [
    { orientation: 'h', from: 0, to: 200, cross: 100, thickness: 6 },
    { orientation: 'v', from: 100, to: 300, cross: 100, thickness: 6 },
  ]
  const { junctions } = clusterJunctions(walls, 2)
  const split = splitTJunctions(walls, junctions, 2)
  const horizontals = split.filter((wall) => wall.orientation === 'h')
  assert.equal(horizontals.length, 2)
  assert.equal(horizontals[0].to, horizontals[1].from)
})

test('distanceTransform：11x11 方框内部中心的距离为 5', () => {
  const width = 11
  const height = 11
  const barrier = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) barrier[y * width + x] = 1
    }
  }
  const distance = distanceTransform(barrier, width, height)
  assert.equal(Math.round(distance[5 * width + 5]), 5)
})

test('watershedSeeds：30px 门洞两侧仍分成两个区域', () => {
  const width = 120
  const height = 80
  const barrier = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    if (y >= 25 && y < 55) continue
    for (let t = -1; t <= 1; t += 1) barrier[y * width + 60 + t] = 1
  }
  const distance = distanceTransform(barrier, width, height)
  const seeds = new Int32Array(width * height)
  seeds[40 * width + 30] = 1
  seeds[40 * width + 90] = 2
  const labels = watershedSeeds(distance, seeds, width, height)
  const regions = regionsFromLabels(labels, width, height)
  assert.ok(regions.length >= 2, `应至少 2 个区域，实际 ${regions.length}`)
  assert.equal(regions.some((region) => region.label === 1), true)
  assert.equal(regions.some((region) => region.label === 2), true)
})

test('multiScaleSeeds：单个矩形房间只出少量种子（过分割由 mergeAdjacentRooms 兜底）', () => {
  const width = 200
  const height = 140
  const barrier = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) barrier[y * width + x] = 1
    }
  }
  const distance = distanceTransform(barrier, width, height)
  const seeds = multiScaleSeeds(distance, width, height, [8, 16, 24])
  const count = seeds.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0)
  assert.ok(count >= 1 && count <= 8, `种子数应在 1 到 8，实际 ${count}`)
})

test('mergeAdjacentRooms：公共边界很长（中间没墙）的两块会合并成一块', () => {
  const width = 100
  const height = 100
  const labels = new Int32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) labels[y * width + x] = x < 50 ? 1 : 2
  }
  const merged = mergeAdjacentRooms(labels, width, height, {
    minArea: 0,
    maxMergedArea: width * height,
    sharedRatio: 0.25,
    minShared: 2,
  })
  assert.equal(merged.regions.length, 1)
})

test('mergeAdjacentRooms：被墙隔开（中间有空白带）的两块不合并', () => {
  const width = 100
  const height = 100
  const labels = new Int32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 45) labels[y * width + x] = 1
      else if (x > 55) labels[y * width + x] = 2
    }
  }
  const merged = mergeAdjacentRooms(labels, width, height, {
    minArea: 0,
    maxMergedArea: width * height,
    sharedRatio: 0.25,
    minShared: 2,
  })
  assert.equal(merged.regions.length, 2)
})

test('collectCandidates 在矩形线框上至少找到 4 条候选墙', () => {
  const canvas = createCanvas(200, 160)
  fillRect(canvas, 20, 20, 180, 26)
  fillRect(canvas, 20, 134, 180, 140)
  fillRect(canvas, 20, 20, 26, 140)
  fillRect(canvas, 174, 20, 180, 140)
  const gray = grayOf(canvas)
  const mask = { width: gray.width, height: gray.height, data: new Uint8Array(gray.width * gray.height) }
  for (let index = 0; index < mask.data.length; index += 1) mask.data[index] = gray.data[index] < 128 ? 1 : 0
  const candidates = collectCandidates(mask, 12)
  assert.ok(candidates.length >= 4)
})
