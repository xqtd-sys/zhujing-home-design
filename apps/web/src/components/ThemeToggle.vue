<script setup lang="ts">
import { Moon, Sunny } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useThemeMode } from '../composables/useThemeMode'

const { mode, toggle } = useThemeMode()
const label = computed(() => (mode.value === 'day' ? '日间' : '夜间'))
const target = computed(() => (mode.value === 'day' ? '夜间' : '日间'))
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :aria-label="`切换到${target}模式`"
    :title="`切换到${target}模式`"
    @click="toggle"
  >
    <el-icon class="ico-night"><Moon /></el-icon>
    <el-icon class="ico-day"><Sunny /></el-icon>
    <span>{{ label }}</span>
  </button>
</template>