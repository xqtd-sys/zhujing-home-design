<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PlanDocument } from '@home-design/plan-schema'
import { getPlan } from '../api/plans'
import { getDiscoverPlan } from '../api/discover'

const props = defineProps<{ id: string; name: string; source?: 'owned' | 'discover'; document?: PlanDocument }>()
const host = ref<HTMLElement | null>(null)
const document = ref<PlanDocument | null>(null)
const failed = ref(false)
let observer: IntersectionObserver | undefined
let disposed = false
const hasContent = computed(
  () =>
    document.value &&
    [document.value.walls, document.value.rooms, document.value.furniture].some((items) => items.length),
)
const viewBox = computed(() => {
  const doc = document.value
  if (!doc) return '0 0 400 300'
  const points = [
    ...doc.walls.flatMap((w) => [w.start, w.end]),
    ...doc.rooms.flatMap((r) => r.polygon),
    ...doc.furniture.flatMap((f) => {
      const radius = Math.hypot(f.width, f.depth) / 2
      return [
        { x: f.position.x - radius, y: f.position.y - radius },
        { x: f.position.x + radius, y: f.position.y + radius },
      ]
    }),
  ]
  if (!points.length) return '0 0 400 300'
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y)
  const minX = Math.min(...xs),
    minY = Math.min(...ys)
  const width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY
  const padding = Math.max(width, height) * 0.12 + 25
  return `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`
})
const openings = computed(
  () =>
    document.value?.openings.flatMap((opening) => {
      const wall = document.value?.walls.find((w) => w.id === opening.wallId)
      if (!wall) return []
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
      if (!length) return []
      const dx = (wall.end.x - wall.start.x) / length,
        dy = (wall.end.y - wall.start.y) / length
      return [
        {
          ...opening,
          thickness: wall.thickness,
          x1: wall.start.x + dx * opening.offset,
          y1: wall.start.y + dy * opening.offset,
          x2: wall.start.x + dx * (opening.offset + opening.width),
          y2: wall.start.y + dy * (opening.offset + opening.width),
        },
      ]
    }) ?? [],
)
async function load() {
  if (props.document) {
    document.value = props.document
    return
  }
  try {
    const plan = props.source === 'discover' ? await getDiscoverPlan(props.id) : await getPlan(props.id)
    if (!disposed) document.value = plan.documentJson
  } catch {
    if (!disposed) failed.value = true
  }
}
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer?.disconnect()
        void load()
      }
    },
    { rootMargin: '100px' },
  )
  if (host.value) observer.observe(host.value)
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
})
</script>
<template>
  <div ref="host" class="plan-preview">
    <svg
      v-if="document && hasContent"
      :viewBox="viewBox"
      role="img"
      :aria-label="`${name}的户型缩略图`"
      class="plan-thumbnail"
    >
      <polygon
        v-for="room in document.rooms"
        :key="room.id"
        :points="room.polygon.map((p) => `${p.x},${p.y}`).join(' ')"
        fill="#e4dac5"
        stroke="#c4b99e"
        stroke-width="2"
      />
      <line
        v-for="wall in document.walls"
        :key="wall.id"
        :x1="wall.start.x"
        :y1="wall.start.y"
        :x2="wall.end.x"
        :y2="wall.end.y"
        stroke="#455b50"
        :stroke-width="wall.thickness"
        stroke-linecap="square"
      />
      <line
        v-for="opening in openings"
        :key="opening.id"
        v-bind="{ x1: opening.x1, y1: opening.y1, x2: opening.x2, y2: opening.y2 }"
        :stroke="opening.type === 'door' ? '#faf8f2' : '#a8c4c1'"
        :stroke-width="opening.thickness + 1"
      />
      <g
        v-for="item in document.furniture"
        :key="item.id"
        :transform="`translate(${item.position.x} ${item.position.y}) rotate(${item.rotation})`"
      >
        <rect
          :x="-item.width / 2"
          :y="-item.depth / 2"
          :width="item.width"
          :height="item.depth"
          rx="6"
          fill="#a7b9a8"
          stroke="#637e69"
          stroke-width="3"
        />
        <path
          :d="`M${-item.width / 2 + 8},${-item.depth / 2 + 12}h${Math.max(0, item.width - 16)}`"
          stroke="#dce5d8"
          stroke-width="4"
        />
      </g>
    </svg>
    <div v-else class="preview-empty">
      <svg viewBox="0 0 80 64" fill="none" aria-hidden="true">
        <path
          d="M12 10h56v44H12Zm28 0v22h28M12 38h20v16",
          stroke="currentColor"
          stroke-width="2"
          stroke-dasharray="4 3"
        /></svg
      ><small>{{ failed ? '预览暂不可用' : document ? '一张白纸，无限可能' : '正在绘制预览…' }}</small>
    </div>
    <span class="preview-tag">2D 平面</span>
  </div>
</template>
