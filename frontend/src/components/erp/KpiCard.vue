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
    tone?: 'default' | 'warning'
    loading?: boolean
    compact?: boolean
  }>(),
  { tone: 'default', loading: false, compact: false },
)
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to"
    class="erp-card flex flex-col transition-shadow"
    :class="[
      tone === 'warning' ? '!border-note-warn-border !bg-note-warn-bg text-note-warn-strong' : 'text-erp-text',
      to ? 'hover:shadow-sm' : '',
      compact ? 'gap-1 px-[18px] py-3.5' : 'gap-1.5 px-5 py-[18px]',
    ]"
  >
    <span class="text-xs font-semibold" :class="tone === 'warning' ? 'text-note-warn-strong' : 'text-erp-muted'">{{ label }}</span>
    <span class="leading-tight font-bold erp-num" :class="compact ? 'text-[22px]' : 'text-[28px]'">
      <span v-if="loading" class="inline-block h-7 w-10 animate-pulse rounded bg-erp-track" />
      <template v-else>{{ value }}</template>
    </span>
    <span class="text-xs" :class="tone === 'warning' ? 'text-note-warn-strong' : 'text-erp-muted'">{{ sub }}</span>
  </component>
</template>
