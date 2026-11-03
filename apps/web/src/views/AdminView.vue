<script setup lang="ts">
import { ArrowLeft, DataAnalysis, Document, Refresh, Search, Share, Star, SwitchButton, UserFilled, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import { getAdminOverview, listAdminUsers, toggleAdminUserStatus } from '../api/admin'
import type { AdminOverview, AdminUser } from '../types/api'

const router = useRouter()
const loading = ref(true)
const usersLoading = ref(false)
const overview = ref<AdminOverview | null>(null)
const users = ref<AdminUser[]>([])
const keyword = ref('')
const statusFilter = ref<'all' | 'active' | 'disabled'>('all')

const activeUsers = computed(() => users.value.filter((user) => user.status === 'active').length)
const disabledUsers = computed(() => users.value.filter((user) => user.status === 'disabled').length)
const adminUsers = computed(() => users.value.filter((user) => user.role === 'admin').length)
const filteredUsers = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return users.value.filter((user) => {
    const matchesStatus = statusFilter.value === 'all' || user.status === statusFilter.value
    const matchesKeyword = !query || [user.username, user.nickname, user.email].some((value) => value.toLowerCase().includes(query))
    return matchesStatus && matchesKeyword
  })
})

async function load() {
  loading.value = true
  try {
    overview.value = await getAdminOverview()
    users.value = await listAdminUsers()
  } finally {
    loading.value = false
  }
}

async function refreshUsers() {
  usersLoading.value = true
  try {
    users.value = await listAdminUsers()
    ElMessage.success('用户列表已刷新')
  } finally {
    usersLoading.value = false
  }
}

async function toggleStatus(user: AdminUser) {
  const result = await toggleAdminUserStatus(user.id)
  user.status = result.status
  ElMessage.success(result.status === 'active' ? '用户已启用' : '用户已停用')
}

