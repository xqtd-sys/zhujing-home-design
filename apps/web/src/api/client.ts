import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '../router'

export const apiClient = axios.create({ baseURL: '/api/v1', timeout: 15_000 })

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('accessToken')
      sessionStorage.removeItem('currentUser')
      if (router.currentRoute.value.name !== 'login') await router.push({ name: 'login' })
    }
    ElMessage.error(error.response?.data?.message ?? '请求失败，请稍后重试')
    return Promise.reject(error)
  },
)
