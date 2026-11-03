<script setup lang="ts">
import { DataBoard, SwitchButton, User } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import BrandMark from './BrandMark.vue'

const auth = useAuthStore()
const router = useRouter()

function logout() {
  auth.logout()
  void router.push({ name: 'login' })
}
</script>

<template>
  <header class="topbar">
    <button class="brand-button" type="button" @click="router.push({ name: 'plans' })">
      <BrandMark />
      <span class="brand-copy"><strong>筑境设计平台</strong><small>让家的想象，成为眼前的空间</small></span>
    </button>
    <div class="topbar-actions">
      <el-button v-if="auth.user?.role === 'admin'" text :icon="DataBoard" @click="router.push({ name: 'admin' })">管理后台</el-button>
      <el-button
        class="account-button"
        aria-label="账户设置"
        text
        :icon="User"
        @click="router.push({ name: 'profile' })"
      >
        <span class="account-name">{{ auth.user?.nickname ?? auth.user?.username }}</span>
      </el-button>
      <el-button plain :icon="SwitchButton" @click="logout">退出</el-button>
    </div>
  </header>
</template>
