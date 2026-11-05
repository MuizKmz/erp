<script setup lang="ts">
import { computed } from 'vue'
import MoneyText from '@/components/erp/MoneyText.vue'

/**
 * A report's bar chart (SalesReports.html → "Ordered by customer"): a label, a bar against the largest value, and the
 * value. `part` draws the darker bar inside the lighter one (invoiced within ordered). Plain HTML; the module colours
 * come from the theme.
 */
const props = withDefaults(
  defineProps<{ rows: { key: string; label: string; value: string; part?: string; sub?: string }[]; unit?: 'money' | 'count'; empty?: string }>(),
  { unit: 'money', empty: 'Nothing to show.' },
)

const layered = computed(() => props.rows.some((r) => r.part !== undefined))
const max = computed(() => Math.max(0, ...props.rows.map((r) => Number(r.value))))
const width = (value: string | undefined) => (max.value > 0 && value ? `${Math.max(0, (Number(value) / max.value) * 100)}%` : '0%')
</script>

<template>
  <p v-if="!rows.length" class="m-0 text-[13px] text-erp-muted">{{ empty }}</p>
  <div v-else class="flex flex-col gap-3.5 pt-1.5">
    <div v-for="r in rows" :key="r.key" class="grid grid-cols-[190px_minmax(0,1fr)_110px] items-center gap-3 text-[13px] max-sm:grid-cols-[110px_minmax(0,1fr)_90px]">
      <span class="flex min-w-0 flex-col">
        <span class="truncate" :title="r.label">{{ r.label }}</span>
        <span v-if="r.sub" class="truncate text-[11px] text-erp-muted">{{ r.sub }}</span>
      </span>
      <span class="relative h-[18px] overflow-hidden rounded bg-erp-track" role="img" :aria-label="`${r.label}: ${r.value}${r.part !== undefined ? `, of which ${r.part}` : ''}`">
        <span class="absolute inset-y-0 left-0" :class="layered ? 'bg-mod-light-border' : 'bg-mod-primary'" :style="{ width: width(r.value) }" />
        <span v-if="r.part !== undefined" class="absolute inset-y-0 left-0 bg-mod-primary" :style="{ width: width(r.part) }" />
      </span>
      <span class="text-right">
        <MoneyText v-if="unit === 'money'" :value="r.value" />
        <span v-else class="erp-num">{{ r.value }}</span>
      </span>
    </div>
  </div>
</template>
