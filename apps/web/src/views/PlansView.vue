<script setup lang="ts">
import { ArrowLeft, Delete, DocumentCopy, Plus, Share, View } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createPlan, deletePlan, importPlan, listPlans, updatePlanVisibility } from '../api/plans'
import { listDiscoverPlans } from '../api/discover'
import AppHeader from '../components/AppHeader.vue'
import PlanThumbnail from '../components/PlanThumbnail.vue'
import RoomIllustration from '../components/RoomIllustration.vue'
import type { DiscoverPlanSummary, PlanSummary } from '../types/api'
import { clearDesignClipboard, readDesignClipboard, type DesignClipboard } from '../editor/design-clipboard'

const router = useRouter()
const showAll = computed(() => router.currentRoute.value.name === 'plans-all')
const loading = ref(true)
const creating = ref(false)
const plans = ref<PlanSummary[]>([])
const total = ref(0)
const page = ref(1)
const clipboard = ref<DesignClipboard | null>(null)
const discoverPlans = ref<DiscoverPlanSummary[]>([])
const discoverTotal = ref(0)
const discoverLoading = ref(false)

async function load() {
  loading.value = true
  try {
    const result = await listPlans(page.value, showAll.value ? 12 : 8)
    plans.value = result.items
    total.value = result.total
    if (!showAll.value) {
      discoverLoading.value = true
      const discover = await listDiscoverPlans(1, 8)
      discoverPlans.value = discover.items
      discoverTotal.value = discover.total
    }
  } finally {
    loading.value = false
    discoverLoading.value = false
  }
}

async function create() {
  const result = await ElMessageBox.prompt('请输入方案名称', '新建设计', {
    inputValue: '我的新家',
    inputPattern: /\S+/,
    inputErrorMessage: '方案名称不能为空',
    confirmButtonText: '创建',
    cancelButtonText: '取消',
  }).catch(() => null)
  if (!result) return
  creating.value = true
  try {
    const plan = await createPlan(result.value.trim())
    await router.push({ name: 'editor', params: { id: plan.id } })
  } finally {
    creating.value = false
  }
}

