<script setup lang="ts">
import StatusChip from './StatusChip.vue'
import SideCard from './SideCard.vue'

/** "Linked documents": every document before and after this one, each with its own status wording. */
defineProps<{
  docs: {
    type: string
    id: string | null
    docNo: string
    summary: string
    status: string | null
    label: string | null
    group: 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled' | null
  }[]
  routeOf: (type: string, id: string | null) => string | null
  flowTo?: string | null
}>()
</script>

<template>
  <SideCard title="Linked documents">
    <p v-if="!docs.length" class="m-0 text-[13px] text-erp-muted">No other documents yet.</p>
    <div
      v-for="d in docs"
      :key="`${d.type}:${d.docNo}`"
      class="grid grid-cols-[96px_1fr_auto] items-center gap-2.5 border-b border-erp-row py-2 text-[13px] last:border-b-0"
    >
      <RouterLink v-if="routeOf(d.type, d.id)" :to="routeOf(d.type, d.id)!" class="erp-link font-semibold">{{ d.docNo }}</RouterLink>
      <span v-else class="font-semibold">{{ d.docNo }}</span>
      <span class="truncate text-center text-xs text-erp-muted">{{ d.summary }}</span>
      <StatusChip v-if="d.status" :status="d.status" :label="d.label ?? undefined" :group="d.group ?? undefined" />
      <span v-else />
    </div>
    <RouterLink v-if="flowTo" :to="flowTo" class="erp-link mt-1 text-[13px] font-semibold">Open full document flow →</RouterLink>
  </SideCard>
</template>
