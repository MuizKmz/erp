<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/** A number with a label and a line of context. `warning` is the amber card ("Waiting for your approval"). */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    to?: RouteLocationRaw
    tone?: 'default' | 'warning'
    loading?: boolean
  }>(),
  { tone: 'default', loading: false },
)
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to"
    class="erp-card flex flex-col gap-1.5 px-5 py-[18px] transition-shadow"
    :class="[
      tone === 'warning' ? '!border-note-warn-border !bg-note-warn-bg text-note-warn-strong' : 'text-erp-text',
      to ? 'hover:shadow-sm' : '',
    ]"
  >
    <span class="text-xs font-semibold" :class="tone === 'warning' ? 'text-note-warn-strong' : 'text-erp-muted'">{{ label }}</span>
    <span class="text-[28px] leading-tight font-bold erp-num">
      <span v-if="loading" class="inline-block h-7 w-10 animate-pulse rounded bg-erp-track" />
      <template v-else>{{ value }}</template>
    </span>
    <span class="text-xs" :class="tone === 'warning' ? 'text-note-warn-strong' : 'text-erp-muted'">{{ sub }}</span>
  </component>
</template>
