<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney } from '@/utils/format'

/**
 * Money from the API (a string). "RM 4,400.00" in totals and KPIs (currency), "4,400.00" in tables.
 * Always tabular figures so columns line up.
 */
const props = withDefaults(defineProps<{ value: string | null | undefined; currency?: boolean; decimals?: number }>(), {
  currency: false,
  decimals: 2,
})

const text = computed(() => {
  const money = formatMoney(props.value, props.decimals)
  if (!money) return '—'
  return props.currency ? `RM ${money}` : money
})
</script>

<template>
  <span class="erp-num">{{ text }}</span>
</template>
