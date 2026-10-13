<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Bell, LogOut } from '@lucide/vue'
import { useApprovalsCount } from '@/composables/useApprovalsCount'
import { useSession } from '@/composables/useSession'
import { moduleDef } from '@/modules/registry'
import { formatLongDate } from '@/utils/format'
import DevUserSwitcher from './DevUserSwitcher.vue'

/** The module home frame: white header, content, footer (PurHome.html). No sidebar here. */
const route = useRoute()
const { state, today } = useSession()
const module = computed(() => moduleDef(route.meta.module))
const { count: approvals } = useApprovalsCount(() => module.value)
const year = computed(() => (today.value ? today.value.slice(0, 4) : ''))
</script>

<template>
  <div :data-module="module.key" class="flex min-h-screen flex-col bg-erp-bg">
    <header class="flex h-16 shrink-0 items-center justify-between border-b border-erp-border bg-erp-card px-8">
      <div class="flex items-center gap-3">
        <div class="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-brand-dark text-base font-extrabold text-erp-on-dark">Z</div>
        <div class="text-lg font-bold">Zora <span class="text-erp-link">Pro</span> ERP</div>
        <span class="inline-block rounded-xl bg-mod-chip-bg px-2.5 py-[3px] text-xs font-semibold text-mod-chip-text">{{ module.label }} module</span>
        <RouterLink to="/" class="erp-link pl-2 text-[13px] font-semibold">‹ All modules</RouterLink>
      </div>
      <div class="flex items-center gap-5">
        <RouterLink
          v-if="module.approvalsTo"
          :to="module.approvalsTo"
          :aria-label="`Approvals, ${approvals ?? 0} waiting`"
          class="flex items-center gap-1.5 text-[13px] font-semibold text-mod-chip-text"
        >
          <Bell :size="18" aria-hidden="true" />Approvals
          <span v-if="approvals" class="rounded-[10px] bg-mod-side px-[7px] py-px text-[11px] font-bold text-erp-on-dark">{{ approvals }}</span>
        </RouterLink>
        <DevUserSwitcher variant="home" :subtitle="today ? formatLongDate(today) : ''" />
        <RouterLink
          to="/"
          aria-label="Sign out"
          title="Sign out"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-erp-input bg-erp-card text-erp-muted"
        >
          <LogOut :size="16" class="rotate-180" aria-hidden="true" />
        </RouterLink>
      </div>
    </header>

    <main class="flex grow flex-col gap-5 px-8 py-6">
      <slot />
    </main>

    <footer class="flex h-11 shrink-0 items-center justify-between border-t border-erp-border bg-erp-card px-8 text-xs text-erp-muted">
      <span class="font-semibold text-erp-text">Zora Pro ERP · {{ state.tenantName || 'CLB Groups' }}</span>
      <span>© {{ year }} All rights reserved.</span>
    </footer>
  </div>
</template>
