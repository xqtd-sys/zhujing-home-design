import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 启动第一屏直接进入可用的工作区，不把 demo 页或营销页当首页。
    { path: '/', redirect: '/plans' },
    // 这套昼夜样式的原始样张，保留成可访问的风格参考页，不再占启动入口。
    { path: '/style-demo', name: 'style-demo', component: () => import('../views/HomeView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { guest: true } },
    {
      path: '/register',
      name: 'register',
      component: () => import('../views/RegisterView.vue'),
      meta: { guest: true },
    },
    { path: '/plans', name: 'plans', component: () => import('../views/PlansView.vue'), meta: { auth: true } },
    { path: '/plans/all', name: 'plans-all', component: () => import('../views/PlansView.vue'), meta: { auth: true } },
    { path: '/discover', name: 'discover', component: () => import('../views/DiscoverView.vue'), meta: { auth: true } },
    {
      path: '/discover/:id',
      name: 'discover-detail',
      component: () => import('../views/DiscoverDetailView.vue'),
      meta: { auth: true },
    },
    { path: '/profile', name: 'profile', component: () => import('../views/ProfileView.vue'), meta: { auth: true } },
    { path: '/admin', name: 'admin', component: () => import('../views/AdminView.vue'), meta: { auth: true, admin: true } },
    { path: '/plans/:id', name: 'editor', component: () => import('../views/EditorView.vue'), meta: { auth: true } },
  ],
})
router.beforeEach((to) => {
  const authenticated = Boolean(sessionStorage.getItem('accessToken'))
  if (to.meta.auth && !authenticated) return { name: 'login' }
  if (to.meta.admin) {
    try {
      const user = JSON.parse(sessionStorage.getItem('currentUser') ?? 'null') as { role?: string } | null
      if (user?.role !== 'admin') return { name: 'plans' }
    } catch {
      return { name: 'plans' }
    }
  }
  if (to.meta.guest && authenticated) return { name: 'plans' }
  return true
})
export default router
