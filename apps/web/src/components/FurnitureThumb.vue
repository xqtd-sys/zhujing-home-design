<script setup lang="ts">
import { ref } from 'vue'
import FurniturePreview from './FurniturePreview.vue'

defineProps<{ name: string; color: string; iconUrl?: string | null }>()
const failed = ref(false)
</script>

<template>
  <img
    v-if="iconUrl && !failed"
    class="asset-photo"
    :src="iconUrl"
    :alt="name"
    loading="lazy"
    @error="failed = true"
  />
  <FurniturePreview v-else :name="name" :color="color" />
</template>