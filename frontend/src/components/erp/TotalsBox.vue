<script setup lang="ts">
import MoneyText from './MoneyText.vue'

/** Subtotal, one row per tax, and the total under a dark rule (PoForm.html). */
withDefaults(
  defineProps<{
    subtotal: string
    taxLines: { code: string; name: string; amount: string }[]
    total: string
    totalLabel?: string
  }>(),
  { totalLabel: 'Order total (MYR)' },
)
</script>

<template>
  <div class="ml-auto flex w-[320px] max-w-full flex-col">
    <div class="flex justify-between gap-3 border-b border-erp-row py-[7px] text-[13px]">
      <span class="text-erp-muted">Subtotal</span><MoneyText :value="subtotal" />
    </div>
    <div
      v-for="t in taxLines.filter((t) => t.amount !== '0.00' || taxLines.length === 1)"
      :key="t.code"
      class="flex justify-between gap-3 border-b border-erp-row py-[7px] text-[13px]"
    >
      <span class="text-erp-muted">{{ t.name }}</span><MoneyText :value="t.amount" />
    </div>
    <div class="mt-1 flex justify-between gap-3 border-t border-erp-text pt-2.5 text-[15px] font-bold">
      <span>{{ totalLabel }}</span><MoneyText :value="total" />
    </div>
  </div>
</template>
