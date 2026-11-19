/**
 * 户型图识别基准（P0）：用程序生成的样张跑一遍识别，输出墙体/房间/门数量，
 * 和期望区间比对，给出通过率。改动识别算法后先跑这个，避免"改一处、坏一片"。
 *
 * 用法：node --experimental-strip-types tests/recognition-bench.mjs
 * 退出码：全部通过为 0，否则为 1。
 */
import { recognizeFloorplan } from '../apps/web/src/editor/plan-recognition.ts'

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]
const DARK = [70, 74, 80, 255]
const LIGHT = [210, 214, 218, 255]
const RED = [220, 80, 70, 255]
const GRAY_TEXT = [120, 120, 120, 255]

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

function hw(canvas, x1, x2, y, thickness = 8) {
  fillRect(canvas, x1, y - Math.floor(thickness / 2), x2, y + Math.ceil(thickness / 2), BLACK)
}

function vw(canvas, y1, y2, x, thickness = 8) {
  fillRect(canvas, x - Math.floor(thickness / 2), y1, x + Math.ceil(thickness / 2), y2, BLACK)
}

/** 简单矩形户型。 */
function simpleRect() {
  const canvas = createCanvas(400, 300)
  hw(canvas, 20, 380, 24)
  hw(canvas, 20, 380, 276)
  vw(canvas, 20, 280, 24)
  vw(canvas, 20, 280, 376)
  return grayOf(canvas)
}

/** 中间一道内墙，墙上留 30px 门洞。 */
function doorGapPlan() {
  const canvas = createCanvas(400, 300)
  hw(canvas, 20, 380, 24)
  hw(canvas, 20, 380, 276)
  vw(canvas, 20, 280, 24)
  vw(canvas, 20, 280, 376)
  vw(canvas, 20, 150, 200)
  vw(canvas, 180, 280, 200)
  return grayOf(canvas)
}

/** 2×2 四室，各内墙留门洞。 */
function fourRoomPlan() {
  const canvas = createCanvas(800, 600)
  hw(canvas, 20, 780, 24)
  hw(canvas, 20, 780, 576)
  vw(canvas, 20, 580, 24)
  vw(canvas, 20, 580, 776)
  vw(canvas, 20, 250, 400)
  vw(canvas, 320, 580, 400)
  hw(canvas, 20, 330, 300)
  hw(canvas, 440, 780, 300)
  return grayOf(canvas)
}

/** 双线画法（每堵墙两条平行线，间距 18px）。 */
function doubleLinePlan() {
  const canvas = createCanvas(600, 460)
  for (const inset of [40, 58]) {
    hw(canvas, 40 + (inset - 40), 560 - (inset - 40), inset, 2)
    hw(canvas, 40 + (inset - 40), 560 - (inset - 40), 420 - (inset - 40), 2)
    vw(canvas, 40, 420, inset, 2)
    vw(canvas, 40, 420, 560 - (inset - 40), 2)
  }
  vw(canvas, 58, 190, 300, 2)
  vw(canvas, 190, 190, 318, 0)
  vw(canvas, 270, 402, 300, 2)
  vw(canvas, 270, 402, 318, 2)
  return grayOf(canvas)
}

/** 粗墙 + 家具 + 文字 + 尺寸线的"脏"图。 */
function noisyThickPlan() {
  const canvas = createCanvas(1250, 980)
  const L = 100
  const R = 1100
  const TP = 100
  const B = 850
  const th = 9
  const h = (x1, x2, y) => fillRect(canvas, x1, y - 4, x2, y + 5, DARK)
  const v = (y1, y2, x) => fillRect(canvas, x - 4, y1, x + 5, y2, DARK)
  h(L, R, TP)
  h(L, R, B)
  v(TP, B, L)
  v(TP, B, R)
  v(TP, 330, 380)
  v(430, B, 380)
  v(TP, 260, 700)
  v(360, 600, 700)
  v(700, B, 700)
  v(TP, 300, 920)
  v(400, B, 920)
  h(L, 380, 470)
  h(380, 700, 600)
  h(800, 920, 600)
  const blocks = [
    [150, 150, 300, 260],
    [430, 480, 600, 620],
    [760, 150, 880, 260],
    [960, 620, 1060, 760],
  ]
  for (const [left, top, right, bottom] of blocks) {
    fillRect(canvas, left, top, right, bottom, LIGHT)
    fillRect(canvas, left, top, right, top + 2, RED)
    fillRect(canvas, left, bottom - 2, right, bottom, RED)
    fillRect(canvas, left, top, left + 2, bottom, RED)
    fillRect(canvas, right - 2, top, right, bottom, RED)
  }
  for (const [x, y] of [[150, 400], [500, 400], [820, 350], [200, 700], [600, 760], [980, 400], [350, 860], [1000, 760]]) {
    fillRect(canvas, x, y - 1, x + 26, y + 1, GRAY_TEXT)
    fillRect(canvas, x + 11, y - 20, x + 13, y, GRAY_TEXT)
  }
  fillRect(canvas, 150, 51, 1000, 53, GRAY_TEXT)
  fillRect(canvas, 150, 897, 1000, 899, GRAY_TEXT)
  return grayOf(canvas)
}

