import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { config } from 'dotenv'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright-core'

config({ path: resolve(process.cwd(), '.env'), quiet: true })

const apiBase = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000/api/v1'
const webBase = process.env.SMOKE_WEB_URL ?? 'http://localhost:5173'
const runId = Date.now()
const password = 'Passw0rd123'
const users = [
  { username: `smoke_a_${runId}`, email: `smoke_a_${runId}@example.com`, password },
  { username: `smoke_b_${runId}`, email: `smoke_b_${runId}@example.com`, password },
  { username: `smoke_ui_${runId}`, email: `smoke_ui_${runId}@example.com`, password },
]
const steps = []
let browser
let page

async function captureDesign(name) {
  if (process.env.SMOKE_SCREENSHOTS !== '1') return
  const directory = resolve(process.cwd(), '.smoke-artifacts')
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: resolve(directory, `design-${name}.png`), fullPage: true })
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

function expectStatus(result, status, label) {
  assert.equal(
    result.status,
    status,
    `${label}: expected ${status}, received ${result.status} ${JSON.stringify(result.payload)}`,
  )
  return result.payload
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function fullDocument(assetId) {
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID())
  return {
    schemaVersion: 1,
    unit: 'cm',
    settings: {
      gridSize: 10,
      snapEnabled: true,
      defaultWallHeight: 280,
      defaultWallThickness: 20,
      defaultWallMaterialId: 'wall-white',
      defaultFloorMaterialId: 'floor-light',
    },
    walls: [
      { id: ids[0], start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 20, height: 280 },
      { id: ids[1], start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, thickness: 20, height: 280 },
      { id: ids[2], start: { x: 400, y: 300 }, end: { x: 0, y: 300 }, thickness: 20, height: 280 },
      { id: ids[3], start: { x: 0, y: 300 }, end: { x: 0, y: 0 }, thickness: 20, height: 280 },
    ],
    rooms: [
      {
        id: ids[4],
        name: '客厅',
        polygon: [
          { x: 10, y: 10 },
          { x: 390, y: 10 },
          { x: 390, y: 290 },
          { x: 10, y: 290 },
        ],
        floorMaterialId: 'floor-light',
      },
    ],
    openings: [
      { id: ids[5], wallId: ids[0], type: 'door', offset: 50, width: 90, height: 210, sillHeight: 0 },
      { id: ids[6], wallId: ids[2], type: 'window', offset: 100, width: 120, height: 120, sillHeight: 90 },
    ],
    furniture: [
      {
        id: ids[7],
        assetId,
        position: { x: 200, y: 150 },
        rotation: 30,
        width: 200,
        depth: 90,
        height: 85,
        locked: false,
        zIndex: 1,
      },
    ],
  }
}

async function cleanup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.DB_USERNAME ?? 'home_design',
    password: process.env.DB_PASSWORD ?? 'home_design_password',
    database: process.env.DB_DATABASE ?? 'home_design',
  })
  try {
    const placeholders = users.map(() => '?').join(', ')
    await connection.execute(
      `DELETE FROM users WHERE username IN (${placeholders})`,
      users.map((user) => user.username),
    )
  } finally {
    await connection.end()
  }
}

async function saveFailureScreenshot() {
  if (!page || page.isClosed()) return
  const directory = resolve(process.cwd(), '.smoke-artifacts')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `failure-${runId}.png`)
  await page.screenshot({ path, fullPage: true })
  console.error(`Browser failure screenshot: ${path}`)
}

