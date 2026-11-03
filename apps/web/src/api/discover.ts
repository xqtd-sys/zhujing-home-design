import { apiClient } from './client'
import type { ApiEnvelope, DiscoverPlanDetail, DiscoverPlanSummary, PageResult, PlanDetail } from '../types/api'

export async function listDiscoverPlans(page = 1, pageSize = 12, keyword?: string, sort: 'latest' | 'likes' = 'latest') {
  const response = await apiClient.get<ApiEnvelope<PageResult<DiscoverPlanSummary>>>('/discover/plans', {
    params: { page, pageSize, keyword: keyword?.trim() || undefined, sort },
  })
  return response.data.data
}

export async function toggleDiscoverLike(id: string) {
  const response = await apiClient.post<ApiEnvelope<{ liked: boolean; likeCount: number }>>(`/discover/plans/${id}/like`)
  return response.data.data
}

export async function getDiscoverPlan(id: string) {
  const response = await apiClient.get<ApiEnvelope<DiscoverPlanDetail>>(`/discover/plans/${id}`)
  return response.data.data
}

export async function copyDiscoverPlan(id: string) {
  const response = await apiClient.post<ApiEnvelope<PlanDetail>>(`/discover/plans/${id}/copy`)
  return response.data.data
}