/** 只有家具、没有墙的负样本。 */
function furnitureOnly() {
  const canvas = createCanvas(600, 400)
  for (const [left, top, right, bottom] of [[100, 100, 240, 200], [330, 120, 470, 260]]) {
    fillRect(canvas, left, top, right, bottom, LIGHT)
    fillRect(canvas, left, top, right, top + 2, RED)
    fillRect(canvas, left, bottom - 2, right, bottom, RED)
    fillRect(canvas, left, top, left + 2, bottom, RED)
    fillRect(canvas, right - 2, top, right, bottom, RED)
  }
  return grayOf(canvas)
}

/** 只有文字、没有墙的负样本。 */
function textOnly() {
  const canvas = createCanvas(600, 400)
  for (let index = 0; index < 20; index += 1) {
    const x = 60 + (index % 5) * 100
    const y = 80 + Math.floor(index / 5) * 80
    fillRect(canvas, x, y, x + 26, y + 2, GRAY_TEXT)
    fillRect(canvas, x + 11, y - 14, x + 13, y, GRAY_TEXT)
    fillRect(canvas, x + 4, y + 8, x + 22, y + 9, GRAY_TEXT)
  }
  return grayOf(canvas)
}

/** 把灰度图按角度做最近邻旋转，用来模拟拍歪的图。 */
function rotateNearest(gray, angleDeg) {
  const { width, height, data } = gray
  const out = new Uint8Array(width * height)
  const radians = (angleDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const cx = width / 2
  const cy = height / 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx
      const dy = y - cy
      const sx = Math.round(dx * cos + dy * sin + cx)
      const sy = Math.round(-dx * sin + dy * cos + cy)
      const value = sx >= 0 && sx < width && sy >= 0 && sy < height ? data[sy * width + sx] : 255
      out[y * width + x] = value
    }
  }
  return { width, height, data: out }
}

const CASES = [
  { name: '矩形户型', gray: simpleRect, rooms: [1, 1], walls: [4, 4], doors: [0, 0] },
  { name: '门洞户型', gray: doorGapPlan, rooms: [2, 2], walls: [5, 6], doors: [1, 3] },
  { name: '四室户型', gray: fourRoomPlan, rooms: [4, 4], walls: [6, 10], doors: [0, 4] },
  { name: '双线画法', gray: doubleLinePlan, rooms: [2, 2], walls: [4, 7], doors: [0, 3] },
  // 这张图本来就有一堆半截墙，天然会分出很多小格子；只要求墙数不炸、房间数别塌成一间。
  { name: '粗墙脏图', gray: noisyThickPlan, rooms: [4, 12], walls: [8, 12], doors: [0, 8] },
  { name: '拍歪 3 度', gray: () => rotateNearest(simpleRect(), 3), rooms: [1, 2], walls: [4, 6], doors: [0, 1] },
  { name: '只有家具（负样本）', gray: furnitureOnly, rooms: [0, 0], walls: [0, 2], doors: [0, 0] },
  { name: '只有文字（负样本）', gray: textOnly, rooms: [0, 0], walls: [0, 0], doors: [0, 0] },
]

function inRange(value, [min, max]) {
  return value >= min && value <= max
}

const rows = []
let passed = 0
for (const item of CASES) {
  const startedAt = performance.now()
  const result = recognizeFloorplan(item.gray(), { targetWidthCm: 1200 })
  const elapsed = performance.now() - startedAt
  const walls = result.walls.length
  const rooms = result.rooms.length
  const doors = result.openings.length
  const ok = inRange(rooms, item.rooms) && inRange(walls, item.walls) && inRange(doors, item.doors)
  if (ok) passed += 1
  rows.push({
    样张: item.name,
    墙: walls,
    房间: rooms,
    门: doors,
    期望: `墙${item.walls[0]}-${item.walls[1]} 房${item.rooms[0]}-${item.rooms[1]}`,
    耗时ms: Math.round(elapsed),
    结果: ok ? 'PASS' : 'FAIL',
  })
}

console.table(rows)
const total = CASES.length
console.log(`\n通过 ${passed}/${total}（${Math.round((passed / total) * 100)}%）`)
process.exit(passed === total ? 0 : 1)
