import { ref } from 'vue'

export type ThemeMode = 'night' | 'day'

const STORAGE_KEY = 'zhu-theme'

/**
 * 全局昼夜主题。
 *
 * 主题写在 <html data-theme="day"> 上，整套项目（工作台 / 编辑器 / 登录 / 发现 /
 * 个人中心 / 后台）共用同一份状态；默认夜间（没有 data-theme 属性）。
 *
 * 注意：这里是模块级单例，不要加 onBeforeUnmount 清理 —— 一旦某个页面卸载就
 * 摘掉属性，会把其它页面的主题一起弄丢。
 */

const mode = ref<ThemeMode>('night')
const listeners = new Set<(mode: ThemeMode) => void>()

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'day' || stored === 'night') return stored
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
  return 'night'
}

function syncDocument(next: ThemeMode) {
  if (next === 'day') document.documentElement.setAttribute('data-theme', 'day')
  else document.documentElement.removeAttribute('data-theme')
}

function apply(next: ThemeMode) {
  mode.value = next
  syncDocument(next)

  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存不进去也不影响本次浏览
  }

  listeners.forEach((listener) => listener(next))
}

function toggle() {
  apply(mode.value === 'day' ? 'night' : 'day')
}

/** 订阅主题变化，返回取消订阅函数。着色器 / 图表用它来换色调。 */
function onChange(listener: (mode: ThemeMode) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 模块加载时立即应用一次，避免首帧配色和文案不一致。
mode.value = readStoredTheme()
syncDocument(mode.value)

export function useThemeMode() {
  return { mode, toggle, apply, onChange }
}