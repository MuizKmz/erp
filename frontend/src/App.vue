<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from 'primevue/confirmdialog'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import { onApiError } from '@/api/http'
import ModuleHomeLayout from '@/components/erp/ModuleHomeLayout.vue'
import ModuleLayout from '@/components/erp/ModuleLayout.vue'
import { useSession } from '@/composables/useSession'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const session = useSession()

// Every API error becomes a toast unless the caller asked for silence (validation errors also show inline).
onApiError((error) => {
  toast.add({ severity: 'error', summary: error.status === 409 ? 'Not allowed' : 'Something went wrong', detail: error.message, life: 6000 })
})

onMounted(() => void session.start())

// Sign-in mode: nobody signed in on this device → the sign-in page, coming back to where they were; signed in → away from it.
watch(
  () => [session.state.ready, session.state.signedOut, route.fullPath] as const,
  async ([ready, signedOut]) => {
    if (!ready || session.state.mode !== 'jwt') return
    await router.isReady() // the first URL, not the router's starting '/'
    if (signedOut && !route.meta.public) void router.replace({ path: '/sign-in', query: route.path === '/' ? {} : { next: route.fullPath } })
    else if (!signedOut && route.path === '/sign-in') void router.replace(typeof route.query.next === 'string' ? route.query.next : '/')
  },
)
const showPage = computed(() => !(session.state.mode === 'jwt' && session.state.signedOut && !route.meta.public))

const layout = computed(() => {
  if (route.meta.layout === 'module') return ModuleLayout
  if (route.meta.layout === 'module-home') return ModuleHomeLayout
  return null
})

// Re-mount the page when the dev user changes, so it loads data as the new user.
const pageKey = computed(() => `${session.state.version}:${route.path}`)
</script>

<template>
  <Toast position="top-right" />
  <ConfirmDialog class="erp-dialog" :style="{ width: '460px' }" />

  <div v-if="session.state.error" class="flex min-h-screen items-center justify-center bg-erp-bg p-8">
    <div class="erp-card flex max-w-md flex-col items-center gap-3 px-8 py-10 text-center">
      <h1 class="m-0 text-lg font-bold">Zora Pro ERP cannot start</h1>
      <p class="m-0 text-[13px] text-erp-muted">{{ session.state.error }}</p>
      <button type="button" class="erp-btn erp-btn-secondary" @click="session.start()">Try again</button>
    </div>
  </div>

  <div v-else-if="!session.state.ready" class="flex min-h-screen items-center justify-center bg-erp-bg text-[13px] text-erp-muted">
    Loading…
  </div>

  <template v-else-if="showPage">
    <component :is="layout" v-if="layout">
      <RouterView :key="pageKey" />
    </component>
    <RouterView v-else :key="pageKey" />
  </template>
</template>
