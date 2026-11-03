import type { AdminOverview, AdminUser, ApiEnvelope } from '../types/api'
import { apiClient } from './client'

export async function getAdminOverview() {
  const response = await apiClient.get<ApiEnvelope<AdminOverview>>('/admin/overview')
  return response.data.data
}

export async function listAdminUsers() {
  const response = await apiClient.get<ApiEnvelope<AdminUser[]>>('/admin/users')
  return response.data.data
}

export async function toggleAdminUserStatus(id: string) {
  const response = await apiClient.patch<ApiEnvelope<{ id: string; status: 'active' | 'disabled' }>>(`/admin/users/${id}/status`)
  return response.data.data
}
