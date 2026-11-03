import assert from 'node:assert/strict'
import test from 'node:test'
import { isProxy, reactive, ref } from 'vue'
import { cloneReactive } from './clone.ts'

test('clones a wall with reactive draft endpoints without retaining references', () => {
  const start = ref({ x: 100, y: 100 })
  const end = ref({ x: 400, y: 100 })
  const document = reactive({ walls: [{ start: start.value, end: end.value }] })
  const copy = cloneReactive(document)
  assert.deepEqual(copy, { walls: [{ start: { x: 100, y: 100 }, end: { x: 400, y: 100 } }] })
  assert.equal(isProxy(copy.walls[0].start), false)
  copy.walls[0].start.x = 900
  assert.equal(start.value.x, 100)
  assert.doesNotThrow(() => structuredClone(copy))
})

test('clones room draft vertices snapped to existing reactive wall endpoints', () => {
  const wall = reactive({ start: { x: 100, y: 100 }, end: { x: 400, y: 100 } })
  const vertices = ref([wall.start, wall.end, { x: 400, y: 300 }])
  const copy = cloneReactive(vertices.value)
  assert.deepEqual(copy, [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 300 },
  ])
  assert.ok(copy.every((point) => !isProxy(point)))
  wall.end.x = 500
  assert.equal(copy[1].x, 400)
})
