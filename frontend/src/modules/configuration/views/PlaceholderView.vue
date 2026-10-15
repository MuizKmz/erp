<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'

/** Stand-in for Configuration screens that later build steps deliver. Says which step. */
const route = useRoute()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const isRecord = computed(() => Boolean(route.meta.parent))

const STEP_NAMES: Record<number, string> = {
  2: 'Company and branches',
  3: 'Users',
  4: 'Roles and permissions',
  5: 'Sign-in',
  6: 'My account and two-factor',
  7: 'Security log, audit trail and data scopes',
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-4 px-6 py-[18px]">
    <PageHeader :title="route.meta.title ?? ''" :document="isRecord">
      <template #chip>
        <span class="rounded-xl bg-mod-chip-bg px-2.5 py-[3px] text-xs font-semibold text-mod-chip-text">{{ route.meta.code }}</span>
      </template>
      <template v-if="id" #subtitle>{{ id === 'new' ? 'New record' : `Record ${id}` }}</template>
    </PageHeader>

    <NoticeBanner kind="info">
      This screen is built in <strong>step A{{ route.meta.step }}</strong>
      <template v-if="route.meta.step && STEP_NAMES[route.meta.step]"> · {{ STEP_NAMES[route.meta.step] }}</template>.
      The approved design is <code>docs/design/mockups/{{ route.meta.mockup }}</code>. Until then, users, branches and roles stay as loaded, and the
      dev user switcher picks who you are.
    </NoticeBanner>
  </section>
</template>
