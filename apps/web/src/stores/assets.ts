import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as assetsApi from '../api/assets'
import {
  FALLBACK_FURNITURE_ASSETS,
  FALLBACK_FURNITURE_CATEGORIES,
  type FurnitureAsset,
  type FurnitureCategory,
} from '../editor/furniture-assets'

export const useAssetsStore = defineStore('assets', () => {
  const categories = ref<FurnitureCategory[]>(structuredClone(FALLBACK_FURNITURE_CATEGORIES))
  const items = ref<FurnitureAsset[]>(structuredClone(FALLBACK_FURNITURE_ASSETS))
  const loading = ref(false)
  const loaded = ref(false)

  function getById(assetId: string) {
    return items.value.find((asset) => asset.id === assetId)
  }

  async function load() {
    if (loading.value || loaded.value) return
    loading.value = true
    try {
      const [nextCategories, nextAssets] = await Promise.all([
        assetsApi.listFurnitureCategories(),
        assetsApi.listFurnitureAssets(),
      ])
      categories.value = nextCategories
      items.value = nextAssets.map((asset) => ({
        id: asset.id,
        categoryId: asset.categoryId,
        name: asset.name,
        width: asset.baseWidth,
        depth: asset.baseDepth,
        height: asset.baseHeight,
        color: asset.defaultColor,
      }))
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  return { categories, items, loading, loaded, getById, load }
})
