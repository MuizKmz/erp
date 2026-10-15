import { createRouter, createWebHistory } from 'vue-router'
import { purchaseRoutes } from '@/modules/purchase/router'
import { salesRoutes } from '@/modules/sales/router'
import { coreRoutes } from '@/modules/core/router'
import { configRoutes } from '@/modules/configuration/router'

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
    ...salesRoutes,
    ...coreRoutes,
    ...configRoutes,
    {
      path: '/sign-in',
      name: 'sign-in',
      component: () => import('@/modules/auth/views/SignInView.vue'),
      meta: { code: 'A02', title: 'Sign in', layout: 'bare', public: true, mockup: 'CfgSignIn.html' },
    },
    {
      path: '/sign-in/forgot',
      name: 'sign-in-forgot',
      component: () => import('@/modules/auth/views/ForgotPasswordView.vue'),
      meta: { title: 'Forgot password', layout: 'bare', public: true },
    },
    {
      path: '/sign-in/two-factor',
      name: 'sign-in-two-factor',
      component: () => import('@/modules/auth/views/TwoFactorView.vue'),
      meta: { code: 'A03', title: 'Two-factor sign-in', layout: 'bare', public: true, mockup: 'CfgTwoFactor.html' },
    },
    {
      path: '/sign-in/reset',
      name: 'sign-in-reset',
      component: () => import('@/modules/auth/views/ResetPasswordView.vue'),
      meta: { title: 'Password link', layout: 'bare', public: true },
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
