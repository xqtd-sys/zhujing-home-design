/**
 * 「识别户型图」对话框的可达性回归测试。
 *
 * 背景：弹窗内容（预览 + 参数 + 统计 + 警告）会随识别结果变高，
 * 一旦超过视口高度，底部「替换墙体并导入」就被顶到屏幕外，用户点不到。
 * 这里在多个视口尺寸下真实上传一张户型图、展开高级选项，然后断言
 * 主按钮的包围盒仍在视口内且能真正点下去。
 *
 * 用法：node tests/plan-import-dialog.mjs
 * 环境变量：SMOKE_WEB_URL（默认 http://localhost:5173）、PLAYWRIGHT_CHROME_PATH
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const { EMPTY_PLAN_DOCUMENT } = createRequire(import.meta.url)('@home-design/plan-schema')
const webBase = process.env.SMOKE_WEB_URL ?? 'http://localhost:5173'
const id = '11111111-1111-4111-8111-111111111111'
const ownerId = '44444444-4444-4444-8444-444444444444'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
  { width: 1280, height: 560 },
  { width: 900, height: 500 },
]

/** 现场编码一张 400x300、带 30px 门洞的户型图 PNG，避免往仓库塞二进制样张。 */
function makePlanPng() {
  const width = 400
  const height = 300
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width * 3; x += 1) raw[rowStart + 1 + x] = 255
  }
  const rect = (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const offset = y * (width * 3 + 1) + 1 + x * 3
        raw[offset] = 0
        raw[offset + 1] = 0
        raw[offset + 2] = 0
      }
    }
  }
  rect(20, 20, 380, 28)
  rect(20, 272, 380, 280)
  rect(20, 20, 28, 280)
  rect(372, 20, 380, 280)
  rect(196, 20, 204, 150)
  rect(196, 180, 204, 280)

  const crcTable = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buffer) => {
    let c = 0xffffffff
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const executablePath = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path && existsSync(path))
assert.ok(executablePath, '需要 Chrome 或 Edge')

const browser = await chromium.launch({ executablePath, headless: true })
const plan = {
  id,
  ownerId,
  name: 'dialog layout fixture',
  revision: 1,
  schemaVersion: 1,
  documentJson: structuredClone(EMPTY_PLAN_DOCUMENT),
}
const png = makePlanPng()
let failures = 0

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport })
    await context.addInitScript(() => {
      sessionStorage.setItem('accessToken', 'dialog-layout-token')
      sessionStorage.setItem(
        'currentUser',
        JSON.stringify({ id: '44444444-4444-4444-8444-444444444444', username: 'test', nickname: 'test' }),
      )
    })
    await context.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const data = path.endsWith(`/plans/${id}`) ? plan : []
      await route.fulfill({ json: { data } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(`${webBase}/plans/${id}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '识别户型图' }).click()
      await page.locator('.plan-import-dialog').waitFor()
      await page.locator('.plan-import-dialog input[type=file]').setInputFiles({
        name: 'plan.png',
        mimeType: 'image/png',
        buffer: png,
      })
      // 等识别完成：主按钮从 disabled 变为可用。
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent?.includes('替换墙体并导入'),
        )
        return button instanceof HTMLButtonElement && !button.disabled
      })
      // 展开「高级选项」把弹窗撑到最高，再量按钮位置。
      await page.locator('.import-advanced > summary').click()
      await page.waitForTimeout(300)

      const primary = page.getByRole('button', { name: '替换墙体并导入' })
      const box = await primary.boundingBox()
      const dialogBox = await page.locator('.plan-import-dialog').boundingBox()
      assert.ok(box, '主按钮必须存在')
      const inViewport =
        box.y >= 0 &&
        box.y + box.height <= viewport.height + 0.5 &&
        box.x >= 0 &&
        box.x + box.width <= viewport.width
      assert.ok(
        inViewport,
        `主按钮超出视口：viewport=${viewport.width}x${viewport.height} button=${JSON.stringify(box)}`,
      )
      assert.ok(dialogBox, '弹窗必须存在')
      assert.ok(
        dialogBox.y + dialogBox.height <= viewport.height + 0.5,
        `弹窗超出视口：viewport=${viewport.width}x${viewport.height} dialog=${JSON.stringify(dialogBox)}`,
      )
      // 真正点下去，确认没有被遮罩或 overflow 裁掉。
      await primary.click({ timeout: 3000 })
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${viewport.width}x${viewport.height} ` +
          `button=${Math.round(box.x)},${Math.round(box.y)} ` +
          `dialog=${Math.round(dialogBox.y)}..${Math.round(dialogBox.y + dialogBox.height)}`,
      )
    } catch (error) {
      failures += 1
      console.log(`FAIL ${viewport.width}x${viewport.height} ${error.message}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

console.log(`\n${VIEWPORTS.length - failures}/${VIEWPORTS.length} 视口通过`)
process.exit(failures === 0 ? 0 : 1)
