import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

// plan-schema 是 CommonJS 包（"type": "commonjs"），用 require 拿它的 dist/cjs 构建。
const require = createRequire(import.meta.url)
const { EMPTY_PLAN_DOCUMENT, PlanDocumentSchema } = require('@home-design/plan-schema')

import {
  applyRecognizedFloorplan,
  binarize,
  extractBands,
  findRegions,
  isSelfIntersecting,
  mergeCollinear,
  mergeParallelFaces,
  otsuThreshold,
  pruneIsolatedShorts,
  recognizeFloorplan,
  rgbaToGray,
  signedArea,
  simplifyPolygon,
  snapEndpoints,
} from './plan-recognition.ts'

/* ------------------------------------------------------------------ 测试工具 */

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
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue
      const offset = (y * canvas.width + x) * 4
      canvas.data[offset] = color[0]
      canvas.data[offset + 1] = color[1]
      canvas.data[offset + 2] = color[2]
      canvas.data[offset + 3] = color[3]
    }
  }
}

function grayOf(canvas) {
  return rgbaToGray(canvas.data, canvas.width, canvas.height)
}

/**
 * 画一个 400x300 的封闭矩形房间：外墙 8px 厚。
 * 可选加一道竖向内墙，内墙中间留 30px 的缺口当门。
 */
function drawPlan({ withDoorGap = false } = {}) {
  const canvas = createCanvas(400, 300)
  const thickness = 8
  fillRect(canvas, 20, 20, 380, 20 + thickness) // 上
  fillRect(canvas, 20, 280 - thickness, 380, 280) // 下
  fillRect(canvas, 20, 20, 20 + thickness, 280) // 左
  fillRect(canvas, 380 - thickness, 20, 380, 280) // 右
  if (withDoorGap) {
    fillRect(canvas, 196, 20, 204, 150) // 内墙上半段
    fillRect(canvas, 196, 180, 204, 280) // 内墙下半段（中间 30px 缺口 = 门）
  }
  return canvas
}

/* ------------------------------------------------------------------ 单元 */

test('rgbaToGray 把透明像素当白底，半透明按白底合成', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128])
  const gray = rgbaToGray(rgba, 3, 1)
  assert.equal(gray.data[0], 255)
  assert.equal(gray.data[1], 0)
  assert.ok(gray.data[2] > 100 && gray.data[2] < 160)
})

test('otsuThreshold 能把黑白两峰分开', () => {
  const canvas = createCanvas(10, 10)
  fillRect(canvas, 0, 0, 5, 10)
  const threshold = otsuThreshold(grayOf(canvas))
  assert.ok(threshold >= 0 && threshold < 255)
  const mask = binarize(grayOf(canvas), threshold)
  assert.equal(mask.data[0], 1)
  assert.equal(mask.data[9], 0)
})

test('binarize 在深色底图纸上自动反相', () => {
  const canvas = createCanvas(40, 40, BLACK)
  fillRect(canvas, 10, 10, 20, 20, WHITE)
  const mask = binarize(grayOf(canvas))
  // 反相后：白色方块是墨迹
  assert.equal(mask.data[15 * 40 + 15], 1)
  assert.equal(mask.data[0], 0)
})

test('extractBands 能测出粗线的厚度和范围', () => {
  const canvas = createCanvas(100, 40)
  fillRect(canvas, 10, 15, 90, 20)
  const mask = binarize(grayOf(canvas))
  const bands = extractBands(mask, 'h', 10)
  assert.equal(bands.length, 1)
  assert.equal(bands[0].from, 10)
  assert.equal(bands[0].to, 90)
  assert.equal(bands[0].crossEnd - bands[0].crossStart, 5)
})

test('mergeCollinear 把同一条线上被打断的墙接起来', () => {
  const segments = [
    { orientation: 'h', from: 0, to: 50, cross: 10, thickness: 4 },
    { orientation: 'h', from: 54, to: 120, cross: 10, thickness: 4 },
    { orientation: 'h', from: 0, to: 40, cross: 80, thickness: 4 },
  ]
  const merged = mergeCollinear(segments)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].from, 0)
  assert.equal(merged[0].to, 120)
})

test('mergeParallelFaces 把双线墙合成一条并加大厚度', () => {
  const segments = [
    { orientation: 'h', from: 0, to: 200, cross: 100, thickness: 2 },
    { orientation: 'h', from: 0, to: 200, cross: 110, thickness: 2 },
  ]
  const merged = mergeParallelFaces(segments, 14)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].cross, 105)
  assert.ok(merged[0].thickness >= 10)
})

