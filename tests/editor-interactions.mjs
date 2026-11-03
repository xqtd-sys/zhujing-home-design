import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const { EMPTY_PLAN_DOCUMENT, PlanDocumentSchema } = createRequire(import.meta.url)('@home-design/plan-schema')
const webBase = process.env.SMOKE_WEB_URL ?? 'http://localhost:5173'
const id = '11111111-1111-4111-8111-111111111111'
const wallId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const ownerId = '44444444-4444-4444-8444-444444444444'
const assetId = 'a1111111-1111-4111-8111-111111111111'
const asset = {
  id: assetId,
  categoryId: 'b1111111-1111-4111-8111-111111111111',
  name: '沙发',
  baseWidth: 100,
  baseDepth: 60,
  baseHeight: 85,
  defaultColor: '#94b5a5',
}
const executablePath = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path && existsSync(path))
assert.ok(executablePath, 'Chrome or Edge is required')
const browser = await chromium.launch({ executablePath, headless: true })
let passed = 0

// Only API fixtures are used here. These browser tests never write real users or designs.
async function scenario(name, action, configure = () => {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const doc = structuredClone(EMPTY_PLAN_DOCUMENT)
  doc.walls = [
    { id: wallId, start: { x: 100, y: 100 }, end: { x: 500, y: 100 }, thickness: 20, height: 200 },
    { id: otherId, start: { x: 100, y: 400 }, end: { x: 500, y: 400 }, thickness: 20, height: 280 },
  ]
  configure(doc)
  let plan = { id, ownerId, name: 'Isolated editor fixture', revision: 1, schemaVersion: 1, documentJson: doc }
  await context.addInitScript(() => {
    sessionStorage.setItem('accessToken', 'isolated-test-token')
    sessionStorage.setItem(
      'currentUser',
      JSON.stringify({ id: '44444444-4444-4444-8444-444444444444', username: 'test', nickname: 'test' }),
    )
  })
  let submitted
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'PUT') {
      submitted = route.request().postDataJSON().documentJson
      const parsed = PlanDocumentSchema.safeParse(submitted)
      if (!parsed.success)
        return route.fulfill({ status: 400, json: { message: parsed.error.issues.map((i) => i.message).join('; ') } })
      plan = { ...plan, revision: plan.revision + 1, documentJson: submitted }
      return route.fulfill({ json: { data: plan } })
    }
    await route.fulfill({
      json: { data: path.endsWith(`/plans/${id}`) ? plan : path.endsWith('/furniture-assets') ? [asset] : [] },
    })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${webBase}/plans/${id}`, { waitUntil: 'networkidle' })
    const count = (walls, openings = 0, rooms = 0, furniture = 0) =>
      page
        .getByText(`${walls} 面墙 · ${openings} 个门窗 · ${rooms} 个房间 · ${furniture} 件家具`, { exact: true })
        .waitFor()
    await count(2)
    const bounds = await page.locator('.floorplan-canvas').boundingBox()
    const click = (x, y) => page.mouse.click(bounds.x + 80 + x, bounds.y + 80 + y)
    const drag = async (x1, y1, x2, y2, button = 'left', releaseSpaceEarly = false) => {
      await page.mouse.move(bounds.x + 80 + x1, bounds.y + 80 + y1)
      await page.mouse.down({ button })
      await page.mouse.move(bounds.x + 80 + x2, bounds.y + 80 + y2, { steps: 8 })
      if (releaseSpaceEarly) await page.keyboard.up('Space')
      await page.mouse.up({ button })
    }
    const save = async () => {
      const revision = plan.revision + 1
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.getByText(`已保存，版本 ${revision}`, { exact: true }).waitFor()
      return submitted
    }
    await action({ page, click, drag, count, save, doc })
    assert.deepEqual(errors, [], name)
    passed++
    console.log(`PASS ${name}`)
  } finally {
    await context.close()
  }
}

try {
  await scenario('text inputs keep Backspace, Delete and Ctrl+Z local', async ({ page, click, count, save }) => {
    await click(300, 100)
    const input = page.getByRole('spinbutton').first()
    await input.focus()
    await input.press('End')
    await input.press('Backspace')
    await count(2)
    await input.press('Home')
    await input.press('Delete')
    await count(2)
    await input.fill('25')
    await input.press('Tab')
    await input.focus()
    await input.press('Control+z')
    await count(2)
    // Native undo may alter the text, but must not consume canvas history.
    assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isEnabled(), false)
    await input.fill('25')
    await input.press('Tab')
    const current = await save()
    assert.equal(current.walls.length, 2)
    assert.equal(current.walls[0].thickness, 25)
    await click(300, 100)
    await page.keyboard.press('Delete')
    await count(1)
    await page.keyboard.press('Control+z')
    await count(2)
  })

  await scenario('2D/3D round trip preserves the chosen drawing tool', async ({ page, drag, count, save }) => {
    await page.getByRole('button', { name: '墙体', exact: true }).click()
    await page.getByRole('button', { name: '3D 预览', exact: true }).click()
    await page.locator('.three-preview canvas').waitFor()
    await page.getByRole('button', { name: '2D 编辑', exact: true }).click()
    await page.locator('.floorplan-canvas').waitFor()
    assert.equal(await page.locator('.tool.active').innerText(), '墙体')
    assert.match(await page.locator('.canvas-overlay').innerText(), /拖动绘制墙体/)
    await drag(150, 200, 450, 200)
    await count(3)
    assert.equal((await save()).walls.length, 3)
  })

  await scenario(
    'space and middle-button pan never move walls or endpoint handles',
    async ({ page, click, drag, count, doc }) => {
      await click(300, 100)
      for (const [x, y, button, early] of [
        [300, 100, 'left', false],
        [100, 100, 'left', true],
        [300, 100, 'middle', false],
      ]) {
        if (button === 'left') await page.keyboard.down('Space')
        await drag(x, y, x + 50, y + 60, button, early)
        await page.keyboard.up('Space')
        await page.getByRole('button', { name: '回到原点', exact: true }).click()
        await count(2)
        assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
        assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), false)
      }
      assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0)
      assert.equal(doc.walls[0].start.x, 100)
    },
  )

  await scenario('panning over furniture and windows preserves saved geometry', async ({ page, click, drag, save }) => {
    await page.getByRole('button', { name: '窗', exact: true }).click()
    await click(300, 400)
    await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
    const before = structuredClone(await save())
    const furniture = before.furniture[0]
    for (const [x, y] of [
      [300, 400],
      [furniture.position.x, furniture.position.y],
    ]) {
      await page.keyboard.down('Space')
      await drag(x, y, x + 50, y + 40)
      await page.keyboard.up('Space')
      await page.getByRole('button', { name: '回到原点', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
    }
    await page.getByRole('button', { name: '墙体', exact: true }).click()
    await drag(600, 150, 700, 150)
    const after = await save()
    assert.deepEqual(after.furniture, before.furniture)
    assert.deepEqual(after.openings, before.openings)
    assert.deepEqual(after.walls.slice(0, 2), before.walls)
  })

  await scenario(
    'low walls reject invalid doors/windows and valid window drafts recover',
    async ({ page, click, count, save }) => {
      for (const tool of ['窗', '门']) {
        await page.getByRole('button', { name: tool, exact: true }).click()
        await click(300, 100)
        await page.getByText('墙高不足，默认门窗需要至少 210 cm，请先调整墙高', { exact: true }).first().waitFor()
        await count(2)
        assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
      }
      await page.getByRole('button', { name: '窗', exact: true }).click()
      await click(300, 400)
      await count(2, 1)
      await page.getByText('草稿已保存在此浏览器，尚未保存到服务器', { exact: true }).waitFor()
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
      await count(2, 1)
      const current = await save()
      assert.equal(PlanDocumentSchema.safeParse(current).success, true)
      assert.equal(current.openings.length, 1)
    },
  )

  await scenario('deleting a new window keeps previously selected walls', async ({ page, click, count, save }) => {
    await click(300, 100)
    await page.getByRole('button', { name: '窗', exact: true }).click()
    await click(300, 400)
    await count(2, 1)
    await page.getByRole('button', { name: '删除选中对象', exact: true }).click()
    await count(2)
    const current = await save()
    assert.deepEqual(
      current.walls.map((w) => w.id),
      [wallId, otherId],
    )
    assert.equal(current.openings.length, 0)
  })

  await scenario('deleting a new room keeps the previously selected window', async ({ page, click, count, save }) => {
    await page.getByRole('button', { name: '窗', exact: true }).click()
    await click(300, 400)
    await page.getByRole('button', { name: '房间', exact: true }).click()
    for (const [x, y] of [
      [150, 200],
      [350, 200],
      [350, 300],
      [150, 200],
    ])
      await click(x, y)
    await count(2, 1, 1)
    await page.getByRole('button', { name: '删除选中对象', exact: true }).click()
    await count(2, 1)
    const current = await save()
    assert.equal(current.openings.length, 1)
    assert.equal(current.walls.length, 2)
    assert.equal(current.rooms.length, 0)
  })
  await scenario(
    'shortening a wall preserves every opening and undo clears selection',
    async ({ page, click, drag, count, save }) => {
      await page.getByRole('button', { name: '窗', exact: true }).click()
      await click(180, 400)
      await click(400, 400)
      await count(2, 2)
      const before = structuredClone(await save())
      await page.getByRole('button', { name: '选择', exact: true }).click()
      await click(285, 400)
      await drag(500, 400, 300, 400)
      await page.getByText('缩短后会超出现有门窗范围，请先移动或删除门窗', { exact: true }).waitFor()
      await count(2, 2)
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
      await drag(500, 400, 550, 400)
      const after = await save()
      assert.deepEqual(after.openings, before.openings)
      assert.equal(after.walls[1].end.x, 550)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: '删除选中对象', exact: true }).isEnabled(), false)
      await page.keyboard.press('Delete')
      await count(2, 2)
      await page.getByRole('button', { name: '重做', exact: true }).click()
      await page.keyboard.press('Delete')
      await count(2, 2)
      assert.deepEqual((await save()).openings, before.openings)
    },
  )

  await scenario(
    'room name validation, canvas visuals and compact mobile panels',
    async ({ page, click, count, save }) => {
      await page.getByRole('button', { name: '房间', exact: true }).click()
      for (const [x, y] of [
        [150, 200],
        [350, 200],
        [350, 300],
        [150, 300],
        [150, 200],
      ])
        await click(x, y)
      await count(2, 0, 1)
      await page.getByRole('button', { name: '重命名房间', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').fill('房'.repeat(65))
      await dialog.getByRole('button', { name: '确定', exact: true }).click()
      await page.getByText('房间名称需为 1–64 个字符', { exact: true }).waitFor()
      await dialog.getByRole('textbox').fill('客厅')
      await dialog.getByRole('button', { name: '确定', exact: true }).click()
      assert.equal((await save()).rooms[0].name, '客厅')
      await page.getByRole('button', { name: '门', exact: true }).click()
      await click(180, 400)
      await page.getByRole('button', { name: '窗', exact: true }).click()
      await click(400, 400)
      await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
      await page.getByRole('button', { name: '墙体', exact: true }).click()
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      await page.getByRole('button', { name: '重做', exact: true }).click()
      await page.getByRole('button', { name: '定位设计', exact: true }).click()
      await save()
      await page.waitForFunction(() => document.querySelectorAll('.el-message').length === 0)
      await mkdir('.smoke-artifacts', { recursive: true })
      await page.screenshot({ path: '.smoke-artifacts/refined-editor-desktop.png', fullPage: true })
      for (const width of [319, 390, 820, 1024]) {
        await page.setViewportSize({ width, height: 844 })
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `overflow at ${width}`,
        )
        if (width <= 760) {
          assert.equal(await page.locator('.asset-library').isVisible(), false)
          assert.equal(await page.locator('.properties-content').isVisible(), false)
          await page.getByRole('button', { name: /家具素材.*展开/ }).click()
          assert.equal(await page.locator('.asset-library').isVisible(), true)
          await page.getByRole('button', { name: /家具素材.*收起/ }).click()
          await page.getByRole('button', { name: /空间属性.*展开/ }).click()
          assert.equal(await page.locator('.properties-content').isVisible(), true)
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `expanded panels overflow at ${width}`,
          )
          await page.getByRole('button', { name: /空间属性.*收起/ }).click()
          await page.getByRole('button', { name: '定位设计', exact: true }).click()
          if (width === 390)
            await page.screenshot({ path: '.smoke-artifacts/refined-editor-mobile.png', fullPage: true })
        }
      }
    },
  )
  await scenario(
    'outside mouse release and window blur discard only unfinished walls',
    async ({ page, count, drag, save }) => {
      const bounds = await page.locator('.floorplan-canvas').boundingBox()
      await page.getByRole('button', { name: '墙体', exact: true }).click()
      for (const interrupt of ['outside', 'blur']) {
        await page.mouse.move(bounds.x + 150, bounds.y + 250)
        await page.mouse.down()
        await page.mouse.move(bounds.x + 350, bounds.y + 250)
        assert.match(await page.locator('.canvas-overlay').innerText(), /右键/)
        if (interrupt === 'outside') await page.mouse.move(bounds.x - 20, bounds.y + 250)
        else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        await page.mouse.up()
        await page.mouse.move(bounds.x + 400, bounds.y + 300)
        assert.match(await page.locator('.canvas-overlay').innerText(), /拖动绘制墙体/)
        await count(2)
        assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), false)
        assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
      }
      await drag(150, 200, 450, 200)
      await count(3)
      assert.equal((await save()).walls.length, 3)
    },
  )

  await scenario(
    'out-of-range drawing cannot poison an existing recoverable draft',
    async ({ page, drag, count, save }) => {
      await page.getByRole('button', { name: '墙体', exact: true }).click()
      await drag(150, 200, 450, 200)
      await page.getByText('草稿已保存在此浏览器，尚未保存到服务器', { exact: true }).waitFor()
      const draft = () =>
        page.evaluate(() =>
          localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('zhujing:draft:'))),
        )
      const before = await draft()
      const bounds = await page.locator('.floorplan-canvas').boundingBox()
      await page.mouse.move(bounds.x + 400, bounds.y + 300)
      for (let i = 0; i < 70; i++) await page.mouse.wheel(0, 100)
      await page.waitForFunction(
        () => Number(document.querySelector('.canvas-overlay').textContent.match(/([\d.]+)%/)[1]) < 1,
      )
      // Coordinates below zero are clamped to the origin instead of being persisted.
      for (const x of [600, 70]) {
        await page.mouse.move(bounds.x + x, bounds.y + 200)
        await page.mouse.down()
        await page.mouse.move(bounds.x + x + 100, bounds.y + 220, { steps: 5 })
        await page.mouse.up()
        const currentDraft = JSON.parse(await draft())
        assert.ok(currentDraft.documentJson.walls.every((wall) => [wall.start, wall.end].every((point) => point.x >= 0 && point.y >= 0)))
      }
      await page.getByRole('button', { name: '房间', exact: true }).click()
      for (const [x, y] of [
        [600, 200],
        [750, 200],
        [750, 280],
        [600, 200],
      ])
        await page.mouse.click(bounds.x + x, bounds.y + y)
      const roomDraft = JSON.parse(await draft())
      assert.ok(roomDraft.documentJson.rooms.every((room) => room.polygon.every((point) => point.x >= 0 && point.y >= 0)))
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
      const furnitureDraft = JSON.parse(await draft())
      assert.ok(furnitureDraft.documentJson.furniture.every((item) => item.position.x >= 0 && item.position.y >= 0))
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
      const saved = await save()
      assert.equal(PlanDocumentSchema.safeParse(saved).success, true)
      assert.ok(saved.walls.every((wall) => [wall.start, wall.end].every((point) => point.x >= 0 && point.y >= 0)))
      assert.ok(saved.rooms.every((room) => room.polygon.every((point) => point.x >= 0 && point.y >= 0)))
      assert.ok(saved.furniture.every((item) => item.position.x >= 0 && item.position.y >= 0))
    },
  )

  await scenario(
    'rejected endpoint, wall, furniture and room drags restore visual positions',
    async ({ page, count, save }) => {
      await page.getByRole('button', { name: '定位设计', exact: true }).click()
      const bounds = await page.locator('.floorplan-canvas').boundingBox()
      // The two walls are centered around (9750, 250), with the same padding as locate design.
      const center = { x: bounds.x + 64 + (bounds.width - 96) / 2, y: bounds.y + 70 + (bounds.height - 166) / 2 }
      const click = (x, y) => page.mouse.click(center.x + x - 9750, center.y + y - 250)
      const drag = async (x, y, dx, dy) => {
        await page.mouse.move(center.x + x - 9750, center.y + y - 250)
        await page.mouse.down()
        await page.mouse.move(center.x + x + dx - 9750, center.y + y + dy - 250, { steps: 8 })
        await page.mouse.up()
      }
      const canvasImage = () =>
        page
          .locator('.floorplan-canvas canvas')
          .first()
          .evaluate(async (canvas) => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            return canvas.toDataURL()
          })
      await click(9750, 100)
      const wallImage = await canvasImage()
      await drag(9900, 100, 200, 0)
      assert.equal(await canvasImage(), wallImage, 'rejected endpoint must return to its original position')
      await drag(9750, 100, 300, 0)
      assert.equal(await canvasImage(), wallImage, 'rejected wall must return to its original position')
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
      await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
      const withFurniture = structuredClone(await save())
      const pos = withFurniture.furniture[0].position
      const furnitureImage = await canvasImage()
      await drag(pos.x, pos.y, 400, 0)
      assert.equal(await canvasImage(), furnitureImage, 'rejected furniture must return to its original position')
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
      await page.getByRole('button', { name: '房间', exact: true }).click()
      for (const [x, y] of [
        [9600, 200],
        [9700, 200],
        [9700, 300],
        [9600, 300],
        [9600, 200],
      ])
        await click(x, y)
      await page.getByRole('button', { name: '选择', exact: true }).click()
      const roomImage = await canvasImage()
      await drag(9700, 200, 400, 0)
      assert.equal(await canvasImage(), roomImage, 'rejected room vertex must return to its original position')
      const current = await save()
      assert.deepEqual(current.furniture, withFurniture.furniture)
      assert.deepEqual(current.walls, withFurniture.walls)
      assert.equal(current.rooms[0].polygon[1].x, 9700)
      await count(2, 0, 1, 1)
    },
    (doc) => {
      for (const wall of doc.walls) {
        wall.start.x = 9600
        wall.end.x = 9900
      }
    },
  )
  console.log(`Editor interaction regression passed (${passed} scenarios)`)
} finally {
  await browser.close()
}
