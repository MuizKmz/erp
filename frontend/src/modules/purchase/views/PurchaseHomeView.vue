<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DashboardBoard from '@/components/erp/DashboardBoard.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import { formatDayMonth, formatMoney, formatQty } from '@/utils/format'
import { purchaseApi } from '../api/purchase'
import { PURCHASE_MENU } from '../menu'
import type { PurchaseDashboard } from '../types'

/** P01 · Purchase home: three group tiles, the KPI cards and the person's charts (PurHome.html). */
const data = ref<PurchaseDashboard | null>(null)
const loading = ref(true)
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    data.value = await purchaseApi.dashboard()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Group tiles, darkest first (Purchase Transaction, Supplier Billing, Operation Policies)
const TILE_SHADES = ['bg-mod-tile-1', 'bg-mod-tile-2', 'bg-mod-tile-3']
const TILE_TEXT = ['text-mod-tile-1', 'text-mod-tile-2', 'text-mod-tile-3']

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const kpis = computed(() => {
  const k = data.value?.kpis
  if (!k) return null
  const waitingParts = [
    k.waitingForMe.purchaseOrders && plural(k.waitingForMe.purchaseOrders, 'purchase order', 'purchase orders'),
    k.waitingForMe.invoices && plural(k.waitingForMe.invoices, 'invoice', 'invoices'),
    k.waitingForMe.debitNotes && plural(k.waitingForMe.debitNotes, 'debit note', 'debit notes'),
  ].filter(Boolean)
  return {
    openOrders: `RM ${formatMoney(k.openOrders.committed)} committed`,
    waiting: `${formatQty(k.waitingToReceive.units)} units · ${
      k.waitingToReceive.nextDue ? `next due ${formatDayMonth(k.waitingToReceive.nextDue)}` : 'nothing due soon'
    }`,
    invoices: k.invoicesToMatch.withDifference
      ? `${k.invoicesToMatch.withDifference} ${k.invoicesToMatch.withDifference === 1 ? 'has' : 'have'} a price difference`
      : 'All within tolerance',
    approvals: waitingParts.length ? waitingParts.join(' · ') : 'Nothing waiting for you',
  }
})
</script>

<template>
  <!-- Group tiles -->
  <div class="flex gap-4">
    <RouterLink
      v-for="(g, i) in PURCHASE_MENU"
      :key="g.key"
      :to="g.to"
      class="flex h-[100px] w-[132px] flex-col items-center justify-center gap-2 rounded-xl p-2 text-center text-xs font-semibold text-erp-on-dark"
      :class="TILE_SHADES[i]"
    >
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-erp-on-dark">
        <component :is="g.icon" :size="18" :class="TILE_TEXT[i]" aria-hidden="true" />
      </span>
      {{ g.title }}
    </RouterLink>
  </div>

  <DashboardBoard path="/purchase/dashboard/board">
    <template #kpis>
      <div v-if="failed" class="erp-card flex items-center justify-between px-5 py-4 text-[13px]">
        <span>The cards could not be loaded.</span>
        <button type="button" class="erp-btn erp-btn-secondary" @click="load">Try again</button>
      </div>
      <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <KpiCard label="Open purchase orders" :value="data?.kpis.openOrders.count ?? ''" :sub="kpis?.openOrders" to="/purchase/orders" :loading="loading" />
        <KpiCard label="Waiting to be received" :value="data?.kpis.waitingToReceive.count ?? ''" :sub="kpis?.waiting" to="/purchase/receipts" :loading="loading" />
        <KpiCard label="Supplier invoices to match" :value="data?.kpis.invoicesToMatch.count ?? ''" :sub="kpis?.invoices" to="/purchase/invoices" :loading="loading" />
        <KpiCard
          label="Waiting for your approval"
          :value="data?.kpis.waitingForMe.count ?? ''"
          :sub="kpis?.approvals"
          to="/purchase/approvals"
          tone="warning"
          :loading="loading"
        />
      </div>
    </template>
  </DashboardBoard>
</template>
