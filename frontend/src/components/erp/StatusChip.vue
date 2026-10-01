<script setup lang="ts">
import { computed } from 'vue'

/**
 * The one way to show a status (DESIGN_TOKENS.md → Status chips). Maps a document status to a colour group.
 * Pass `label` when a screen uses its own word for a status ("Partially received", "Short 5").
 */
type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

const props = defineProps<{
  status: string
  label?: string
  group?: ChipGroup
}>()

const GROUPS: Record<string, ChipGroup> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending',
  TO_MATCH: 'pending',
  WAITING_FOR_CREDIT: 'pending',
  SUBMITTED: 'released',
  RELEASED: 'released',
  WAITING: 'released',
  READY: 'released',
  SENT: 'released',
  PARTIAL: 'partial',
  DONE: 'done',
  CONVERTED: 'done',
  AWARDED: 'done',
  SETTLED: 'done',
  APPROVED: 'done',
  PAID: 'done',
  CONFIRMED: 'done',
  REJECTED: 'cancelled',
  CANCELLED: 'cancelled',
  CLOSED: 'cancelled',
}

const LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  TO_MATCH: 'To match',
  WAITING_FOR_CREDIT: 'Waiting for credit',
  SUBMITTED: 'Submitted',
  RELEASED: 'Released',
  WAITING: 'Waiting',
  READY: 'Ready to compare',
  SENT: 'Sent',
  PARTIAL: 'Partial',
  DONE: 'Done',
  CONVERTED: 'Converted',
  AWARDED: 'Awarded',
  SETTLED: 'Settled',
  APPROVED: 'Approved',
  PAID: 'Paid',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
}

const CLASSES: Record<ChipGroup, string> = {
  draft: 'bg-chip-draft-bg text-chip-draft-text',
  pending: 'bg-chip-pending-bg text-chip-pending-text',
  released: 'bg-chip-released-bg text-chip-released-text',
  partial: 'bg-chip-partial-bg text-chip-partial-text',
  done: 'bg-chip-done-bg text-chip-done-text',
  cancelled: 'bg-chip-cancelled-bg text-chip-cancelled-text',
}

const group = computed<ChipGroup>(() => props.group ?? GROUPS[props.status] ?? 'draft')
const text = computed(() => props.label ?? LABELS[props.status] ?? props.status)
</script>

<template>
  <span class="inline-block rounded-xl px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap" :class="CLASSES[group]">
    {{ text }}
  </span>
</template>
