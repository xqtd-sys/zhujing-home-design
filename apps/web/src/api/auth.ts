import { apiClient } from './client'
import type { ApiEnvelope, AuthSession, User } from '../types/api'

export async function login(identity: string, password: string) {
  const response = await apiClient.post<ApiEnvelope<AuthSession>>('/auth/login', { identity, password })
  return response.data.data
}
export async function register(username: string, email: string, password: string) {
  const response = await apiClient.post<ApiEnvelope<AuthSession>>('/auth/register', { username, email, password })
  return response.data.data
}
export async function getCurrentUser() {
  const response = await apiClient.get<ApiEnvelope<User>>('/users/me')
  return response.data.data
}
export async function updateProfile(nickname: string, email: string) {
  const response = await apiClient.patch<ApiEnvelope<User>>('/users/me', { nickname, email })
  return response.data.data
}
export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await apiClient.patch<ApiEnvelope<{ updated: true }>>('/users/me/password', {
    currentPassword,
    newPassword,
  })
  return response.data.data
}
