<script setup lang="ts">
import { ArrowLeft, CopyDocument, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDiscoverPlan, toggleDiscoverLike } from '../api/discover'
import PlanThumbnail from '../components/PlanThumbnail.vue'
import { writeDesignClipboard } from '../editor/design-clipboard'
import { useAssetsStore } from '../stores/assets'
import type { DiscoverPlanDetail } from '../types/api'

const route = useRoute()
const router = useRouter()
const assets = useAssetsStore()
const loading = ref(true)
const copying = ref(false)
const liking = ref(false)
const plan = ref<DiscoverPlanDetail | null>(null)
const activeMode = ref<'2d' | '3d'>('2d')
const ThreePreview = defineAsyncComponent(() => import('../components/ThreePreview.vue'))
const planId = computed(() => String(route.params.id))

async function load() {
  loading.value = true
  try {
    plan.value = await getDiscoverPlan(planId.value)
    await assets.load()
  } finally {
    loading.value = false
  }
}

async function copyPlan() {
  if (!plan.value || copying.value) return
  copying.value = true
  try {
    writeDesignClipboard({ sourceName: plan.value.name, documentJson: plan.value.documentJson, copiedAt: Date.now() })
    ElMessage.success('设计已复制，请到“我的设计”点击粘贴设计')
  } finally {
    copying.value = false
  }
}

async function toggleLike() {
  if (!plan.value || liking.value) return
  liking.value = true
  try {
    const result = await toggleDiscoverLike(plan.value.id)
    plan.value.liked = result.liked
    plan.value.likeCount = result.likeCount
  } finally {
    liking.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="app-page">
    <header class="topbar editor-header discover-detail-header">
      <el-button text :icon="ArrowLeft" class="back-button" @click="router.push({ name: 'discover' })">发现</el-button>
      <div class="editor-title">
        <strong>{{ plan?.name ?? '加载中' }}</strong>
        <span v-if="plan">作者 · {{ plan.owner.nickname || plan.owner.username }} · 只读预览</span>
      </div>
      <div class="topbar-actions">
        <el-button plain :loading="liking" :class="{ 'detail-like-button': plan?.liked }" @click="toggleLike">♡ {{ plan?.likeCount ?? 0 }}</el-button>
        <el-button type="primary" :icon="CopyDocument" :loading="copying" :disabled="!plan" @click="copyPlan">
          复制设计
        </el-button>
      </div>
    </header>
    <main v-if="plan" class="discover-detail-page">
      <div class="readonly-notice"><el-icon><Lock /></el-icon> 这是公开方案，只能查看和复制，原作品不会被修改。</div>
      <section class="readonly-panel readonly-workspace">
        <div class="readonly-toolbar">
          <div class="mode-switch" role="tablist" aria-label="预览模式">
            <button :class="['mode-button', { selected: activeMode === '2d' }]" @click="activeMode = '2d'">2D 平面</button>
            <button :class="['mode-button', { selected: activeMode === '3d' }]" @click="activeMode = '3d'">3D 预览</button>
          </div>
          <span class="readonly-mode-label">{{ activeMode === '2d' ? '平面布局 · 只读' : '空间预览 · 只读' }}</span>
        </div>
        <div class="readonly-canvas" :class="{ 'is-3d': activeMode === '3d' }">
          <PlanThumbnail v-if="activeMode === '2d'" :id="plan.id" :name="plan.name" :document="plan.documentJson" />
          <ThreePreview v-else :document="plan.documentJson" />
        </div>
      </section>
      <div class="readonly-summary">{{ plan.documentJson.walls.length }} 面墙 · {{ plan.documentJson.openings.length }} 个门窗 · {{ plan.documentJson.rooms.length }} 个房间 · {{ plan.documentJson.furniture.length }} 件家具</div>
    </main>
  </div>
</template>
