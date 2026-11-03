import type { PlanDocument } from '@home-design/plan-schema'
import { apiClient } from './client'
import type { ApiEnvelope, PageResult, PlanDetail, PlanSummary } from '../types/api'

export async function listPlans(page = 1, pageSize = 12) {
  const response = await apiClient.get<ApiEnvelope<PageResult<PlanSummary>>>('/plans', { params: { page, pageSize } })
  return response.data.data
}
export async function createPlan(name: string) {
  const response = await apiClient.post<ApiEnvelope<PlanDetail>>('/plans', { name })
  return response.data.data
}
export async function importPlan(name: string, documentJson: PlanDocument) {
  const response = await apiClient.post<ApiEnvelope<PlanDetail>>('/plans/import', { name, documentJson })
  return response.data.data
}
export async function getPlan(id: string) {
  const response = await apiClient.get<ApiEnvelope<PlanDetail>>(`/plans/${id}`)
  return response.data.data
}
export async function savePlan(id: string, expectedRevision: number, documentJson: PlanDocument) {
  const response = await apiClient.put<ApiEnvelope<PlanDetail>>(`/plans/${id}`, { expectedRevision, documentJson })
  return response.data.data
}
export async function deletePlan(id: string) {
  await apiClient.delete(`/plans/${id}`)
}
export async function updatePlanVisibility(id: string, isPublic: boolean) {
  const response = await apiClient.patch<ApiEnvelope<PlanDetail>>(`/plans/${id}/visibility`, { isPublic })
  return response.data.data
}