function goTo(section: 'overview' | 'users') {
  document.getElementById(`admin-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <AppHeader />
    <main class="admin-page">
      <aside class="admin-sidebar">
        <div class="admin-sidebar-brand"><span class="admin-brand-mark"><el-icon><DataAnalysis /></el-icon></span><div><strong>管理后台</strong><small>筑境设计平台</small></div></div>
        <nav class="admin-nav" aria-label="后台导航">
          <button type="button" class="admin-nav-item is-active" @click="goTo('overview')"><span class="admin-nav-icon"><el-icon><DataAnalysis /></el-icon></span>平台概览</button>
          <button type="button" class="admin-nav-item" @click="goTo('users')"><span class="admin-nav-icon"><el-icon><UserFilled /></el-icon></span>用户管理</button>
        </nav>
        <div class="admin-sidebar-footer">
          <div class="admin-sidebar-user"><span class="admin-sidebar-user-icon"><el-icon><UserFilled /></el-icon></span><div><strong>{{ overview?.recentUsers.find((user) => user.role === 'admin')?.nickname || '管理员' }}</strong><small>管理员账户</small></div></div>
          <el-button text :icon="ArrowLeft" @click="router.push({ name: 'plans' })">返回工作台</el-button>
        </div>
      </aside>

      <div class="admin-main">
        <header class="admin-heading">
          <div><p class="eyebrow">平台管理</p><h1>你好，管理员</h1><p>这里可以快速了解平台状态，并管理用户账户。</p></div>
          <el-button plain :icon="Refresh" :loading="loading" @click="load">刷新数据</el-button>
        </header>

        <div v-loading="loading" class="admin-content">
          <section id="admin-overview" class="admin-section-block">
            <div class="admin-section-title"><div><h2>平台概览</h2><p>当前平台的核心数据</p></div><span class="admin-status-pill"><i />运行正常</span></div>
            <div class="admin-stat-grid">
              <section class="admin-stat-card"><span class="admin-stat-icon"><el-icon><UserFilled /></el-icon></span><div><small>注册用户</small><strong>{{ overview?.userCount ?? 0 }}</strong><p>{{ activeUsers }} 个正常账户</p></div></section>
              <section class="admin-stat-card"><span class="admin-stat-icon"><el-icon><Document /></el-icon></span><div><small>设计方案</small><strong>{{ overview?.planCount ?? 0 }}</strong><p>用户创建的方案</p></div></section>
              <section class="admin-stat-card"><span class="admin-stat-icon"><el-icon><Share /></el-icon></span><div><small>公开方案</small><strong>{{ overview?.publicPlanCount ?? 0 }}</strong><p>正在发现页展示</p></div></section>
              <section class="admin-stat-card"><span class="admin-stat-icon admin-stat-icon-warm"><el-icon><Star /></el-icon></span><div><small>获得点赞</small><strong>{{ overview?.likeCount ?? 0 }}</strong><p>公开方案累计点赞</p></div></section>
            </div>
            <div class="admin-overview-grid">
              <section class="admin-panel admin-recent-panel">
                <div class="admin-panel-heading"><div><h2>最近注册</h2><p>最近加入平台的用户</p></div><el-button text @click="goTo('users')">查看全部</el-button></div>
                <div v-if="overview?.recentUsers.length" class="admin-recent-list">
                  <div v-for="user in overview.recentUsers.slice(0, 5)" :key="user.id" class="admin-recent-row"><span class="admin-avatar"><el-icon><UserFilled /></el-icon></span><div><strong>{{ user.nickname || user.username }}</strong><small>{{ user.email }}</small></div><el-tag size="small" :type="user.status === 'active' ? 'success' : 'danger'">{{ user.status === 'active' ? '正常' : '已停用' }}</el-tag></div>
                </div>
                <el-empty v-else description="暂无用户" :image-size="56" />
              </section>
              <section class="admin-panel admin-health-panel"><div class="admin-panel-heading"><div><h2>账户状态</h2><p>用户账户分布</p></div><Warning /></div><div class="admin-health-row"><span>正常用户</span><strong>{{ activeUsers }}</strong></div><div class="admin-health-bar"><i :style="{ width: `${users.length ? (activeUsers / users.length) * 100 : 0}%` }" /></div><div class="admin-health-row"><span>已停用用户</span><strong>{{ disabledUsers }}</strong></div><div class="admin-health-row"><span>管理员</span><strong>{{ adminUsers }}</strong></div></section>
            </div>
            <section class="admin-panel admin-popular-panel">
              <div class="admin-panel-heading"><div><h2>热门公开方案</h2><p>按点赞数排序的公开作品</p></div><span class="admin-rank-label">前 5 名</span></div>
              <div v-if="overview?.popularPlans.length" class="admin-popular-list">
                <div v-for="(plan, index) in overview.popularPlans" :key="plan.id" class="admin-popular-row"><span class="admin-rank-number">{{ index + 1 }}</span><div><strong>{{ plan.name }}</strong><small>作者 · {{ plan.nickname || plan.username }}</small></div><span class="admin-like-count"><Star /> {{ plan.likeCount }}</span></div>
              </div>
              <el-empty v-else description="还没有公开方案获得点赞" :image-size="56" />
            </section>
          </section>

          <section id="admin-users" class="admin-panel admin-users-panel">
          <div class="admin-panel-heading"><div><h2>用户管理</h2><p>启用或停用普通用户，管理员账户不会被误操作。</p></div><el-button text :icon="Refresh" :loading="usersLoading" @click="refreshUsers">刷新列表</el-button></div>
          <div class="admin-table-toolbar"><el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜索用户名、昵称或邮箱" /><el-select v-model="statusFilter" aria-label="筛选用户状态"><el-option label="全部状态" value="all" /><el-option label="正常用户" value="active" /><el-option label="已停用" value="disabled" /></el-select><span>共 {{ filteredUsers.length }} 位用户</span></div>
          <el-table :data="filteredUsers" stripe>
            <el-table-column label="用户" min-width="190">
              <template #default="scope"><div class="admin-user-cell"><el-icon><UserFilled /></el-icon><div><strong>{{ scope.row.nickname || scope.row.username }}</strong><small>@{{ scope.row.username }}</small></div></div></template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" min-width="210" />
            <el-table-column label="角色" width="100"><template #default="scope"><el-tag :type="scope.row.role === 'admin' ? 'warning' : 'info'">{{ scope.row.role === 'admin' ? '管理员' : '用户' }}</el-tag></template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="scope.row.status === 'active' ? 'success' : 'danger'">{{ scope.row.status === 'active' ? '正常' : '已停用' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button v-if="scope.row.role !== 'admin'" text :icon="SwitchButton" @click="toggleStatus(scope.row)">{{ scope.row.status === 'active' ? '停用用户' : '启用用户' }}</el-button><span v-else class="admin-muted">系统账号</span></template></el-table-column>
          </el-table>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>