async function run() {
  expectStatus(await request('/health'), 200, 'API health')
  const webResponse = await fetch(webBase)
  assert.equal(webResponse.status, 200, `Web health: expected 200, received ${webResponse.status}`)
  steps.push('API and web health')

  const registerA = expectStatus(
    await request('/auth/register', { method: 'POST', body: users[0] }),
    201,
    'register user A',
  ).data
  const tokenA = registerA.accessToken
  expectStatus(
    await request('/auth/login', { method: 'POST', body: { identity: users[0].username, password } }),
    200,
    'login user A',
  )
  const me = expectStatus(await request('/users/me', { token: tokenA }), 200, 'current user').data
  assert.equal(me.username, users[0].username)
  steps.push('register, login, current user')

  const categories = expectStatus(
    await request('/furniture-categories', { token: tokenA }),
    200,
    'furniture categories',
  ).data
  const assets = expectStatus(await request('/furniture-assets', { token: tokenA }), 200, 'furniture assets').data
  assert.ok(categories.length >= 4, 'expected seeded furniture categories')
  const sofa = assets.find((asset) => asset.name === '沙发')
  assert.ok(sofa, 'expected seeded sofa asset')
  steps.push('furniture catalog')

  const plan = expectStatus(
    await request('/plans', { method: 'POST', token: tokenA, body: { name: `Smoke Plan ${runId}` } }),
    201,
    'create plan',
  ).data
  assert.equal(plan.revision, 1)
  const documentJson = fullDocument(sofa.id)
  const saved = expectStatus(
    await request(`/plans/${plan.id}`, {
      method: 'PUT',
      token: tokenA,
      body: { expectedRevision: 1, documentJson },
    }),
    200,
    'save complete plan',
  ).data
  assert.equal(saved.revision, 2)
  const restored = expectStatus(await request(`/plans/${plan.id}`, { token: tokenA }), 200, 'restore plan').data
  assert.deepEqual(canonical(restored.documentJson), canonical(documentJson))
  steps.push('create, save, and restore complete plan')

  const stale = await request(`/plans/${plan.id}`, {
    method: 'PUT',
    token: tokenA,
    body: { expectedRevision: 1, documentJson },
  })
  expectStatus(stale, 409, 'stale revision')
  assert.equal(stale.payload.code, 'PLAN_VERSION_CONFLICT')
  steps.push('stale revision rejected')

  const registerB = expectStatus(
    await request('/auth/register', { method: 'POST', body: users[1] }),
    201,
    'register user B',
  ).data
  const crossUser = await request(`/plans/${plan.id}`, { token: registerB.accessToken })
  expectStatus(crossUser, 404, 'cross-user plan read')
  assert.equal(crossUser.payload.code, 'PLAN_NOT_FOUND')
  steps.push('plan ownership isolation')

  const executablePath = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate))
  assert.ok(executablePath, 'Chrome or Edge executable was not found')

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto(`${webBase}/register`, { waitUntil: 'networkidle' })
  await captureDesign('register-desktop')
  const registerButton = page.getByRole('button', { name: '注册', exact: true })
  assert.equal(await registerButton.isEnabled(), true, 'register button must remain enabled for validation')
  await registerButton.click()
  await page.getByText('请输入用户名', { exact: true }).waitFor()
  await page.getByLabel('用户名', { exact: true }).fill(users[2].username)
  await page.getByLabel('邮箱', { exact: true }).fill(users[2].email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
  await Promise.all([page.waitForURL('**/plans'), registerButton.click()])
  await page.locator('.account-button').click()
  await page.waitForURL('**/profile')
  assert.equal(await page.getByLabel('邮箱', { exact: true }).inputValue(), users[2].email)
  await Promise.all([page.waitForURL('**/plans'), page.locator('.brand-button').click()])
  await Promise.all([page.waitForURL('**/login'), page.getByRole('button', { name: '退出', exact: true }).click()])
  steps.push('browser registration form')

  await page.goto(`${webBase}/login`, { waitUntil: 'networkidle' })
  await captureDesign('login-desktop')
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(users[0].username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await Promise.all([page.waitForURL('**/plans'), page.getByRole('button', { name: '登录', exact: true }).click()])
  const drawingPlan = expectStatus(
    await request('/plans', { method: 'POST', token: tokenA, body: { name: `Drawing regression ${runId}` } }),
    201,
    'create drawing regression plan',
  ).data
  await page.goto(`${webBase}/plans/${drawingPlan.id}`, { waitUntil: 'networkidle' })
  const drawingBounds = await page.locator('.floorplan-canvas').boundingBox()
  assert.ok(drawingBounds)
  const corners = [
    [180, 180],
    [480, 180],
    [480, 380],
    [180, 380],
  ]
  await page.getByRole('button', { name: '墙体', exact: true }).click()
  async function drawingPreview() {
    return page
      .locator('.floorplan-canvas canvas')
      .first()
      .evaluate(async (canvas) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return canvas.toDataURL()
      })
  }
  for (let index = 0; index < corners.length; index++) {
    const start = corners[index]
    const end = corners[(index + 1) % corners.length]
    await page.mouse.move(drawingBounds.x + start[0], drawingBounds.y + start[1])
    await page.mouse.down()
    // Deliberately drag off axis, then lock it without moving the mouse again.
    await page.mouse.move(
      drawingBounds.x + end[0] + (index % 2 ? 25 : 0),
      drawingBounds.y + end[1] + (index % 2 ? 0 : 25),
      { steps: 8 },
    )
    const freePreview = index === 0 ? await drawingPreview() : null
    await page.keyboard.down('Shift')
    if (index === 0) {
      assert.notEqual(await drawingPreview(), freePreview, 'Shift must immediately constrain the preview')
      await page.keyboard.up('Shift')
      assert.equal(await drawingPreview(), freePreview, 'releasing Shift must restore the free angle')
      await page.keyboard.down('Shift')
    }
    await page.mouse.up()
    await page.keyboard.up('Shift')
    assert.deepEqual(browserErrors, [], `drawing wall ${index + 1}: ${browserErrors.join('; ')}`)
    await page.getByText(`${index + 1} 面墙 · 0 个门窗 · 0 个房间 · 0 件家具`, { exact: true }).waitFor()
  }
  await page.getByText('墙体已闭合', { exact: true }).waitFor()
  await page.getByRole('button', { name: '房间', exact: true }).click()
  for (const corner of [...corners, corners[0]]) {
    await page.mouse.click(drawingBounds.x + corner[0], drawingBounds.y + corner[1])
  }
  await page.getByText('4 面墙 · 0 个门窗 · 1 个房间 · 0 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('4 面墙 · 0 个门窗 · 0 个房间 · 0 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByText('4 面墙 · 0 个门窗 · 1 个房间 · 0 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('已保存，版本 2', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('4 面墙 · 0 个门窗 · 1 个房间 · 0 件家具', { exact: true }).waitFor()
  const drawnDocument = expectStatus(
    await request(`/plans/${drawingPlan.id}`, { token: tokenA }),
    200,
    'read drawn plan',
  ).data.documentJson
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(drawnDocument.walls[index].end, drawnDocument.walls[(index + 1) % 4].start)
    assert.deepEqual(drawnDocument.walls[index].start, { x: corners[index][0] - 80, y: corners[index][1] - 80 })
  }
  assert.equal(drawnDocument.rooms[0].polygon.length, 4)
  const concurrentDocument = structuredClone(drawnDocument)
  concurrentDocument.rooms[0].name = '并发保存后的房间'
  const [renameResult, saveResult] = await Promise.all([
    request(`/plans/${drawingPlan.id}/name`, { method: 'PATCH', token: tokenA, body: { name: '并发重命名' } }),
    request(`/plans/${drawingPlan.id}`, {
      method: 'PUT',
      token: tokenA,
      body: { expectedRevision: 2, documentJson: concurrentDocument },
    }),
  ])
  expectStatus(renameResult, 200, 'concurrent rename')
  expectStatus(saveResult, 200, 'concurrent document save')
  const afterConcurrent = expectStatus(
    await request(`/plans/${drawingPlan.id}`, { token: tokenA }),
    200,
    'read concurrent result',
  ).data
  assert.equal(afterConcurrent.name, '并发重命名')
  assert.equal(afterConcurrent.revision, 3)
  assert.deepEqual(canonical(afterConcurrent.documentJson), canonical(concurrentDocument))
  expectStatus(
    await request(`/plans/${drawingPlan.id}/name`, {
      method: 'PATCH',
      token: registerB.accessToken,
      body: { name: '不能修改' },
    }),
    404,
    'cross-user rename',
  )
  expectStatus(await request(`/plans/${drawingPlan.id}`, { method: 'DELETE', token: tokenA }), 200, 'delete drawn plan')
  expectStatus(
    await request(`/plans/${drawingPlan.id}/name`, {
      method: 'PATCH',
      token: tokenA,
      body: { name: '不能恢复已删除方案' },
    }),
    404,
    'rename deleted plan',
  )
  steps.push('concurrent rename preserves saved document and revision; owner and deletion checks')
  steps.push('Shift locks walls in four directions and releases live; snapped room, undo, redo, save and reload')
  await page.goto(`${webBase}/plans/${plan.id}`, { waitUntil: 'networkidle' })
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 1 件家具', { exact: true }).waitFor()
  await page.getByText('墙体已闭合', { exact: true }).waitFor()
  await captureDesign('editor-desktop')
  const floorplan = page.locator('.floorplan-canvas')
  const floorplanBounds = await floorplan.boundingBox()
  assert.ok(floorplanBounds, '2D floorplan must have visible bounds')
  await page.mouse.move(floorplanBounds.x + 100, floorplanBounds.y + 100)
  await page.keyboard.down('Space')
  assert.equal(await floorplan.evaluate((element) => getComputedStyle(element).cursor), 'grab')
  await page.mouse.down()
  assert.equal(await floorplan.evaluate((element) => getComputedStyle(element).cursor), 'grabbing')
  await page.mouse.move(floorplanBounds.x + 140, floorplanBounds.y + 130)
  await page.mouse.up()
  assert.equal(await floorplan.evaluate((element) => getComputedStyle(element).cursor), 'grab')
  await page.keyboard.up('Space')
  assert.equal(await floorplan.evaluate((element) => getComputedStyle(element).cursor), 'default')
  async function canvasImage() {
    return floorplan
      .locator('canvas')
      .first()
      .evaluate(async (canvas) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return canvas.toDataURL()
      })
  }
  await page.getByRole('button', { name: '回到原点', exact: true }).click()
  const originImage = await canvasImage()
  await page.getByRole('button', { name: '定位设计', exact: true }).click()
  const fittedImage = await canvasImage()
  assert.notEqual(fittedImage, originImage, 'locating must adjust the viewport')
  await page.mouse.move(floorplanBounds.x + 65, floorplanBounds.y + floorplanBounds.height - 20)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(floorplanBounds.x + 350, floorplanBounds.y + floorplanBounds.height - 200, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  assert.notEqual(await canvasImage(), fittedImage, 'panning must visibly move the canvas')
  await page.getByRole('button', { name: '定位设计', exact: true }).click()
  assert.equal(await canvasImage(), fittedImage, 'locating after panning must return to the same design view')
  await page.getByRole('button', { name: '回到原点', exact: true }).click()
  assert.equal(await canvasImage(), originImage, 'origin reset must restore the initial 100 percent viewport')
  assert.equal(
    await page.getByRole('button', { name: '保存', exact: true }).isEnabled(),
    false,
    'view changes must not mark the design dirty',
  )
  assert.equal(
    await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(),
    false,
    'view changes must not enter edit history',
  )
  steps.push('locate design after panning and reset origin without changing design data')
  // A right press must cancel drafts before it can place or finish anything.
  const draftStart = { x: floorplanBounds.x + 550, y: floorplanBounds.y + 200 }
  await page.getByRole('button', { name: '墙体', exact: true }).click()
  await page.mouse.move(draftStart.x, draftStart.y)
  await page.mouse.down()
  await page.mouse.move(draftStart.x + 150, draftStart.y + 100, { steps: 5 })
  assert.notEqual(await canvasImage(), originImage, 'unfinished wall preview must be visible')
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await page.mouse.up()
  assert.equal(await canvasImage(), originImage, 'right click must cancel the wall before left release')
  await page.getByRole('button', { name: '房间', exact: true }).click()
  await page.mouse.click(draftStart.x, draftStart.y)
  await page.mouse.click(draftStart.x + 150, draftStart.y)
  await page.mouse.click(draftStart.x + 150, draftStart.y + 100)
  assert.notEqual(await canvasImage(), originImage, 'unfinished room preview must be visible')
  await page.mouse.click(draftStart.x, draftStart.y, { button: 'right' })
  assert.equal(await canvasImage(), originImage, 'right click on the first vertex must cancel, not close the room')
  await page.mouse.click(draftStart.x, draftStart.y)
  await page.mouse.click(draftStart.x + 100, draftStart.y)
  assert.notEqual(await canvasImage(), originImage, 'drawing must work again after cancelling')
  await page.keyboard.press('Escape')
  assert.equal(await canvasImage(), originImage, 'Escape must still cancel a new room draft')
  for (const toolName of ['门', '窗']) {
    await page.getByRole('button', { name: toolName, exact: true }).click()
    await page.mouse.click(floorplanBounds.x + 480, floorplanBounds.y + 230, { button: 'right' })
    assert.equal(await canvasImage(), originImage, 'right click on a wall must not place an opening')
  }
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 1 件家具', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false)
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), false)
  steps.push('right-click cancels wall and room drafts without changing completed objects or history')
  await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 1 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.ok(page.url().endsWith(`/plans/${plan.id}`), 'cancel leave must keep the editor open')
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await page.waitForURL('**/plans')
  await page.getByRole('img', { name: `${plan.name}的户型缩略图`, exact: true }).waitFor()
  assert.equal(await page.locator('.plan-thumbnail polygon').count(), 1)
  await captureDesign('plans-desktop')
  await page.getByRole('heading', { name: plan.name, exact: true }).click()
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  const draftStorageKey = `zhujing:draft:v1:${registerA.user.id}:${plan.id}`
  assert.ok(await page.evaluate((key) => localStorage.getItem(key), draftStorageKey), 'draft must persist locally')
  const draftValidation = await page.evaluate(async (key) => {
    const { draftKey, readDraft } = await import('/src/editor/drafts.ts')
    const raw = localStorage.getItem(key)
    const draft = JSON.parse(raw)
    const storage = { getItem: (candidate) => (candidate === key ? raw : null) }
    const isolated =
      readDraft(storage, 'another-user', draft.planId) === null &&
      readDraft(storage, draft.ownerId, 'another-plan') === null
    const invalidDrafts = [
      '{broken json',
      JSON.stringify({ ...draft, version: 2 }),
      JSON.stringify({ ...draft, ownerId: 'another-user' }),
      JSON.stringify({ ...draft, baseRevision: 0 }),
      JSON.stringify({ ...draft, documentJson: { ...draft.documentJson, furniture: [{}] } }),
    ]
    const rejected = invalidDrafts.every((value) => {
      try {
        readDraft({ getItem: () => value }, draft.ownerId, draft.planId)
        return false
      } catch {
        return true
      }
    })
    return {
      isolated,
      rejected,
      revision: readDraft(storage, draft.ownerId, draft.planId).baseRevision,
      preserved: localStorage.getItem(draftKey(draft.ownerId, draft.planId)) === raw,
    }
  }, draftStorageKey)
  assert.deepEqual(draftValidation, { isolated: true, rejected: true, revision: 2, preserved: true })
  const reloadDialog = page.waitForEvent('dialog').then(async (dialog) => {
    assert.equal(dialog.type(), 'beforeunload')
    await dialog.accept()
  })
  await Promise.all([page.reload({ waitUntil: 'networkidle' }), reloadDialog])
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('版本 3 · 已同步', { exact: true }).waitFor()
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), draftStorageKey), null)
  steps.push('unsaved leave protection, reload recovery, and draft cleanup after save')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  await page.getByRole('button', { name: '3D 预览', exact: true }).click()
  await page.getByText('3D 只读预览 · 4 面墙 · 2 件家具', { exact: true }).waitFor()
  const canvas = page.locator('.three-preview canvas')
  await canvas.waitFor({ state: 'visible' })
  const dimensions = await canvas.evaluate((element) => ({ width: element.width, height: element.height }))
  assert.ok(dimensions.width > 0 && dimensions.height > 0, '3D canvas must have non-zero dimensions')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
  }))
  assert.ok(
    mobileLayout.pageWidth <= mobileLayout.viewportWidth,
    `mobile editor must not overflow horizontally: ${JSON.stringify(mobileLayout)}`,
  )
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  await captureDesign('editor-mobile')
  assert.deepEqual(browserErrors, [], `browser page errors: ${browserErrors.join('; ')}`)
  steps.push('browser login, editor restore, and 3D preview')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 3 件家具', { exact: true }).waitFor()
  await page.route('**/api/v1/plans/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '测试保存失败' }),
      })
    } else await route.continue()
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('测试保存失败', { exact: true }).waitFor()
  assert.ok(await page.evaluate((key) => localStorage.getItem(key), draftStorageKey), 'failed save must retain draft')
  await page.unroute('**/api/v1/plans/*')

  // A newer server version must not be silently overwritten by a recovered draft.
  const serverPlan = expectStatus(await request(`/plans/${plan.id}`, { token: tokenA }), 200, 'read latest plan').data
  expectStatus(
    await request(`/plans/${plan.id}`, {
      method: 'PUT',
      token: tokenA,
      body: { expectedRevision: serverPlan.revision, documentJson: serverPlan.documentJson },
    }),
    200,
    'advance server revision',
  )
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await page.waitForURL('**/plans')
  await page.getByRole('heading', { name: plan.name, exact: true }).click()
  await page.getByText(/服务器版本已变化/).waitFor()
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  const conflictResponse = page.waitForResponse((response) => response.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  assert.equal((await conflictResponse).status(), 409)
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await page.waitForURL('**/plans')
  await page.getByRole('heading', { name: plan.name, exact: true }).click()
  await page.getByRole('button', { name: '丢弃草稿', exact: true }).click()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 2 件家具', { exact: true }).waitFor()
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), draftStorageKey), null)
  steps.push('failed saves retain drafts; stale drafts cannot overwrite newer plans; explicit discard')

  // Hold a successful save response while the user makes another edit.
  let releaseSave
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve
  })
  let notifySaveStarted
  const saveStarted = new Promise((resolve) => {
    notifySaveStarted = resolve
  })
  await page.route('**/api/v1/plans/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    notifySaveStarted()
    await saveGate
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await saveStarted
  await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
  releaseSave()
  await page.getByText('已保存提交的版本，后续修改已保留为草稿', { exact: true }).waitFor()
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 4 件家具', { exact: true }).waitFor()
  const concurrentDraft = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), draftStorageKey))
  assert.equal(concurrentDraft.documentJson.furniture.length, 4)
  assert.equal(concurrentDraft.baseRevision, 5)
  await page.unroute('**/api/v1/plans/*')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('版本 6 · 已同步', { exact: true }).waitFor()
  assert.deepEqual(browserErrors, [], `browser page errors: ${browserErrors.join('; ')}`)
  steps.push('edits made during save are preserved as a new draft')

  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('Storage full', 'QuotaExceededError')
    }
  })
  await page.getByRole('button', { name: '沙发', exact: true }).dblclick()
  await page.getByText('本地草稿保存失败，请及时点击保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.getByText(/本地草稿保存失败，离开将丢失/).waitFor()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('版本 7 · 已同步', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('4 面墙 · 2 个门窗 · 1 个房间 · 5 件家具', { exact: true }).waitFor()
  assert.deepEqual(browserErrors, [], `browser page errors: ${browserErrors.join('; ')}`)
  steps.push('storage failure is visible and manual server save still works')

  async function assertNoHorizontalOverflow(label) {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    assert.ok(dimensions.content <= dimensions.width, `${label}: ${JSON.stringify(dimensions)}`)
  }
  for (const width of [319, 820, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    await assertNoHorizontalOverflow(`editor at ${width}px`)
  }
  await page.getByRole('button', { name: '我的设计', exact: true }).click()
  await page.waitForURL('**/plans')
  await page.getByRole('img', { name: `${plan.name}的户型缩略图`, exact: true }).waitFor()
  for (const width of [319, 390, 820]) {
    await page.setViewportSize({ width, height: 844 })
    await assertNoHorizontalOverflow(`project list at ${width}px`)
    if (width === 390) await captureDesign('plans-mobile')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.account-button').click()
  await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor()
  await assertNoHorizontalOverflow('profile mobile')
  await captureDesign('profile-mobile')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.waitForURL('**/login')
  await assertNoHorizontalOverflow('login mobile')
  await captureDesign('login-mobile')
  await page.getByRole('link', { name: '创建账户', exact: true }).click()
  await page.waitForURL('**/register')
  await assertNoHorizontalOverflow('register mobile')
  await captureDesign('register-mobile')
  assert.deepEqual(browserErrors, [], `browser page errors: ${browserErrors.join('; ')}`)
  steps.push('real project thumbnails and responsive editor, project, account, and auth pages')

  expectStatus(await request(`/plans/${plan.id}`, { method: 'DELETE', token: tokenA }), 200, 'delete plan')
  const listed = expectStatus(await request('/plans?page=1&pageSize=50', { token: tokenA }), 200, 'list plans').data
  assert.ok(!listed.items.some((item) => item.id === plan.id), 'soft-deleted plan must not be listed')
  steps.push('soft delete and list exclusion')
}

try {
  await run()
  console.log(`Smoke test passed (${steps.length} steps)`)
  for (const step of steps) console.log(`- ${step}`)
} catch (error) {
  await saveFailureScreenshot().catch(() => undefined)
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  await cleanup().catch((error) => {
    console.error('Smoke cleanup failed:', error)
    process.exitCode = 1
  })
}