test('snapEndpoints 让横竖墙的拐角真正闭合', () => {
  // 横墙右端差 3px 才到竖墙，竖墙上端差 3px 才到横墙：两条都应该被吸上去。
  const segments = [
    { orientation: 'h', from: 3, to: 197, cross: 100, thickness: 6 },
    { orientation: 'v', from: 97, to: 197, cross: 200, thickness: 6 },
  ]
  const snapped = snapEndpoints(segments)
  assert.equal(snapped[0].to, 200)
  assert.equal(snapped[1].from, 100)
})

test('simplifyPolygon 去掉共线的中间点', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  assert.deepEqual(simplifyPolygon(points), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ])
})

test('signedArea / isSelfIntersecting', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  assert.equal(signedArea(square), 100)
  assert.equal(isSelfIntersecting(square), false)
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ]
  assert.equal(isSelfIntersecting(bowtie), true)
})

test('findRegions 丢弃触碰边界的区域', () => {
  const width = 40
  const height = 40
  const data = new Uint8Array(width * height)
  // 中间画一个封闭方框
  for (let x = 10; x <= 30; x += 1) {
    data[10 * width + x] = 1
    data[30 * width + x] = 1
  }
  for (let y = 10; y <= 30; y += 1) {
    data[y * width + 10] = 1
    data[y * width + 30] = 1
  }
  const { regions } = findRegions({ width, height, data }, { left: 0, right: width - 1, top: 0, bottom: height - 1 })
  assert.equal(regions.length, 1)
  assert.ok(regions[0].area > 200)
})

/* ------------------------------------------------------------------ 端到端 */

test('识别封闭矩形户型：4 面墙 + 1 个房间', () => {
  const result = recognizeFloorplan(grayOf(drawPlan()), { targetWidthCm: 1200 })
  assert.equal(result.walls.length, 4, `实际墙数 ${result.walls.length}`)
  assert.equal(result.rooms.length, 1, `实际房间数 ${result.rooms.length}`)
  // 1200cm 的图幅 + 两侧各 100cm 边距 = 1400cm
  assert.ok(result.stats.widthCm > 1300 && result.stats.widthCm < 1500, `实际宽度 ${result.stats.widthCm}`)
  for (const wall of result.walls) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    assert.ok(length >= 10, `墙长 ${length} 小于 10cm`)
    assert.ok(wall.thickness >= 5 && wall.thickness <= 50, `墙厚 ${wall.thickness} 越界`)
  }
})

test('识别结果能通过 PlanDocumentSchema 校验', () => {
  const result = recognizeFloorplan(grayOf(drawPlan()), { targetWidthCm: 1000 })
  const document = {
    ...structuredClone(EMPTY_PLAN_DOCUMENT),
    walls: result.walls.map((wall) => ({ ...wall })),
    rooms: result.rooms.map((room) => ({ ...room })),
    openings: result.openings.map((opening) => ({ ...opening })),
  }
  const parsed = PlanDocumentSchema.safeParse(document)
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5), null, 2))
})

test('内墙缺口被识别成门，且落在正确的墙上', () => {
  const result = recognizeFloorplan(grayOf(drawPlan({ withDoorGap: true })), { targetWidthCm: 1200 })
  assert.ok(result.openings.length >= 1, '没有识别出门')
  const door = result.openings[0]
  assert.equal(door.type, 'door')
  assert.equal(door.sillHeight, 0)
  assert.ok(door.width >= 45 && door.width <= 260, `门宽 ${door.width} 越界`)
  const host = result.walls.find((wall) => wall.id === door.wallId)
  assert.ok(host, '门引用的墙不存在')
  const hostLength = Math.hypot(host.end.x - host.start.x, host.end.y - host.start.y)
  assert.ok(door.offset >= 0 && door.offset + door.width <= hostLength + 1e-6)

  const document = {
    ...structuredClone(EMPTY_PLAN_DOCUMENT),
    walls: result.walls,
    rooms: result.rooms,
    openings: result.openings,
  }
  const parsed = PlanDocumentSchema.safeParse(document)
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5), null, 2))
})

test('识别出的所有 id 都是 UUID 且互不重复', () => {
  const result = recognizeFloorplan(grayOf(drawPlan({ withDoorGap: true })), { targetWidthCm: 1200 })
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const ids = [...result.walls, ...result.rooms, ...result.openings].map((item) => item.id)
  for (const id of ids) assert.match(id, uuid)
  assert.equal(new Set(ids).size, ids.length)
})

test('空白图片返回空结果并给出提示，不抛异常', () => {
  const result = recognizeFloorplan(grayOf(createCanvas(200, 200)), {})
  assert.equal(result.walls.length, 0)
  assert.equal(result.rooms.length, 0)
  assert.ok(result.warnings.length > 0)
})

