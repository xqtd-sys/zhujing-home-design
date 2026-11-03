<script setup lang="ts">
import { ArrowLeft, Check, Lock, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { changePassword } from '../api/auth'
import AppHeader from '../components/AppHeader.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const savingProfile = ref(false)
const savingPassword = ref(false)
const loadingProfile = ref(true)
const profileForm = reactive({
  nickname: auth.user?.nickname ?? '',
  email: auth.user?.email ?? '',
})
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const canSaveProfile = computed(() => profileForm.nickname.trim().length > 0 && profileForm.email.trim().includes('@'))
const canSavePassword = computed(
  () =>
    passwordForm.currentPassword.length >= 8 &&
    passwordForm.newPassword.length >= 8 &&
    passwordForm.newPassword === passwordForm.confirmPassword,
)

async function loadProfile() {
  loadingProfile.value = true
  try {
    const user = await auth.refresh()
    profileForm.nickname = user.nickname
    profileForm.email = user.email
  } finally {
    loadingProfile.value = false
  }
}

async function saveProfile() {
  if (!canSaveProfile.value) return
  savingProfile.value = true
  try {
    await auth.updateProfile(profileForm.nickname.trim(), profileForm.email.trim())
    profileForm.nickname = auth.user?.nickname ?? ''
    profileForm.email = auth.user?.email ?? ''
    ElMessage.success('个人资料已更新')
  } finally {
    savingProfile.value = false
  }
}

async function savePassword() {
  if (!canSavePassword.value) return
  savingPassword.value = true
  try {
    await changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    ElMessage.success('密码已更新，请重新登录')
    auth.logout()
    await router.replace({ name: 'login' })
  } finally {
    savingPassword.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <div class="app-page">
    <AppHeader />
    <main class="profile-page">
      <header class="profile-heading">
        <div class="profile-heading-nav">
          <el-button text :icon="ArrowLeft" class="page-back-button" @click="router.push({ name: 'plans' })">返回工作台</el-button>
        </div>
        <div class="profile-heading-main">
          <div>
            <p class="eyebrow">账户设置</p>
            <h1>账户设置</h1>
            <p class="profile-heading-subtitle">管理你的个人资料与账户安全</p>
          </div>
          <div class="profile-user-tag">
            <el-icon><User /></el-icon>
            <span>{{ auth.user?.username }}</span>
          </div>
        </div>
      </header>
      <div v-loading="loadingProfile" class="account-layout">
        <section class="account-section">
          <h2>
            <el-icon><User /></el-icon>个人资料
          </h2>
          <el-form label-position="top" @submit.prevent="saveProfile">
            <el-form-item label="用户名">
              <el-input :model-value="auth.user?.username" disabled />
            </el-form-item>
            <el-form-item label="昵称">
              <el-input v-model="profileForm.nickname" maxlength="64" autocomplete="name" />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="profileForm.email" maxlength="191" type="email" autocomplete="email" />
            </el-form-item>
            <el-button
              type="primary"
              :icon="Check"
              :loading="savingProfile"
              :disabled="!canSaveProfile"
              @click="saveProfile"
            >
              保存资料
            </el-button>
          </el-form>
        </section>
        <section class="account-section">
          <h2>
            <el-icon><Lock /></el-icon>修改密码
          </h2>
          <el-form label-position="top" @submit.prevent="savePassword">
            <el-form-item label="当前密码">
              <el-input
                v-model="passwordForm.currentPassword"
                type="password"
                show-password
                autocomplete="current-password"
              />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" />
            </el-form-item>
            <el-form-item label="确认新密码">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
              />
            </el-form-item>
            <el-button
              type="primary"
              :icon="Lock"
              :loading="savingPassword"
              :disabled="!canSavePassword"
              @click="savePassword"
            >
              更新密码
            </el-button>
          </el-form>
        </section>
      </div>
    </main>
  </div>
</template>
