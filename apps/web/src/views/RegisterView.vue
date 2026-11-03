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
const form = reactive({ username: '', email: '', password: '', confirmPassword: '' })
const rules: FormRules<typeof form> = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 32, message: '用户名需为 3-32 个字符', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_]+$/,
      message: '用户名只能包含英文字母、数字和下划线',
      trigger: 'blur',
    },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' },
    { max: 191, message: '邮箱不能超过 191 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码需为 8-64 个字符', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.password) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.register(form.username.trim(), form.email.trim(), form.password)
    await router.push({ name: 'plans' })
  } catch {
    // The API interceptor already shows the server error to the user.
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="auth-brand">
      <div>
        <h1>创建账户</h1>
        <p>开始创建你的第一个空间</p>
      </div>
    </div>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item label="用户名" prop="username"
        ><el-input
          v-model="form.username"
          maxlength="32"
          autocomplete="username"
          placeholder="3–32 位字母、数字或下划线"
      /></el-form-item>
      <el-form-item label="邮箱" prop="email"
        ><el-input v-model="form.email" maxlength="191" autocomplete="email" placeholder="name@example.com"
      /></el-form-item>
      <el-form-item label="密码" prop="password"
        ><el-input
          v-model="form.password"
          type="password"
          maxlength="64"
          show-password
          autocomplete="new-password"
          placeholder="设置 8–64 位密码"
      /></el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword"
        ><el-input
          v-model="form.confirmPassword"
          type="password"
          maxlength="64"
          show-password
          autocomplete="new-password"
          placeholder="再次输入密码"
      /></el-form-item>
      <el-button class="full-button" type="primary" :loading="loading" native-type="submit">注册</el-button>
    </el-form>
    <p class="auth-switch">已有账户？<router-link to="/login">直接登录</router-link></p>
  </AuthLayout>
</template>
