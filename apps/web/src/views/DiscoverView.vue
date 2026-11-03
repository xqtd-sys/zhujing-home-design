<script setup lang="ts">
import { ArrowLeft, Search, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listDiscoverPlans, toggleDiscoverLike } from '../api/discover'
import AppHeader from '../components/AppHeader.vue'
import PlanThumbnail from '../components/PlanThumbnail.vue'
import type { DiscoverPlanSummary } from '../types/api'

const router = useRouter()
const loading = ref(true)
const plans = ref<DiscoverPlanSummary[]>([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const sort = ref<'latest' | 'likes'>('latest')

async function load() {
  loading.value = true
  try {
    const result = await listDiscoverPlans(page.value, 12, keyword.value, sort.value)
    plans.value = result.items
    total.value = result.total
  } catch {
    ElMessage.error('发现内容加载失败')
  } finally {
    loading.value = false
  }
}

async function toggleLike(plan: DiscoverPlanSummary) {
  const result = await toggleDiscoverLike(plan.id)
  plan.liked = result.liked
  plan.likeCount = result.likeCount
}

function search() {
  page.value = 1
  void load()
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <AppHeader />
    <main class="discover-page">
      <el-button text :icon="ArrowLeft" class="page-back-button" @click="router.push({ name: 'plans' })">返回工作台</el-button>
      <section class="discover-hero">
        <div>
          <p class="eyebrow">公开发现</p>
          <h1>看看别人如何把空间，<br />变成喜欢的样子。</h1>
          <p>只读浏览公开设计，遇到喜欢的方案，可以复制到自己的工作台继续创作。</p>
        </div>
      </section>
      <div class="discover-toolbar">
        <div>
          <h2>公开作品 <span class="count-badge">{{ total }}</span></h2>
          <p>来自筑境用户的空间灵感</p>
        </div>
        <div class="discover-toolbar-actions">
          <el-radio-group v-model="sort" size="small" @change="search">
            <el-radio-button label="latest">最新发布</el-radio-button>
            <el-radio-button label="likes">最多点赞</el-radio-button>
          </el-radio-group>
          <el-input v-model="keyword" clearable placeholder="搜索方案名称" class="discover-search" @keyup.enter="search">
            <template #append><el-button :icon="Search" aria-label="搜索" @click="search" /></template>
          </el-input>
        </div>
      </div>
      <div v-loading="loading" class="discover-content">
        <div v-if="!loading && plans.length === 0" class="studio-empty">
          <el-icon :size="42"><View /></el-icon>
          <h3>还没有公开作品</h3>
          <p>你可以在“我的设计”中公开一个方案，让更多人看到。</p>
        </div>
        <div v-else class="plan-grid">
          <article
            v-for="plan in plans"
            :key="plan.id"
            class="plan-card discover-card"
            tabindex="0"
            @keydown.enter.self="router.push({ name: 'discover-detail', params: { id: plan.id } })"
            @click="router.push({ name: 'discover-detail', params: { id: plan.id } })"
          >
            <PlanThumbnail :id="plan.id" :name="plan.name" source="discover" />
            <div class="plan-info">
              <div>
                <h2>{{ plan.name }}</h2>
                <p>作者 · {{ plan.author.nickname || plan.author.username }}</p>
              </div>
            </div>
                <div class="plan-meta"><el-button text size="small" class="discover-like-button" :class="{ liked: plan.liked }" @click.stop="toggleLike(plan)">♡ {{ plan.likeCount }}</el-button><span>只读查看 ↗</span></div>
          </article>
        </div>
      </div>
      <el-pagination
        v-if="total > 12"
        v-model:current-page="page"
        :total="total"
        :page-size="12"
        layout="prev, pager, next"
        class="plans-pagination"
        @current-change="load"
      />
    </main>
  </div>
</template>
