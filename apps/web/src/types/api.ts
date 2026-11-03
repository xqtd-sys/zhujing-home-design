import type { PlanDocument } from '@home-design/plan-schema'

export type ApiEnvelope<T> = { code: string; message: string; data: T; requestId: string }
export type User = { id: string; username: string; email: string; nickname: string; role: 'user' | 'admin' }
export type AdminUser = User & { status: 'active' | 'disabled'; createdAt: string }
export type AdminOverview = {
  userCount: number
  planCount: number
  publicPlanCount: number
  likeCount: number
  recentUsers: AdminUser[]
  popularPlans: Array<{ id: string; name: string; username: string; nickname: string; likeCount: number }>
}
export type AuthSession = { accessToken: string; user: User }
export type FurnitureCategorySummary = { id: string; name: string; sortOrder: number }
export type FurnitureAssetSummary = {
  id: string
  categoryId: string
  name: string
  iconUrl: string | null
  modelUrl: string | null
  primitiveType: string | null
  baseWidth: number
  baseDepth: number
  baseHeight: number
  defaultColor: string
  sortOrder: number
}
export type PlanSummary = {
  id: string
  name: string
  revision: number
  schemaVersion: number
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
  isPublic: boolean
}
export type PlanDetail = PlanSummary & { ownerId: string; documentJson: PlanDocument }
export type DiscoverPlanSummary = PlanSummary & { likeCount: number; liked: boolean; author: { username: string; nickname: string } }
export type DiscoverPlanDetail = PlanDetail & { likeCount: number; liked: boolean; owner: { username: string; nickname: string } }
export type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number }
