import axios from 'axios'
import { ElMessage } from 'element-plus'
import type { AxiosError } from 'axios'
import router from '../router'

type ApiError = AxiosError<{ message?: string }>

export const apiClient = axios.create({ baseURL: '/api/v1', timeout: 15_000 })

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

function describeError(error: ApiError) {
  if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试'
  if (!error.response) return '网络异常，无法连接到服务器'
  const status = error.response.status
  const serverMessage = error.response.data?.message
  if (status === 429) return '操作过于频繁，请稍后再试'
  if (status >= 500) {
    return serverMessage && serverMessage !== 'Internal Server Error' ? serverMessage : '服务器暂时不可用，请稍后重试'
  }
  return serverMessage ?? '请求失败，请稍后重试'
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: ApiError) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('accessToken')
      sessionStorage.removeItem('currentUser')
      if (router.currentRoute.value.name !== 'login') await router.push({ name: 'login' })
    }
    ElMessage.error(describeError(error))
    return Promise.reject(error)
  },
)