test('detectRooms=false 时只出墙不出房间', () => {
  const result = recognizeFloorplan(grayOf(drawPlan()), { detectRooms: false })
  assert.equal(result.rooms.length, 0)
  assert.equal(result.walls.length, 4)
})

test('pruneIsolatedShorts 丢掉孤立碎块，但保留搭在长墙上的短垛子', () => {
  const segments = [
    { orientation: 'h', from: 0, to: 300, cross: 100, thickness: 8 },
    { orientation: 'v', from: 100, to: 300, cross: 0, thickness: 8 },
    // 孤立的小块（像"主卧"两个字），和长墙没有交点
    { orientation: 'h', from: 150, to: 168, cross: 200, thickness: 8 },
    // 搭在长墙上的短垛子：应该保留
    { orientation: 'v', from: 100, to: 130, cross: 120, thickness: 8 },
  ]
  const pruned = pruneIsolatedShorts(segments, 60, 8)
  assert.equal(pruned.length, 3, `实际保留 ${pruned.length} 条`)
  assert.ok(pruned.some((segment) => segment.cross === 120 && segment.orientation === 'v'))
  assert.ok(!pruned.some((segment) => segment.from === 150 && segment.to === 168))
})

test('房间名/尺寸数字这类文字不会变成墙', () => {
  const canvas = drawPlan()
  // 在房间内部画几条像文字的短粗笔画（和墙不相交，长度远小于墙）
  fillRect(canvas, 120, 140, 136, 150)
  fillRect(canvas, 144, 140, 158, 150)
  fillRect(canvas, 120, 156, 128, 172)
  const result = recognizeFloorplan(grayOf(canvas), { targetWidthCm: 1200 })
  assert.equal(result.walls.length, 4, `实际墙数 ${result.walls.length}`)
  assert.equal(result.rooms.length, 1, `实际房间数 ${result.rooms.length}`)
})

test('门洞两侧仍算两个房间（房间检测会补上门洞）', () => {
  const result = recognizeFloorplan(grayOf(drawPlan({ withDoorGap: true })), { targetWidthCm: 1200 })
  assert.equal(result.rooms.length, 2, `实际房间数 ${result.rooms.length}`)
  assert.ok(result.openings.length >= 1)
})

/** 一笔矩形线框（细线），用来画"双线墙"的内外两条线。 */
function strokeFrame(canvas, left, top, right, bottom, thickness = 2) {
  fillRect(canvas, left, top, right, top + thickness)
  fillRect(canvas, left, bottom - thickness, right, bottom)
  fillRect(canvas, left, top, left + thickness, bottom)
  fillRect(canvas, right - thickness, top, right, bottom)
}

/**
 * CAD 常见的"双线墙"画法：一堵墙 = 两条平行细线 + 中间留白。
 * 间距（墙厚）18px，远超老版本写死的 14px，正是"墙重复一倍"的触发条件。
 */
function drawDoubleLinePlan() {
  const canvas = createCanvas(600, 460)
  const thickness = 18
  strokeFrame(canvas, 40, 40, 560, 420, 2) // 外墙外侧
  strokeFrame(canvas, 40 + thickness, 40 + thickness, 560 - thickness, 420 - thickness, 2) // 外墙内侧
  // 竖向内墙（双线），中间留 80px 门洞
  fillRect(canvas, 300, 58, 302, 190)
  fillRect(canvas, 300 + thickness, 58, 302 + thickness, 190)
  fillRect(canvas, 300, 270, 302, 402)
  fillRect(canvas, 300 + thickness, 270, 302 + thickness, 402)
  return canvas
}

test('双线画法的墙会合并成一堵，而不是每堵变成两条', () => {
  const result = recognizeFloorplan(grayOf(drawDoubleLinePlan()), { targetWidthCm: 1200 })
  // 4 面外墙 + 1 面内墙 = 5；老实现会得到 10~12 面
  assert.equal(result.walls.length, 5, `实际墙数 ${result.walls.length}`)
  assert.equal(result.rooms.length, 2, `实际房间数 ${result.rooms.length}`)
  assert.ok(result.openings.length >= 1, '内墙缺口应识别成门')
  // 合并后墙厚应该接近真实墙厚（十几厘米），而不是单根线的 2~5cm
  for (const wall of result.walls) {
    assert.ok(wall.thickness >= 10, `墙厚 ${wall.thickness} 太小，说明双线没合并`)
  }
})

const DARK = [70, 74, 80, 255]
const RED = [220, 80, 70, 255]
const LIGHT = [210, 214, 218, 255]
const GRAY_TEXT = [120, 120, 120, 255]

/**
 * 真实渲染式户型图：粗深灰墙 + 浅灰家具填充块 + 红色细家具轮廓 + 灰色文字/尺寸线。
 * 这是"70 面墙"那类噪声的主要来源，用开运算应该把细线全部滤掉。
 */
