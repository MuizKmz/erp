<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DashboardBoard from '@/components/erp/DashboardBoard.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import { formatMoney } from '@/utils/format'
import { salesApi } from '../api/sales'
import { SALES_MENU } from '../menu'
import type { SalesDashboard } from '../types'

/** S01 · Sales home: four group tiles, the KPI cards and the person's charts (Main.html). */
const data = ref<SalesDashboard | null>(null)
const loading = ref(true)
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    data.value = await salesApi.dashboard()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Group tiles, darkest first (Sales Transaction, Billing, Operation Policies, Reports)
const TILE_SHADES = ['bg-mod-tile-1', 'bg-mod-tile-2', 'bg-mod-tile-3', 'bg-mod-tile-4']
const TILE_TEXT = ['text-mod-tile-1', 'text-mod-tile-2', 'text-mod-tile-3', 'text-mod-tile-4']

const kpis = computed(() => {
  const k = data.value?.kpis
  if (!k) return null
  return {
    openOrders: `RM ${formatMoney(k.openOrders.total)} · ${k.openOrders.released} released, ${k.openOrders.partial} partial`,
    toInvoice: k.toInvoice.count
      ? `RM ${formatMoney(k.toInvoice.amount)} · oldest ${k.toInvoice.oldestDays} ${k.toInvoice.oldestDays === 1 ? 'day' : 'days'}`
      : 'Nothing waiting to be invoiced',
    overdue: `RM ${formatMoney(k.customersOverdue.amount)} overdue in total`,
  }
})
</script>

<template>
  <!-- Group tiles -->
  <div class="flex gap-4">
    <RouterLink
      v-for="(g, i) in SALES_MENU"
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

  <DashboardBoard path="/sales/dashboard/board">
    <template #kpis>
      <div v-if="failed" class="erp-card flex items-center justify-between px-5 py-4 text-[13px]">
        <span>The cards could not be loaded.</span>
        <button type="button" class="erp-btn erp-btn-secondary" @click="load">Try again</button>
      </div>
      <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <KpiCard label="Open sales orders" :value="data?.kpis.openOrders.count ?? ''" :sub="kpis?.openOrders" to="/sales/orders" :loading="loading" />
        <KpiCard label="Delivered, not yet invoiced" :value="data?.kpis.toInvoice.count ?? ''" :sub="kpis?.toInvoice" to="/sales/invoices/new" :loading="loading" />
        <KpiCard
          label="Waiting for your approval"
          :value="data?.kpis.waitingForMe.count ?? ''"
          :sub="data?.kpis.waitingForMe.summary"
          to="/sales/approvals"
          tone="warning"
          :loading="loading"
        />
        <KpiCard label="Customers over limit" :value="data?.kpis.customersOverdue.count ?? ''" :sub="kpis?.overdue" :loading="loading" />
      </div>
    </template>
  </DashboardBoard>
</template>