async function remove(plan: PlanSummary) {
  const confirmed = await ElMessageBox.confirm(`确定删除“${plan.name}”吗？`, '删除方案', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  await deletePlan(plan.id)
  ElMessage.success('方案已删除')
  if (plans.value.length === 1 && page.value > 1) page.value -= 1
  await load()
}

async function toggleVisibility(plan: PlanSummary) {
  const next = !plan.isPublic
  await updatePlanVisibility(plan.id, next)
  plan.isPublic = next
  ElMessage.success(next ? '已公开到发现' : '已从发现中隐藏')
}

onMounted(load)
watch(showAll, () => {
  page.value = 1
  void load()
})
onMounted(() => {
  clipboard.value = readDesignClipboard()
})

async function pasteDesign() {
  const pending = clipboard.value ?? readDesignClipboard()
  if (!pending) {
    clipboard.value = null
    ElMessage.info('设计剪贴板为空，请先在发现中复制一个方案')
    return
  }
  const result = await ElMessageBox.prompt('请输入方案名称', '粘贴设计', {
    inputValue: `${pending.sourceName}（副本）`.slice(0, 100),
    inputPattern: /\S+/,
    inputErrorMessage: '方案名称不能为空',
    confirmButtonText: '粘贴并创建',
    cancelButtonText: '取消',
  }).catch(() => null)
  if (!result) return
  try {
    await importPlan(result.value.trim(), pending.documentJson)
    clearDesignClipboard()
    clipboard.value = null
    ElMessage.success('设计已粘贴到我的设计')
    await load()
  } catch {
    // API interceptor displays the validation error.
  }
}
</script>

<template>
  <div class="app-page">
    <AppHeader />
    <main class="plans-page">
      <section class="studio-welcome">
        <div>
          <p class="eyebrow">我的设计平台</p>
          <h1>把关于家的灵感，<br />慢慢变成生活。</h1>
          <p>从一面墙到一个家，在这里继续你的创作。</p>
        </div>
        <RoomIllustration class="welcome-scene" />
      </section>
      <template v-if="showAll">
      <el-button text :icon="ArrowLeft" class="page-back-button" @click="router.push({ name: 'plans' })">返回工作台</el-button>
      <div class="page-title-row">
        <div>
          <h2>
            我的设计 <span class="count-badge">{{ total }}</span>
          </h2>
          <p>每一个空间，都有你的想法</p>
        </div>
        <div class="plans-header-actions">
          <el-button v-if="clipboard" plain :icon="DocumentCopy" @click="pasteDesign">粘贴设计</el-button>
          <el-button type="primary" :icon="Plus" :loading="creating" @click="create">新建设计</el-button>
        </div>
      </div>
      <div v-loading="loading" class="plans-content">
        <div v-if="!loading && plans.length === 0" class="studio-empty">
          <svg viewBox="0 0 80 64" fill="none" aria-hidden="true">
            <path d="M12 10h56v44H12Zm28 0v22h28M12 38h20v16" stroke="currentColor" stroke-width="2" />
          </svg>
          <h3>你的第一个空间，从这里开始</h3>
          <p>暂无设计方案</p>
          <p>创建一张空白户型，画墙、摆放家具，再看看 3D 中的家。</p>
          <el-button type="primary" :loading="creating" @click="create">新建设计</el-button>
        </div>
        <div v-else class="plan-grid">
          <article
            v-for="plan in plans"
            :key="plan.id"
            class="plan-card"
            tabindex="0"
            @keydown.enter.self="router.push({ name: 'editor', params: { id: plan.id } })"
            @click="router.push({ name: 'editor', params: { id: plan.id } })"
          >
            <PlanThumbnail :id="plan.id" :key="`${plan.id}:${plan.revision}`" :name="plan.name" />
            <div class="plan-info">
              <div>
                <h2>{{ plan.name }}</h2>
                <p>更新于 {{ new Date(plan.updatedAt).toLocaleDateString('zh-CN') }}</p>
              </div>
              <el-button text circle :icon="Delete" aria-label="删除方案" @click.stop="remove(plan)" />
            </div>
            <div class="plan-meta">
              <el-button text size="small" :icon="Share" class="plan-visibility-button" @click.stop="toggleVisibility(plan)">
                {{ plan.isPublic ? '已公开 · 取消公开' : '公开到发现' }}
              </el-button>
              <span>继续编辑 <span aria-hidden="true">↗</span></span>
            </div>
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
      </template>
      <template v-else>
        <section class="dashboard-section">
          <div class="dashboard-section-heading">
            <div>
              <h2>我的设计 <span class="count-badge">{{ total }}</span></h2>
              <p>继续你的空间创作</p>
            </div>
            <div class="dashboard-section-actions">
              <el-button v-if="clipboard" plain :icon="DocumentCopy" @click="pasteDesign">粘贴设计</el-button>
              <el-button type="primary" :icon="Plus" :loading="creating" @click="create">新建设计</el-button>
            </div>
          </div>
          <div v-loading="loading" class="dashboard-content">
            <div v-if="!loading && plans.length === 0" class="studio-empty">
              <h3>你的第一个空间，从这里开始</h3>
              <p>暂无设计方案，先创建一张空白户型吧。</p>
              <el-button type="primary" :loading="creating" @click="create">新建设计</el-button>
            </div>
            <div v-else class="dashboard-grid">
              <article
                v-for="plan in plans.slice(0, 7)"
                :key="plan.id"
                class="plan-card"
                tabindex="0"
                @keydown.enter.self="router.push({ name: 'editor', params: { id: plan.id } })"
                @click="router.push({ name: 'editor', params: { id: plan.id } })"
              >
                <PlanThumbnail :id="plan.id" :key="`${plan.id}:${plan.revision}`" :name="plan.name" />
                <div class="plan-info"><div><h2>{{ plan.name }}</h2><p>更新于 {{ new Date(plan.updatedAt).toLocaleDateString('zh-CN') }}</p></div></div>
                <div class="plan-meta">
                  <el-button text size="small" :icon="Share" class="plan-visibility-button" @click.stop="toggleVisibility(plan)">
                    {{ plan.isPublic ? '已公开 · 取消公开' : '公开到发现' }}
                  </el-button>
                  <span>继续编辑 <span aria-hidden="true">↗</span></span>
                </div>
              </article>
              <button v-if="total >= 7" class="more-plan-tile" type="button" aria-label="查看更多我的设计" @click="router.push({ name: 'plans-all' })">
                <RoomIllustration class="more-plan-illustration" />
                <span class="more-plan-overlay" />
                <span class="more-plan-label">查看更多 <span aria-hidden="true">↗</span></span>
              </button>
            </div>
          </div>
        </section>
        <section class="dashboard-section">
          <div class="dashboard-section-heading">
            <div>
              <h2>公开发现 <span class="count-badge">{{ discoverTotal }}</span></h2>
              <p>看看别人如何把空间变成喜欢的样子</p>
            </div>
          </div>
          <div v-loading="discoverLoading" class="dashboard-content">
            <div v-if="!discoverLoading && discoverPlans.length === 0" class="studio-empty compact-empty">
              <el-icon :size="34"><View /></el-icon><p>暂时还没有公开作品</p>
            </div>
            <div v-else class="dashboard-grid">
              <article
                v-for="plan in discoverPlans.slice(0, 7)"
                :key="plan.id"
                class="plan-card discover-card"
                tabindex="0"
                @keydown.enter.self="router.push({ name: 'discover-detail', params: { id: plan.id } })"
                @click="router.push({ name: 'discover-detail', params: { id: plan.id } })"
              >
                <PlanThumbnail :id="plan.id" :name="plan.name" source="discover" />
                <div class="plan-info"><div><h2>{{ plan.name }}</h2><p>作者 · {{ plan.author.nickname || plan.author.username }}</p></div></div>
                <div class="plan-meta"><span>♡ {{ plan.likeCount }}</span><span>只读查看 ↗</span></div>
              </article>
              <button v-if="discoverTotal >= 7" class="more-plan-tile" type="button" aria-label="查看更多公开发现" @click="router.push({ name: 'discover' })">
                <RoomIllustration class="more-plan-illustration" />
                <span class="more-plan-overlay" />
                <span class="more-plan-label">查看更多 <span aria-hidden="true">↗</span></span>
              </button>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
