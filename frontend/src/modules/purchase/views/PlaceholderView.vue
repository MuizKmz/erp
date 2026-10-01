<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'

/** Stand-in for Purchase screens that later build steps deliver. Says which step and which mockup. */
const route = useRoute()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const isDocument = computed(() => Boolean(route.meta.parent))

const STEP_NAMES: Record<number, string> = {
  4: 'Purchase orders and approvals',
  5: 'Demand and requests',
  6: 'RFQ',
  7: 'Goods receipt',
  8: 'Supplier invoice and three-way match',
  9: 'Fixes and small buys',
  10: 'Document flow and settings',
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-4 px-6 py-[18px]">
    <PageHeader :title="isDocument ? route.meta.title ?? '' : `List of ${route.meta.title}`" :document="isDocument">
      <template #chip>
        <span class="rounded-xl bg-mod-chip-bg px-2.5 py-[3px] text-xs font-semibold text-mod-chip-text">{{ route.meta.code }}</span>
      </template>
      <template v-if="id" #subtitle>{{ id === 'new' ? 'New document' : `Document ${id}` }}</template>
    </PageHeader>

    <NoticeBanner kind="info">
      This screen is built in <strong>step {{ route.meta.step }}</strong>
      <template v-if="route.meta.step && STEP_NAMES[route.meta.step]"> · {{ STEP_NAMES[route.meta.step] }}</template>.
      The approved design is <code>docs/design/mockups/{{ route.meta.mockup }}</code>.
    </NoticeBanner>
  </section>
</template>
