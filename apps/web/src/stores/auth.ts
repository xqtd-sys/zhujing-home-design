import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '../api/auth'
import type { AuthSession, User } from '../types/api'

function loadUser(): User | null {
  const stored = sessionStorage.getItem('currentUser')
  if (!stored) return null
  try {
    return JSON.parse(stored) as User
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(loadUser())
  const isAuthenticated = computed(() => Boolean(sessionStorage.getItem('accessToken')))
  function applyUser(nextUser: User) {
    sessionStorage.setItem('currentUser', JSON.stringify(nextUser))
    user.value = nextUser
  }
  function applySession(session: AuthSession) {
    sessionStorage.setItem('accessToken', session.accessToken)
    applyUser(session.user)
  }
  async function login(identity: string, password: string) {
    applySession(await authApi.login(identity, password))
  }
  async function register(username: string, email: string, password: string) {
    applySession(await authApi.register(username, email, password))
  }
  async function updateProfile(nickname: string, email: string) {
    applyUser(await authApi.updateProfile(nickname, email))
  }
  async function refresh() {
    const currentUser = await authApi.getCurrentUser()
    applyUser(currentUser)
    return currentUser
  }
  function logout() {
    sessionStorage.removeItem('accessToken')
    sessionStorage.removeItem('currentUser')
    user.value = null
  }
  return { user, isAuthenticated, login, register, updateProfile, refresh, logout }
})
