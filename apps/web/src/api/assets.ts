import { apiClient } from './client'
import type { ApiEnvelope, FurnitureAssetSummary, FurnitureCategorySummary } from '../types/api'

export async function listFurnitureCategories() {
  const response = await apiClient.get<ApiEnvelope<FurnitureCategorySummary[]>>('/furniture-categories')
  return response.data.data
}

export async function listFurnitureAssets(params?: { categoryId?: string; keyword?: string }) {
  const response = await apiClient.get<ApiEnvelope<FurnitureAssetSummary[]>>('/furniture-assets', { params })
  return response.data.data
}
