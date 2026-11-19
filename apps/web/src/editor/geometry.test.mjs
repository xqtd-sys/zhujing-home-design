import assert from 'node:assert/strict'
import test from 'node:test'
import {
  axisRulerTicks,
  clampLogicalPoint,
  clampViewportToNonNegative,
  constrainToAngle,
  findOpenWallEndpoints,
  rulerStepForZoom,
  snapToWallEndpoints,
  snapToWallGeometry,
  snapToWallsAndGrid,
  snapWallDrawPoint,
  resolvePointSnap,
  resolveAxisSnap,
  wallMidpoint,
  openingAnchorPoints,
  segmentAngleDegrees,
  wallFromLengthAngle,
  snapAngleStep,
  furnitureBox,
  alignFurniture,
  distributeFurniture,
  pointInPolygon,
  pointInPolygonInclusive,
  pointOnPolygonBoundary,
  rectFromPoints,
  pointInRect,
  rectsOverlap,
  segmentsIntersect,
  segmentIntersectsRect,
  polygonIntersectsRect,
  SNAP_PRIORITY,
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

test('open endpoints 不把 T 型接点和识别图的取整误差当成开口', () => {
  // 一面横墙从 x=0 到 200，中间 x=100 处接一面竖墙（T 型，竖墙端点不在横墙端点上）。
  const tee = [
    { id: 'wall', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
    { id: 'branch', start: { x: 100, y: 0 }, end: { x: 100, y: 120 } },
  ]
  const open = findOpenWallEndpoints(tee).map(({ wallId, endpoint }) => `${wallId}:${endpoint}`)
  // 只有三个真正的自由端，接到横墙身上的 branch:start 不算开口。
  assert.deepEqual(open.sort(), ['branch:end', 'wall:end', 'wall:start'])
  // 识别得到的坐标会按 0.1cm 取整，0.1cm 的误差不应被当成断开。
  const rounded = [
    { id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { id: 'b', start: { x: 100.1, y: 0 }, end: { x: 100.1, y: 80 } },
  ]
  const roundedOpen = findOpenWallEndpoints(rounded).map(({ wallId, endpoint }) => `${wallId}:${endpoint}`)
  assert.ok(!roundedOpen.includes('a:end'))
  assert.ok(!roundedOpen.includes('b:start'))
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

test('walls snap to nearby endpoints and to wall centerlines within 12px', () => {
  const walls = [{ id: 'a', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } }]
  const viewport = { x: 0, y: 0, zoom: 1 }
  // 10px away from a corner: snaps to the endpoint.
  assert.deepEqual(snapToWallGeometry({ x: 10, y: 6 }, walls, viewport), { point: { x: 0, y: 0 }, kind: 'endpoint', wallId: 'a' })
  // 10px away from the middle of the wall: snaps onto the centerline (the former gap).
  assert.deepEqual(snapToWallGeometry({ x: 100, y: 10 }, walls, viewport), { point: { x: 100, y: 0 }, kind: 'body', wallId: 'a' })
  // 15px away: outside the default threshold.
  assert.equal(snapToWallGeometry({ x: 100, y: 15 }, walls, viewport), null)
  // Endpoints win even when the body projection is closer.
  assert.deepEqual(snapToWallGeometry({ x: 4, y: 2 }, walls, viewport), { point: { x: 0, y: 0 }, kind: 'endpoint', wallId: 'a' })
  // Extra points (e.g. room vertices) can attract the cursor too.
  assert.deepEqual(
    snapToWallGeometry({ x: 305, y: 55 }, [], viewport, 12, { extraPoints: [{ x: 300, y: 50 }] }),
    { point: { x: 300, y: 50 }, kind: 'endpoint', wallId: undefined },
  )
  // A wall's own centerline can be excluded while dragging its endpoint.
  assert.equal(snapToWallGeometry({ x: 120, y: 10 }, walls, viewport, 12, { excludeWallId: 'a' }), null)
})

test('snapToWallsAndGrid prefers geometry, then grid, then free', () => {
  const walls = [{ id: 'a', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } }]
  const viewport = { x: 0, y: 0, zoom: 1 }
  assert.deepEqual(snapToWallsAndGrid({ x: 100, y: 8 }, walls, viewport, 10, true), {
    point: { x: 100, y: 0 },
    kind: 'body',
    wallId: 'a',
  })
  assert.deepEqual(snapToWallsAndGrid({ x: 47, y: 63 }, [], viewport, 10, true), { point: { x: 50, y: 60 }, kind: 'grid' })
  assert.deepEqual(snapToWallsAndGrid({ x: 47, y: 63 }, [], viewport, 10, false), { point: { x: 47, y: 63 }, kind: 'none' })
})

test('constrainToAngle locks near-axis segments and leaves free angles alone', () => {
  const start = { x: 0, y: 0 }
  const close = (actual, expected, eps = 1e-6) =>
    Math.abs(actual.x - expected.x) < eps && Math.abs(actual.y - expected.y) < eps
  assert.ok(close(constrainToAngle(start, { x: 100, y: 5 }, 90, 6), { x: 100, y: 0 }))
  assert.ok(close(constrainToAngle(start, { x: 5, y: 100 }, 90, 6), { x: 0, y: 100 }))
  assert.deepEqual(constrainToAngle(start, { x: 100, y: 20 }, 90, 6), { x: 100, y: 20 })
  // 45° lock: a 50° cursor ray projects onto the 45° diagonal (110, 110).
  assert.ok(close(constrainToAngle(start, { x: 100, y: 120 }, 45, 10), { x: 110, y: 110 }))
})

test('snapWallDrawPoint snaps to wall bodies, then auto angle, then grid', () => {
  const walls = [{ id: 'a', start: { x: 0, y: 300 }, end: { x: 400, y: 300 } }]
  const viewport = { x: 0, y: 0, zoom: 1 }
  // Body snap wins over angle/grid.
  assert.deepEqual(snapWallDrawPoint({ x: 0, y: 0 }, { x: 200, y: 292 }, walls, viewport, 10, true), {
    point: { x: 200, y: 300 },
    kind: 'body',
    wallId: 'a',
  })
  // No wall nearby: near-horizontal auto-locks, then the length snaps to the grid.
  assert.deepEqual(
    snapWallDrawPoint({ x: 0, y: 0 }, { x: 103, y: 4 }, [], viewport, 10, true, { angleStepDeg: 90, angleToleranceDeg: 6 }),
    { point: { x: 100, y: 0 }, kind: 'angle' },
  )
  // Free angle with grid only.
  assert.deepEqual(snapWallDrawPoint({ x: 0, y: 0 }, { x: 103, y: 44 }, [], viewport, 10, true), {
    point: { x: 100, y: 40 },
    kind: 'grid',
  })
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

const viewport1 = { x: 0, y: 0, zoom: 1 }

test('resolvePointSnap lets semantic priority beat a closer low-priority point', () => {
  const anchors = [
    { id: 'v', kind: 'wall-vertex', point: { x: 100, y: 100 } },
    { id: 'c', kind: 'furniture-center', point: { x: 104, y: 100 } },
  ]
  // Both within 8px; the far wall corner (priority 100) wins over the near furniture center (75).
  const snap = resolvePointSnap({ x: 106, y: 103 }, anchors, viewport1)
  assert.equal(snap.anchorId, 'v')
  assert.deepEqual(snap.point, { x: 100, y: 100 })
  assert.equal(snap.kind, 'wall-vertex')
  // A candidate just outside the enter radius never qualifies even if it looks close-ish.
  const outside = resolvePointSnap({ x: 111, y: 102 }, anchors, viewport1)
  assert.equal(outside.anchorId, 'c') // only 'c' (dist 7.28) is inside 8px; 'v' (11.2px) is not
})

test('resolvePointSnap keeps the current target until the 14px release radius (no flicker)', () => {
  const anchors = [
    { id: 'v', kind: 'wall-vertex', point: { x: 100, y: 100 }, label: '墙角' },
    { id: 'c', kind: 'furniture-center', point: { x: 104, y: 100 } },
  ]
  // 9px from 'v' — beyond enter 8px but inside release 14px, so it must stay snapped to 'v'.
  const held = resolvePointSnap({ x: 100, y: 109 }, anchors, viewport1, { currentId: 'v' })
  assert.equal(held.anchorId, 'v')
  assert.equal(held.label, '墙角')
  // 15px from 'v' — the release radius is exceeded, so the snap must let go.
  const released = resolvePointSnap({ x: 100, y: 116 }, anchors, viewport1, { currentId: 'v' })
  assert.notEqual(released.anchorId, 'v')
})

test('resolvePointSnap allows a clearly higher-priority challenger to take over', () => {
  const anchors = [
    { id: 'c', kind: 'furniture-center', point: { x: 104, y: 100 } },
    { id: 'v', kind: 'wall-vertex', point: { x: 100, y: 100 } },
  ]
  // Holding 'c' (8.06px), a higher-priority 'v' (7px) appears inside the enter radius.
  const snap = resolvePointSnap({ x: 100, y: 107 }, anchors, viewport1, { currentId: 'c' })
  assert.equal(snap.anchorId, 'v')
})

test('resolvePointSnap lets a higher priority tier steal even when slightly farther', () => {
  const anchors = [
    { id: 'w', kind: 'wall-line', segment: { start: { x: 0, y: 100 }, end: { x: 200, y: 100 } } },
    { id: 'o', kind: 'opening-center', point: { x: 104, y: 100 } },
  ]
  // Holding the wall centerline at 2px, an opening center at 4.47px is a higher semantic tier (80 vs 60).
  const snap = resolvePointSnap({ x: 100, y: 102 }, anchors, viewport1, { currentId: 'w' })
  assert.equal(snap.anchorId, 'o')
})

test('wall length/angle input round-trips through wallFromLengthAngle', () => {
  const start = { x: 100, y: 100 }
  const right = wallFromLengthAngle(start, 200, 0)
  assert.deepEqual(right, { x: 300, y: 100 })
  assert.equal(Math.round(segmentAngleDegrees({ start, end: right })), 0)
  const down = wallFromLengthAngle(start, 150, 90)
  assert.ok(Math.abs(down.x - 100) < 1e-9 && Math.abs(down.y - 250) < 1e-9)
  assert.equal(Math.round(segmentAngleDegrees({ start, end: down })), 90)
  // Reconstructing from the measured angle+length returns the same endpoint.
  const measured = segmentAngleDegrees({ start, end: { x: 180, y: 240 } })
  const rebuilt = wallFromLengthAngle(start, Math.hypot(80, 140), measured)
  assert.ok(Math.abs(rebuilt.x - 180) < 1e-9 && Math.abs(rebuilt.y - 240) < 1e-9)
})

test('snapAngleStep rounds to 15 degree increments and normalizes negatives', () => {
  assert.equal(snapAngleStep(0), 0)
  assert.equal(snapAngleStep(7), 0)
  assert.equal(snapAngleStep(8), 15)
  assert.equal(snapAngleStep(44), 45)
  assert.equal(snapAngleStep(90), 90)
  assert.equal(snapAngleStep(359), 0)
  assert.equal(snapAngleStep(-10), 345)
  assert.equal(snapAngleStep(-190), 165)
  // A coarser step is respected too.
  assert.equal(snapAngleStep(50, 90), 90)
})

test('furnitureBox respects rotation and align/distribute keep sizes', () => {
  const box = furnitureBox({ id: 'a', position: { x: 100, y: 100 }, width: 40, depth: 20, rotation: 0 })
  assert.deepEqual(box, { left: 80, right: 120, top: 90, bottom: 110, centerX: 100, centerY: 100 })
  const rotated = furnitureBox({ id: 'a', position: { x: 100, y: 100 }, width: 40, depth: 20, rotation: 90 })
  assert.ok(Math.abs(rotated.left - 90) < 1e-9 && Math.abs(rotated.top - 80) < 1e-9 && Math.abs(rotated.bottom - 120) < 1e-9)

  const items = [
    { id: 'a', position: { x: 300, y: 300 }, width: 100, depth: 60, rotation: 0 },
    { id: 'b', position: { x: 600, y: 500 }, width: 100, depth: 60, rotation: 0 },
  ]
  const left = alignFurniture(items, 'left')
  assert.deepEqual(left, [
    { id: 'a', position: { x: 300, y: 300 } },
    { id: 'b', position: { x: 300, y: 500 } },
  ])
  const centered = alignFurniture(items, 'center-x')
  assert.deepEqual(centered, [
    { id: 'a', position: { x: 450, y: 300 } },
    { id: 'b', position: { x: 450, y: 500 } },
  ])

  const three = [
    { id: 'a', position: { x: 100, y: 100 }, width: 100, depth: 60, rotation: 0 },
    { id: 'b', position: { x: 300, y: 100 }, width: 100, depth: 60, rotation: 0 },
    { id: 'c', position: { x: 600, y: 100 }, width: 100, depth: 60, rotation: 0 },
  ]
  assert.deepEqual(distributeFurniture(three, 'x'), [
    { id: 'a', position: { x: 100, y: 100 } },
    { id: 'b', position: { x: 350, y: 100 } },
    { id: 'c', position: { x: 600, y: 100 } },
  ])
})

test('resolvePointSnap falls back to grid then to none', () => {
  const grid = resolvePointSnap({ x: 47, y: 63 }, [], viewport1, { gridSize: 10, gridEnabled: true })
  assert.deepEqual(grid, { point: { x: 50, y: 60 }, kind: 'grid', anchorId: null, label: '网格', target: null })
  const none = resolvePointSnap({ x: 47, y: 63 }, [], viewport1, { gridSize: 10, gridEnabled: false })
  assert.deepEqual(none, { point: { x: 47, y: 63 }, kind: 'none', anchorId: null, label: '', target: null })
})

test('resolveAxisSnap snaps x and y independently and reports labels and guides', () => {
  const anchors = [
    { id: 'xL', axis: 'x', value: 100, kind: 'furniture-corner', label: '左对齐' },
    { id: 'yT', axis: 'y', value: 46, kind: 'furniture-corner', label: '上对齐' },
  ]
  const result = resolveAxisSnap({ xs: [103], ys: [50] }, anchors, viewport1)
  assert.equal(result.dx, -3)
  assert.equal(result.dy, -4)
  assert.equal(result.xKind, 'furniture-corner')
  assert.equal(result.yKind, 'furniture-corner')
  assert.deepEqual(result.guideXs, [100])
  assert.deepEqual(result.guideYs, [46])
  assert.deepEqual(result.labels, ['左对齐', '上对齐'])
})

test('resolveAxisSnap prefers the higher-priority line at equal distance', () => {
  const anchors = [
    { id: 'f', axis: 'x', value: 100, kind: 'furniture-corner', label: '左对齐' },
    { id: 'w', axis: 'x', value: 108, kind: 'wall-vertex', label: '墙端对齐' },
  ]
  const result = resolveAxisSnap({ xs: [104], ys: [] }, anchors, viewport1)
  assert.equal(result.xId, 'w')
  assert.equal(result.dx, 4)
  assert.deepEqual(result.guideXs, [108])
})

test('resolveAxisSnap holds the current line until released, then can re-latch', () => {
  const anchors = [
    { id: 'xL', axis: 'x', value: 100, kind: 'furniture-corner' },
    { id: 'xR', axis: 'x', value: 112, kind: 'furniture-corner' },
  ]
  const held = resolveAxisSnap({ xs: [110], ys: [] }, anchors, viewport1, { currentXId: 'xL' })
  assert.equal(held.xId, 'xL') // 10px from 100 — inside release, equal priority so kept
  assert.equal(held.dx, -10)
  const relatched = resolveAxisSnap({ xs: [116], ys: [] }, anchors, viewport1, { currentXId: 'xL' })
  assert.equal(relatched.xId, 'xR') // 16px from 100 exceeds release; 4px from 112 re-latches
})

test('resolvePointSnap thresholds stay screen-pixel based at any zoom', () => {
  const anchors = [{ id: 'v', kind: 'wall-vertex', point: { x: 100, y: 100 } }]
  // 12 logical units at zoom 0.5 → 6 screen px (inside enter); at zoom 2 → 24 screen px (outside).
  assert.equal(resolvePointSnap({ x: 112, y: 100 }, anchors, { x: 0, y: 0, zoom: 0.5 }).anchorId, 'v')
  assert.equal(resolvePointSnap({ x: 112, y: 100 }, anchors, { x: 0, y: 0, zoom: 2 }).anchorId, null)
})

test('wall midpoint, opening anchors and angle helpers', () => {
  const wall = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }
  assert.deepEqual(wallMidpoint(wall), { x: 50, y: 0 })
  const anchors = openingAnchorPoints(wall, { offset: 20, width: 40 })
  assert.deepEqual(anchors.start, { x: 20, y: 0 })
  assert.deepEqual(anchors.end, { x: 60, y: 0 })
  assert.deepEqual(anchors.center, { x: 40, y: 0 })
  assert.equal(segmentAngleDegrees(wall), 0)
  assert.equal(segmentAngleDegrees({ start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }), 90)
  assert.equal(segmentAngleDegrees({ start: { x: 0, y: 0 }, end: { x: 0, y: -10 } }), 270)
})

test('semantic priorities keep corners above midpoints/openings and grid last', () => {
  assert.ok(SNAP_PRIORITY['wall-intersection'] > SNAP_PRIORITY['room-corner'])
  assert.ok(SNAP_PRIORITY['room-corner'] > SNAP_PRIORITY['wall-midpoint'])
  assert.ok(SNAP_PRIORITY['furniture-corner'] > SNAP_PRIORITY['opening-center'])
  assert.ok(SNAP_PRIORITY['opening-center'] > SNAP_PRIORITY['furniture-center'])
  assert.ok(SNAP_PRIORITY['furniture-center'] > SNAP_PRIORITY.grid)
})

test('opening center outranks a nearer furniture center by semantic priority', () => {
  const anchors = [
    { id: 'o', kind: 'opening-center', point: { x: 100, y: 100 } },
    { id: 'f', kind: 'furniture-center', point: { x: 104, y: 100 } },
  ]
  const snap = resolvePointSnap({ x: 103, y: 101 }, anchors, viewport1)
  assert.equal(snap.anchorId, 'o')
})

test('resolveAxisSnap distance-snaps to standard gaps (10/30/60cm)', () => {
  const anchors = [{ id: 'wall', axis: 'x', value: 100, kind: 'wall-vertex', label: '墙端对齐' }]
  // 32cm to the right of the wall edge → snaps to a 30cm gap (target 130).
  const right = resolveAxisSnap({ xs: [132], ys: [] }, anchors, viewport1, { gaps: [10, 30, 60] })
  assert.equal(right.xId, 'distance:wall:1:30')
  assert.equal(right.dx, -2)
  assert.equal(right.xKind, 'distance')
  assert.deepEqual(right.guideXs, [100])
  assert.deepEqual(right.labels, ['间距 30cm'])
  // 32cm to the left → the -1 gap (target 70).
  const left = resolveAxisSnap({ xs: [68], ys: [] }, anchors, viewport1, { gaps: [10, 30, 60] })
  assert.equal(left.xId, 'distance:wall:-1:30')
  assert.equal(left.dx, 2)
  // Edge alignment outranks an equidistant gap.
  const aligned = resolveAxisSnap({ xs: [105], ys: [] }, anchors, viewport1, { gaps: [10, 30, 60] })
  assert.equal(aligned.xId, 'wall')
})

test('resolveAxisSnap keeps a gap lock until the release radius', () => {
  const anchors = [{ id: 'wall', axis: 'x', value: 100, kind: 'wall-vertex' }]
  const held = resolveAxisSnap({ xs: [138], ys: [] }, anchors, viewport1, {
    gaps: [10, 30, 60],
    currentXId: 'distance:wall:1:30',
  })
  assert.equal(held.xId, 'distance:wall:1:30')
  assert.equal(held.dx, -8)
  const released = resolveAxisSnap({ xs: [146], ys: [] }, anchors, viewport1, {
    gaps: [10, 30, 60],
    currentXId: 'distance:wall:1:30',
  })
  assert.equal(released.xId, null)
})

test('resolveAxisSnap grid fallback only when no line is in range', () => {
  const loose = resolveAxisSnap({ xs: [47], ys: [63] }, [], viewport1, { gridSize: 10, gridEnabled: true })
  assert.equal(loose.dx, 3)
  assert.equal(loose.dy, -3)
  assert.equal(loose.xKind, 'grid')
  assert.equal(loose.yKind, 'grid')
})

test('pointInPolygon handles inside/outside and inclusive boundary points', () => {
  const square = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 },
  ]
  assert.equal(pointInPolygon({ x: 300, y: 250 }, square), true)
  assert.equal(pointInPolygon({ x: 50, y: 250 }, square), false)
  // A point just above the top edge is outside; the exact edge is only guaranteed by the inclusive helper.
  assert.equal(pointInPolygon({ x: 300, y: 99 }, square), false)
  assert.equal(pointInPolygonInclusive({ x: 300, y: 100 }, square), true)
  assert.equal(pointOnPolygonBoundary({ x: 100, y: 400 }, square), true)
  assert.equal(pointInPolygonInclusive({ x: 100.3, y: 400.2 }, square), true)
  assert.equal(pointInPolygonInclusive({ x: 98, y: 250 }, square), false)
})

test('rectFromPoints normalises any drag direction and hit-tests points', () => {
  const rect = rectFromPoints({ x: 400, y: 300 }, { x: 100, y: 150 })
  assert.deepEqual(rect, { minX: 100, minY: 150, maxX: 400, maxY: 300 })
  assert.equal(pointInRect({ x: 250, y: 200 }, rect), true)
  assert.equal(pointInRect({ x: 100, y: 150 }, rect), true)
  assert.equal(pointInRect({ x: 99, y: 200 }, rect), false)
  assert.equal(rectsOverlap(rect, { minX: 380, minY: 280, maxX: 600, maxY: 500 }), true)
  assert.equal(rectsOverlap(rect, { minX: 400, minY: 300, maxX: 500, maxY: 400 }), true)
  assert.equal(rectsOverlap(rect, { minX: 401, minY: 301, maxX: 500, maxY: 400 }), false)
})

test('segment and polygon rect intersections catch partial overlaps', () => {
  const rect = { minX: 100, minY: 100, maxX: 200, maxY: 200 }
  // Fully inside, crossing, fully outside, and touching only an edge.
  assert.equal(segmentIntersectsRect({ start: { x: 120, y: 120 }, end: { x: 180, y: 180 } }, rect), true)
  assert.equal(segmentIntersectsRect({ start: { x: 50, y: 150 }, end: { x: 400, y: 150 } }, rect), true)
  assert.equal(segmentIntersectsRect({ start: { x: 0, y: 0 }, end: { x: 50, y: 50 } }, rect), false)
  assert.equal(segmentIntersectsRect({ start: { x: 200, y: 50 }, end: { x: 200, y: 250 } }, rect), true)
  // A wall that only clips one corner still counts, which is what marquee selection needs.
  assert.equal(segmentIntersectsRect({ start: { x: 90, y: 90 }, end: { x: 110, y: 110 } }, rect), true)
  assert.equal(segmentsIntersect({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }, { start: { x: 0, y: 10 }, end: { x: 10, y: 0 } }), true)
  assert.equal(segmentsIntersect({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }), false)

  const square = [
    { x: 150, y: 150 },
    { x: 250, y: 150 },
    { x: 250, y: 250 },
    { x: 150, y: 250 },
  ]
  assert.equal(polygonIntersectsRect(square, rect), true)
  assert.equal(polygonIntersectsRect([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }], rect), false)
  // A room polygon that fully encloses the marquee is also a hit.
  const big = [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 500 },
    { x: 0, y: 500 },
  ]
  assert.equal(polygonIntersectsRect(big, rect), true)
})
