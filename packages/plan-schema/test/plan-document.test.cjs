const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { EMPTY_PLAN_DOCUMENT, PlanDocumentSchema, polygonArea, polygonSelfIntersects } = require('../dist/cjs/index.js')

describe('PlanDocumentSchema', () => {
  it('accepts the empty V1 document', () => {
    assert.equal(PlanDocumentSchema.safeParse(EMPTY_PLAN_DOCUMENT).success, true)
  })

  it('rejects walls shorter than 10cm', () => {
    const document = structuredClone(EMPTY_PLAN_DOCUMENT)
    document.walls.push({
      id: '11111111-1111-4111-8111-111111111111',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 },
      thickness: 20,
      height: 280,
    })
    assert.equal(PlanDocumentSchema.safeParse(document).success, false)
  })

  it('rejects negative coordinates', () => {
    const document = structuredClone(EMPTY_PLAN_DOCUMENT)
    document.walls.push({
      id: '11111111-1111-4111-8111-111111111111',
      start: { x: -1, y: 0 },
      end: { x: 100, y: 0 },
      thickness: 20,
      height: 280,
    })
    assert.equal(PlanDocumentSchema.safeParse(document).success, false)
  })

  it('rejects openings whose wall does not exist', () => {
    const document = structuredClone(EMPTY_PLAN_DOCUMENT)
    document.openings.push({
      id: '22222222-2222-4222-8222-222222222222',
      wallId: '11111111-1111-4111-8111-111111111111',
      type: 'door',
      offset: 0,
      width: 90,
      height: 210,
      sillHeight: 0,
    })
    assert.equal(PlanDocumentSchema.safeParse(document).success, false)
  })

  it('calculates polygon area in square centimeters', () => {
    assert.equal(
      polygonArea([
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 400 },
        { x: 0, y: 400 },
      ]),
      200000,
    )
  })

  it('rejects self-intersecting rooms', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 400, y: 400 },
      { x: 0, y: 400 },
      { x: 400, y: 0 },
    ]
    assert.equal(polygonSelfIntersects(polygon), true)
    const document = structuredClone(EMPTY_PLAN_DOCUMENT)
    document.rooms.push({ id: '33333333-3333-4333-8333-333333333333', name: '客厅', polygon })
    assert.equal(PlanDocumentSchema.safeParse(document).success, false)
  })
})
