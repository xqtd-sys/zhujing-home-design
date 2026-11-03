import assert from 'node:assert/strict'
import test from 'node:test'
import {
  axisRulerTicks,
  clampLogicalPoint,
  clampViewportToNonNegative,
  findOpenWallEndpoints,
  rulerStepForZoom,
  snapToWallEndpoints,
  fitDocumentViewport,
  logicalToScreen,
  snapOrthogonalPoint,
} from './geometry.ts'

test('wall endpoint snapping keeps an 8px visual threshold at every zoom', () => {
  const candidate = [{ x: 100, y: 100 }]
  assert.deepEqual(snapToWallEndpoints({ x: 115, y: 100 }, candidate, { x: 0, y: 0, zoom: 0.5 }, 10, false), {
    x: 100,
    y: 100,
  })
  assert.deepEqual(snapToWallEndpoints({ x: 117, y: 100 }, candidate, { x: 0, y: 0, zoom: 0.5 }, 10, false), {
    x: 117,
    y: 100,
  })
  assert.deepEqual(snapToWallEndpoints({ x: 103.9, y: 100 }, candidate, { x: 0, y: 0, zoom: 2 }, 10, false), {
    x: 100,
    y: 100,
  })
  assert.deepEqual(snapToWallEndpoints({ x: 104.1, y: 100 }, candidate, { x: 0, y: 0, zoom: 2 }, 10, false), {
    x: 104.1,
    y: 100,
  })
})

test('logical points and panning stay on the non-negative side of the origin', () => {
  assert.deepEqual(clampLogicalPoint({ x: -20, y: 40 }), { x: 0, y: 40 })
  assert.deepEqual(clampLogicalPoint({ x: 12000, y: -5 }), { x: 12000, y: 0 })
  assert.deepEqual(clampViewportToNonNegative({ x: 140, y: 120, zoom: 1 }), { x: 80, y: 80, zoom: 1 })
  assert.deepEqual(clampViewportToNonNegative({ x: -140, y: -120, zoom: 1 }), { x: -140, y: -120, zoom: 1 })
})

test('wall endpoint snapping takes priority over grid snapping', () => {
  assert.deepEqual(snapToWallEndpoints({ x: 94, y: 63 }, [{ x: 97, y: 67 }], { x: 0, y: 0, zoom: 1 }, 10, true), {
    x: 97,
    y: 67,
  })
  assert.deepEqual(snapToWallEndpoints({ x: 82, y: 63 }, [], { x: 0, y: 0, zoom: 1 }, 10, true), {
    x: 80,
    y: 60,
  })
})

test('open endpoints distinguish a closed loop from an open wall chain', () => {
  const rectangle = [
    { id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { id: 'b', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
    { id: 'c', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
    { id: 'd', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
  ]
  assert.equal(findOpenWallEndpoints(rectangle).length, 0)
  assert.deepEqual(
    findOpenWallEndpoints(rectangle.slice(0, 3)).map(({ wallId, endpoint }) => ({ wallId, endpoint })),
    [
      { wallId: 'a', endpoint: 'start' },
      { wallId: 'c', endpoint: 'end' },
    ],
  )
})

test('ruler steps stay legible and ticks follow viewport pan', () => {
  assert.equal(rulerStepForZoom(0.5), 200)
  assert.equal(rulerStepForZoom(1), 100)
  assert.equal(rulerStepForZoom(2), 50)
  assert.deepEqual(axisRulerTicks(300, 80, 1, 100), [
    { value: 0, screen: 80 },
    { value: 100, screen: 180 },
    { value: 200, screen: 280 },
  ])
})

test('ruler coordinates can be filtered to the non-negative drawing area', () => {
  assert.deepEqual(axisRulerTicks(300, 280, 1, 100).filter((tick) => tick.value >= 0).map((tick) => tick.value), [0])
})

test('locating an empty plan returns to the origin at 100 percent', () => {
  assert.deepEqual(fitDocumentViewport({ walls: [], rooms: [], furniture: [] }, 390, 446), { x: 80, y: 80, zoom: 1 })
})

test('fit includes remote walls, room vertices and rotated furniture on a narrow canvas', () => {
  const doc = {
    walls: [{ start: { x: 500, y: 500 }, end: { x: 1000, y: 1000 }, thickness: 50 }],
    rooms: [
      {
        polygon: [
          { x: 9200, y: 9500 },
          { x: 9700, y: 9500 },
          { x: 9700, y: 10000 },
        ],
      },
    ],
    furniture: [{ position: { x: 8000, y: 8000 }, rotation: 45, width: 2000, depth: 2000 }],
  }
  const before = JSON.stringify(doc)
  const view = fitDocumentViewport(doc, 319, 446)
  const extent = 1000 * Math.SQRT2
  for (const point of [
    { x: 500 - 25 * Math.SQRT2, y: 500 - 25 * Math.SQRT2 },
    { x: 9700, y: 10000 },
    { x: 8000 + extent, y: 8000 },
    { x: 8000, y: 8000 - extent },
  ]) {
    const screen = logicalToScreen(point, view)
    assert.ok(screen.x >= 63.999 && screen.x <= 287.001, `x must fit inside canvas: ${screen.x}`)
    assert.ok(screen.y >= 69.999 && screen.y <= 350.001, `y must fit inside canvas: ${screen.y}`)
  }
  assert.ok(view.zoom < 0.35, 'large designs must fit below the former zoom limit')
  assert.equal(JSON.stringify(doc), before, 'locating must not move objects')
})

test('a small furniture-only design is centered without excessive zoom', () => {
  const view = fitDocumentViewport(
    { walls: [], rooms: [], furniture: [{ position: { x: 400, y: 900 }, width: 90, depth: 60, rotation: 30 }] },
    1000,
    700,
  )
  assert.equal(view.zoom, 1)
  assert.deepEqual(logicalToScreen({ x: 400, y: 900 }, view), { x: 516, y: 337 })
})

test('Shift constrains all four drawing directions, preserving an off-grid origin', () => {
  const origin = { x: 103, y: 57 }
  const viewport = { x: 80, y: 80, zoom: 1 }
  for (const [point, expected] of [
    [
      { x: 123, y: 80 },
      { x: 103, y: 80 },
    ],
    [
      { x: 74, y: 20 },
      { x: 103, y: 20 },
    ],
    [
      { x: 76, y: 278 },
      { x: 103, y: 280 },
    ],
    [
      { x: 80, y: 166 },
      { x: 103, y: 170 },
    ],
  ]) {
    assert.deepEqual(snapOrthogonalPoint(origin, point, [], viewport, 10, true), expected)
  }
  assert.deepEqual(snapOrthogonalPoint(origin, { x: 123, y: 80 }, [], viewport, 10, false), { x: 103, y: 80 })
})

test('Shift only snaps to endpoints on the locked axis and respects zoom', () => {
  const origin = { x: 3, y: 7 }
  const candidates = [
    { x: 100, y: 10 },
    { x: 107, y: 7 },
  ]
  assert.deepEqual(snapOrthogonalPoint(origin, { x: 100, y: 10 }, candidates, { x: 0, y: 0, zoom: 1 }, 10, true), {
    x: 107,
    y: 7,
  })
  assert.deepEqual(snapOrthogonalPoint(origin, { x: 100, y: 10 }, candidates, { x: 0, y: 0, zoom: 2 }, 10, true), {
    x: 100,
    y: 7,
  })
})
