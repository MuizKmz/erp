<script setup lang="ts">
import BrandMark from '@/components/erp/BrandMark.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Lock } from '@lucide/vue'
import AccountMenu from '@/components/erp/AccountMenu.vue'
import { roleLabel, useSession } from '@/composables/useSession'
import { blockedName, requiredPermission } from './access'

/**
 * Shown in place of a page the person's roles do not open: a module they have no view permission for, or a page that
 * needs more (the audit trail). The address stays, so they can send it to their administrator. Switching user here
 * (dev mode) re-checks at once.
 */
const route = useRoute()
const { state, user, isJwt } = useSession()

const name = computed(() => blockedName(route))
const permission = computed(() => {
  const key = requiredPermission(route) ?? ''
  return state.me?.permissionLabels?.[key] ?? key
})
const roles = computed(() => (user.value?.roles ?? []).map(roleLabel).join(', '))
</script>

<template>
  <div class="flex min-h-screen flex-col bg-erp-bg">
    <div class="sticky top-0 z-20 px-4 pt-3 pb-2 md:px-6">
      <header class="flex h-14 items-center justify-between gap-4 rounded-2xl border border-erp-border bg-erp-card/95 px-4 shadow-sm md:px-5">
        <RouterLink to="/" class="flex min-w-0 items-center gap-3 text-erp-text no-underline">
          <BrandMark :size="38" />
          <div class="truncate text-[15px] font-bold">Zora <span class="text-erp-link">Pro</span> ERP</div>
        </RouterLink>
        <AccountMenu variant="launcher" />
      </header>
    </div>

    <main class="flex grow items-center justify-center px-4 pb-16">
      <section class="erp-card flex max-w-[480px] flex-col items-center gap-3 px-8 py-10 text-center" aria-labelledby="no-access-title">
        <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-erp-track text-erp-subtle">
          <Lock :size="22" aria-hidden="true" />
        </span>
        <h1 id="no-access-title" class="m-0 text-xl font-bold">You can't open {{ name }}</h1>
        <p class="m-0 text-[13px] leading-relaxed text-erp-muted">
          {{ name }} isn't part of your role<template v-if="roles"> ({{ roles }})</template>. If you need it, ask your administrator for
          <strong class="text-erp-text">{{ permission }}</strong>.
        </p>
        <p v-if="!isJwt" class="m-0 text-xs text-erp-muted">Testing? Switch to another person with the menu at the top right.</p>
        <RouterLink to="/" class="erp-btn erp-btn-primary mt-2">‹ Back to all modules</RouterLink>
      </section>
    </main>
  </div>
</template>
