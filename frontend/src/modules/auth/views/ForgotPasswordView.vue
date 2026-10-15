<script setup lang="ts">
import { computed } from 'vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'

/** Forgot password: the single-use reset link by email comes in step A6. Until then an administrator helps. */
const session = useSession()
const tenantName = computed(() => session.state.tenantName || 'CLB Groups')
</script>

<template>
  <div data-module="config" class="flex min-h-screen flex-col bg-launcher-bg">
    <header class="flex h-14 shrink-0 items-center gap-3 bg-launcher-bar px-7">
      <div class="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-erp-card text-[15px] font-extrabold text-launcher-bar">Z</div>
      <div class="text-base font-bold text-erp-on-dark">Zora Pro ERP</div>
    </header>
    <main class="flex grow justify-center px-4 pt-[72px]">
      <section class="erp-card flex h-fit w-full max-w-[398px] flex-col gap-4 px-8 py-7">
        <div>
          <h1 class="m-0 text-xl font-bold">Forgot password</h1>
          <p class="mt-1 mb-0 text-[13px] text-erp-muted">{{ tenantName }} · Zora Pro ERP</p>
        </div>
        <NoticeBanner kind="info">A single-use reset link by email comes in step A6. Until then, ask an administrator.</NoticeBanner>
        <RouterLink to="/sign-in" class="erp-link text-[13px] font-semibold">‹ Back to sign in</RouterLink>
      </section>
    </main>
  </div>
</template>
