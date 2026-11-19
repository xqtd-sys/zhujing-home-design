<script setup lang="ts">
defineProps<{ presetId: string }>()
</script>

<template>
  <svg
    class="opening-preview"
    viewBox="0 0 120 72"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <line x1="6" y1="36" x2="114" y2="36" opacity="0.3" />

    <!-- 双开门 -->
    <template v-if="presetId === 'door-double'">
      <line x1="28" y1="36" x2="28" y2="58" />
      <line x1="92" y1="36" x2="92" y2="58" />
      <path d="M60 36 A32 32 0 0 0 28 58" opacity="0.6" stroke-dasharray="4 4" />
      <path d="M60 36 A32 32 0 0 1 92 58" opacity="0.6" stroke-dasharray="4 4" />
    </template>
    <!-- 推拉门 -->
    <template v-else-if="presetId === 'door-sliding'">
      <line x1="24" y1="31" x2="72" y2="31" />
      <line x1="48" y1="41" x2="96" y2="41" />
      <line x1="24" y1="36" x2="96" y2="36" opacity="0.2" />
    </template>
    <!-- 折叠门 -->
    <template v-else-if="presetId === 'door-folding'">
      <path d="M24 36 L40 24 L56 36 L72 24 L88 36 L96 36" />
    </template>
    <!-- 单开门 -->
    <template v-else-if="presetId === 'door-single'">
      <line x1="34" y1="36" x2="34" y2="62" />
      <line x1="34" y1="36" x2="60" y2="36" opacity="0.4" />
      <path d="M60 36 A26 26 0 0 0 34 62" opacity="0.6" stroke-dasharray="4 4" />
    </template>
    <!-- 推拉窗 -->
    <template v-else-if="presetId === 'window-sliding'">
      <rect x="22" y="29" width="44" height="14" fill="currentColor" fill-opacity="0.14" />
      <rect x="54" y="36" width="44" height="14" fill="currentColor" fill-opacity="0.14" />
    </template>
    <!-- 落地窗 -->
    <template v-else-if="presetId === 'window-french'">
      <rect x="34" y="12" width="52" height="48" fill="currentColor" fill-opacity="0.14" />
      <line x1="51" y1="12" x2="51" y2="60" />
      <line x1="69" y1="12" x2="69" y2="60" />
    </template>
    <!-- 飘窗 -->
    <template v-else-if="presetId === 'window-bay'">
      <rect x="28" y="30" width="64" height="12" fill="currentColor" fill-opacity="0.14" />
      <path d="M28 30 L40 16 H88 L100 30" />
      <line x1="64" y1="30" x2="64" y2="16" />
    </template>
    <!-- 平开窗 -->
    <template v-else>
      <rect x="28" y="29" width="64" height="14" fill="currentColor" fill-opacity="0.14" />
      <line x1="60" y1="29" x2="60" y2="43" />
    </template>
  </svg>
</template>

<style scoped>
.opening-preview {
  width: 100%;
  max-width: 104px;
  height: 58px;
  display: block;
}
</style>