<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'

/** Stand-in for Sales screens that later build steps deliver. Says which step and which mockup. */
const route = useRoute()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const isDocument = computed(() => Boolean(route.meta.parent))
const isList = computed(() => !isDocument.value && route.meta.menuGroup !== 'policies' && route.meta.menuGroup !== 'reports' && route.meta.code !== 'S02')
const isLaterReport = computed(() => route.meta.menuGroup === 'reports' && route.meta.title !== 'Sales by customer')

const STEP_NAMES: Record<number, string> = {
  3: 'Sales orders, credit check and approvals',
  4: 'Enquiry and quotation',
  5: 'Delivery',
  6: 'Invoices',
  7: 'Proforma',
  8: 'Fixes and counter',
  9: 'Flow, settings and report',
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-4 px-6 py-[18px]">
    <PageHeader :title="isList ? `List of ${route.meta.title}` : (route.meta.title ?? '')" :document="isDocument">
      <template #chip>
        <span class="rounded-xl bg-mod-chip-bg px-2.5 py-[3px] text-xs font-semibold text-mod-chip-text">{{ route.meta.code }}</span>
      </template>
      <template v-if="id" #subtitle>{{ id === 'new' ? 'New document' : `Document ${id}` }}</template>
    </PageHeader>

    <NoticeBanner v-if="isLaterReport" kind="info">
      Only <strong>Sales by customer</strong> is planned in this phase. This report comes later.
    </NoticeBanner>
    <NoticeBanner v-else kind="info">
      This screen is built in <strong>step S{{ route.meta.step }}</strong>
      <template v-if="route.meta.step && STEP_NAMES[route.meta.step]"> · {{ STEP_NAMES[route.meta.step] }}</template>.
      The approved design is <code>docs/design/mockups/{{ route.meta.mockup }}</code>.
    </NoticeBanner>
  </section>
</template>
