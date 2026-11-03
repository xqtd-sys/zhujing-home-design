<script setup lang="ts">
defineProps<{ tool: string }>()
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-if="tool === 'select'" d="m5 3 14 9-7 1-3 7Z" />
    <path v-else-if="tool === 'wall'" d="M3 5h18v14H3ZM3 12h18M9 5v7m7 0v7" />
    <path v-else-if="tool === 'door'" d="M4 21V3h15v18M7 21V6l9-2v17ZM12 13h1" />
    <path v-else-if="tool === 'window'" d="M3 3h18v18H3ZM6 6h12v12H6Zm6 0v12m-6-6h12" />
    <path v-else-if="tool === 'room'" d="M3 3h18v7h-8v11H3ZM6 7v10m0 0h3" />
    <path v-else d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M5 15h14M3 10h3v9H3Zm15 0h3v9h-3ZM5 19v2m14-2v2" />
  </svg>
</template>
