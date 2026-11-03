export type FurnitureAsset = {
  id: string
  categoryId: string
  name: string
  width: number
  depth: number
  height: number
  color: string
}

export type FurnitureCategory = { id: string; name: string; sortOrder: number }

export const FALLBACK_FURNITURE_CATEGORIES: FurnitureCategory[] = [
  { id: 'b1111111-1111-4111-8111-111111111111', name: '客厅', sortOrder: 10 },
  { id: 'b2222222-2222-4222-8222-222222222222', name: '卧室', sortOrder: 20 },
  { id: 'b3333333-3333-4333-8333-333333333333', name: '餐厅', sortOrder: 30 },
  { id: 'b4444444-4444-4444-8444-444444444444', name: '收纳', sortOrder: 40 },
]

export const FALLBACK_FURNITURE_ASSETS: FurnitureAsset[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    categoryId: 'b1111111-1111-4111-8111-111111111111',
    name: '沙发',
    width: 200,
    depth: 90,
    height: 85,
    color: '#94b5a5',
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    categoryId: 'b2222222-2222-4222-8222-222222222222',
    name: '床',
    width: 180,
    depth: 200,
    height: 55,
    color: '#b8aa91',
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    categoryId: 'b3333333-3333-4333-8333-333333333333',
    name: '餐桌',
    width: 140,
    depth: 80,
    height: 75,
    color: '#a88e72',
  },
  {
    id: 'a4444444-4444-4444-8444-444444444444',
    categoryId: 'b4444444-4444-4444-8444-444444444444',
    name: '柜子',
    width: 120,
    depth: 45,
    height: 200,
    color: '#8d9b91',
  },
]
