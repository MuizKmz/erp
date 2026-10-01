import { createRouter, createWebHistory } from 'vue-router'
import { purchaseRoutes } from '@/modules/purchase/router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'launcher',
      component: () => import('@/modules/launcher/LauncherView.vue'),
      meta: { code: '00', title: 'Choose a module', layout: 'bare', mockup: 'Launcher.html' },
    },
    ...purchaseRoutes,
    {
      path: '/sales/:pathMatch(.*)*',
      name: 'sales',
      component: () => import('@/modules/common/ComingLaterView.vue'),
      meta: { title: 'Sales', layout: 'bare', module: 'sales' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/modules/common/NotFoundView.vue'),
      meta: { title: 'Page not found', layout: 'bare' },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Zora Pro ERP` : 'Zora Pro ERP'
})

export default router
