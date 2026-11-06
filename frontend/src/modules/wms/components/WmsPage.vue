<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink } from '@lucide/vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import type { WmsSource } from '../types'

/** The frame of every WMS screen: title, "Open in WMS", and where the data comes from. */
const props = defineProps<{ title: string; subtitle: string; source?: WmsSource | null; failed?: boolean }>()

const updated = computed(() => {
  if (!props.source?.asOf) return ''
  const minutes = Math.floor((Date.now() - new Date(props.source.asOf).getTime()) / 60_000)
  if (minutes < 1) return 'updated just now'
  if (minutes < 60) return `updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  return `updated ${hours} hour${hours === 1 ? '' : 's'} ago`
})
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader :title="title" :subtitle="subtitle">
      <template v-if="source?.webUrl" #actions>
        <a :href="source.webUrl" target="_blank" rel="noopener" class="erp-btn erp-btn-secondary"><ExternalLink :size="14" aria-hidden="true" />Open in WMS</a>
      </template>
    </PageHeader>

    <NoticeBanner v-if="failed" kind="warning">The WMS cannot be reached right now. Try again in a moment.</NoticeBanner>
    <NoticeBanner v-else-if="source?.stale" kind="warning">The WMS cannot be reached right now. These are the last figures it gave, {{ updated }}.</NoticeBanner>
    <NoticeBanner v-else kind="info">
      <span class="flex items-center justify-between gap-4">
        <span><strong>Read only.</strong> This comes from the WMS. Changes are made there, by scan or on its website.</span>
        <span v-if="updated" class="text-xs whitespace-nowrap">From WMS · {{ updated }}</span>
      </span>
    </NoticeBanner>

    <slot />
  </section>
</template>