function drawNoisyThickPlan() {
  const canvas = createCanvas(1250, 980)
  const thickness = 9
  const L = 100, R = 1100, TP = 100, B = 850
  const hw = (x1, x2, y) => fillRect(canvas, x1, y - 4, x2, y + 5, DARK)
  const vw = (y1, y2, x) => fillRect(canvas, x - 4, y1, x + 5, y2, DARK)
  hw(L, R, TP); hw(L, R, B); vw(TP, B, L); vw(TP, B, R)
  vw(TP, 330, 380); vw(430, B, 380)
  vw(TP, 260, 700); vw(360, 600, 700); vw(700, B, 700)
  vw(TP, 300, 920); vw(400, B, 920)
  hw(L, 380, 470); hw(380, 700, 600); hw(800, 920, 600)
  // 家具：浅灰填充 + 红色细轮廓（2px），应当被开运算整块抛弃
  for (const [x1, y1, x2, y2] of [[150, 150, 300, 260], [430, 480, 600, 620], [760, 150, 880, 260], [960, 620, 1060, 760]]) {
    fillRect(canvas, x1, y1, x2, y2, LIGHT)
    fillRect(canvas, x1, y1, x2, y1 + 2, RED)
    fillRect(canvas, x1, y2 - 2, x2, y2, RED)
    fillRect(canvas, x1, y1, x1 + 2, y2, RED)
    fillRect(canvas, x2 - 2, y1, x2, y2, RED)
  }
  // 文字笔画 + 尺寸线（1~2px）
  for (const [x, y] of [[180, 210], [500, 210], [800, 200], [1000, 250], [180, 580], [500, 720], [800, 720], [1000, 680]]) {
    fillRect(canvas, x, y - 1, x + 26, y + 1, GRAY_TEXT)
    fillRect(canvas, x + 11, y - 20, x + 13, y, GRAY_TEXT)
  }
  fillRect(canvas, L, 51, R, 53, GRAY_TEXT)
  fillRect(canvas, L, 897, R, 899, GRAY_TEXT)
  return canvas
}

test('粗墙彩色图里的家具/红标注/文字不会变成一堆假墙', () => {
  const result = recognizeFloorplan(grayOf(drawNoisyThickPlan()), { targetWidthCm: 1200 })
  // 真正的墙是 9 面；有噪声时老实现会膨胀到几十面
  assert.ok(result.walls.length <= 12, `实际墙数 ${result.walls.length} 太多，噪声没滤掉`)
  assert.ok(result.rooms.length >= 5, `实际房间数 ${result.rooms.length} 太少，墙没闭合`)
  for (const wall of result.walls) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    assert.ok(length >= 100, `出现了 ${length.toFixed(0)}cm 的碎墙`)
  }
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

test('图里的家具符号会被识别成家具，尺寸和素材都合理', () => {
  const result = recognizeFloorplan(grayOf(drawNoisyThickPlan()), { targetWidthCm: 1200 })
  // 图里画了 4 个家具矩形
  assert.ok(result.furniture.length >= 3, `只识别到 ${result.furniture.length} 件家具`)
  assert.equal(result.stats.furnitureCount, result.furniture.length)
  for (const item of result.furniture) {
    assert.match(item.id, UUID_PATTERN)
    assert.match(item.assetId, UUID_PATTERN)
    assert.ok(item.width >= 1 && item.width <= 2000, `家具宽度异常：${item.width}`)
    assert.ok(item.depth >= 1 && item.depth <= 2000, `家具进深异常：${item.depth}`)
    assert.ok(item.height >= 1 && item.height <= 2000)
    assert.equal(item.rotation, 0)
    assert.equal(item.locked, false)
    assert.ok(item.position.x >= 0 && item.position.x <= 10000)
    assert.ok(item.position.y >= 0 && item.position.y <= 10000)
  }
  // 家具写回文档后要能通过整体校验
  const merged = applyRecognizedFloorplan(
    { ...EMPTY_PLAN_DOCUMENT, walls: [], rooms: [], openings: [], furniture: [] },
    result,
    'replace',
  )
  const parsed = PlanDocumentSchema.safeParse({
    ...EMPTY_PLAN_DOCUMENT,
    walls: merged.walls,
    rooms: merged.rooms,
    openings: merged.openings,
    furniture: merged.furniture,
  })
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues?.slice(0, 3)))
})

test('detectFurniture=false 时不识别家具', () => {
  const result = recognizeFloorplan(grayOf(drawNoisyThickPlan()), { targetWidthCm: 1200, detectFurniture: false })
  assert.equal(result.furniture.length, 0)
  assert.equal(result.stats.furnitureCount, 0)
})


