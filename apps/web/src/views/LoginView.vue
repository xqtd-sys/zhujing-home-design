<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import AuthLayout from '../components/AuthLayout.vue'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ identity: '', password: '' })
const rules: FormRules<typeof form> = {
  identity: [
    { required: true, message: '请输入用户名或邮箱', trigger: 'blur' },
    { min: 3, max: 191, message: '用户名或邮箱需为 3-191 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码需为 8-64 个字符', trigger: 'blur' },
  ],
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.login(form.identity.trim(), form.password)
    await router.push({ name: 'plans' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="auth-brand">
      <div>
        <h1>欢迎回来</h1>
        <p>登录后继续你的空间设计</p>
      </div>
    </div>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item label="用户名或邮箱" prop="identity"
        ><el-input v-model="form.identity" maxlength="191" autocomplete="username" placeholder="输入用户名或邮箱"
      /></el-form-item>
      <el-form-item label="密码" prop="password"
        ><el-input
          v-model="form.password"
          type="password"
          maxlength="64"
          show-password
          autocomplete="current-password"
          placeholder="输入你的密码"
      /></el-form-item>
      <el-button class="full-button" type="primary" :loading="loading" native-type="submit">登录</el-button>
    </el-form>
    <p class="auth-switch">还没有账户？<router-link to="/register">创建账户</router-link></p>
  </AuthLayout>
</template>
