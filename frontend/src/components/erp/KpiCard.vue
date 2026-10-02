<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * A number with a label and a line of context. `warning` is the amber card ("Waiting for your approval").
 * `compact` is the smaller card of list pages (PurDemand.html).
 */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    to?: RouteLocationRaw
    tone?: 'default' | 'warning' | 'success' | 'danger'
    loading?: boolean
    compact?: boolean
  }>(),
  { tone: 'default', loading: false, compact: false },
)

// Coloured cards (GrnList.html): green "Arrived today", red "Late", amber "Waiting for Inventory".
const TONES = {
  default: { box: 'text-erp-text', label: 'text-erp-muted', value: '' },
  warning: { box: '!border-note-warn-border !bg-note-warn-bg', label: 'text-note-warn-strong', value: 'text-note-warn-strong' },
  success: { box: '!border-mod-light-border !bg-mod-light', label: 'text-chip-done-text', value: 'text-chip-done-text' },
  danger: { box: '!border-note-error-border !bg-note-error-bg', label: 'text-note-error-text', value: 'text-note-error-text' },
} as const
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to"
    class="erp-card flex flex-col transition-shadow"
    :class="[
      TONES[tone].box,
      to ? 'hover:shadow-sm' : '',
      compact ? 'gap-1 px-[18px] py-3.5' : 'gap-1.5 px-5 py-[18px]',
    ]"
  >
    <span class="text-xs font-semibold" :class="TONES[tone].label">{{ label }}</span>
    <span class="leading-tight font-bold erp-num" :class="[compact ? 'text-[22px]' : 'text-[28px]', TONES[tone].value]">
      <span v-if="loading" class="inline-block h-7 w-10 animate-pulse rounded bg-erp-track" />
      <template v-else>{{ value }}</template>
    </span>
    <span class="text-xs" :class="TONES[tone].label">{{ sub }}</span>
  </component>
</template>
