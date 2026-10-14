<script setup lang="ts">
import { computed } from 'vue'
import SideCard from '@/components/erp/SideCard.vue'
import type { RecordUsage } from '../types'

/**
 * "In use" on the item, customer and supplier forms (C03, C05, C07): how many Purchase and Sales documents use the
 * record, and the open ones that keep it from being blocked (SRS DR-002, SDD §5.3.1). Comes from the record-usage check.
 */
const props = defineProps<{
  usage: RecordUsage
  /** What waits for the open documents, e.g. "Block and Discontinue come back once these are finished or cancelled." */
  waits: string
}>()

const MODULE: Record<string, string> = { purchase: 'Purchase', sales: 'Sales' }
const where = computed(() => {
  const names = props.usage.modules.filter((m) => m.documents > 0).map((m) => MODULE[m.module] ?? m.module)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')
})
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
  <SideCard title="In use">
    <p class="m-0 text-[13px] text-erp-muted">
      <template v-if="usage.documents > 0">Used on {{ plural(usage.documents, 'document') }} in {{ where }}, so it can never be deleted.</template>
      <template v-else-if="usage.references.length">Not used on any document yet.</template>
      <template v-else>Not used on any document yet, so it can still be deleted.</template>
    </p>
    <p v-for="r in usage.references" :key="r.label" class="m-0 text-[13px] text-erp-muted">Also in {{ r.label }} ({{ r.count }}), so it cannot be deleted.</p>

    <div v-if="usage.open.length">
      <div class="pb-0.5 text-xs font-semibold text-erp-muted">Still open · {{ usage.open.length }}</div>
      <div v-for="d in usage.open" :key="`${d.module}-${d.docNo}`" class="flex justify-between gap-2 border-b border-erp-row py-1.5 text-[13px]">
        <span class="whitespace-nowrap"><span class="font-semibold">{{ d.docNo }}</span> <span class="text-erp-muted">· {{ d.docTypeLabel }}</span></span>
        <span class="whitespace-nowrap text-erp-muted">{{ d.statusLabel }}</span>
      </div>
    </div>
    <p v-if="usage.open.length" class="m-0 text-xs text-erp-muted">{{ waits }}</p>
    <p v-else-if="usage.documents > 0" class="m-0 text-xs text-erp-muted">None of them is open.</p>
  </SideCard>
</template>
