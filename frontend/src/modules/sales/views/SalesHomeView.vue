<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { formatMoney, formatMonthName, formatQty } from '@/utils/format'
import { salesApi } from '../api/sales'
import { SALES_MENU } from '../menu'
import type { ApprovalKind, SalesDashboard } from '../types'

/** S01 · Sales home: four group tiles and the dashboard (Main.html). */
const toast = useToast()
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

// Dashboard layout: 2 or 3 columns, remembered per browser
const COLS_KEY = 'zora.salesHome.cols'
const cols = ref<2 | 3>(readCols())
function readCols(): 2 | 3 {
  try {
    return localStorage.getItem(COLS_KEY) === '3' ? 3 : 2
  } catch {
    return 2
  }
}
watch(cols, (value) => {
  try {
    localStorage.setItem(COLS_KEY, String(value))
  } catch {
    /* ignore */
  }
})

function notYet(what: string) {
  toast.add({ severity: 'info', summary: what, detail: 'Custom dashboard charts are not available yet.', life: 3000 })
}

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

const KIND_LABEL: Record<ApprovalKind, string> = { CREDIT: 'Credit', PRICE: 'Price', DISCOUNT: 'Discount' }
const KIND_GROUP: Record<ApprovalKind, 'pending' | 'partial'> = { CREDIT: 'pending', PRICE: 'partial', DISCOUNT: 'partial' }

/** "Balance cancelled" is a Done order whose undelivered balance was cancelled. */
const orderChip = (o: SalesDashboard['recentOrders'][number]) =>
  o.balanceCancelled ? { status: o.status, label: 'Balance cancelled' } : { status: o.status, label: undefined }

const agents = computed(() => {
  const a = data.value?.orderedByAgent
  if (!a) return null
  // Bar widths are display only.
  const max = Math.max(...a.rows.map((r) => Number(r.total)), 0)
  return { month: formatMonthName(a.month), rows: a.rows.map((r) => ({ ...r, width: max > 0 ? (Number(r.total) / max) * 100 : 0 })) }
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

  <!-- Dashboard toolbar -->
  <div class="erp-card flex h-14 items-center justify-between px-5">
    <div class="flex items-center gap-2.5">
      <span class="text-sm font-bold">Dashboard</span>
      <StatusChip status="DRAFT" label="Sample data" />
    </div>
    <div class="flex items-center gap-2">
      <div class="flex overflow-hidden rounded-lg border border-erp-input" role="group" aria-label="Dashboard columns">
        <button
          v-for="n in [2, 3] as const"
          :key="n"
          type="button"
          class="h-8 border-0 px-3 font-[inherit] text-xs font-semibold"
          :class="cols === n ? 'bg-mod-chip-bg text-mod-chip-text' : 'bg-erp-card text-erp-text'"
          :aria-pressed="cols === n"
          @click="cols = n"
        >
          {{ n }} cols
        </button>
      </div>
      <button type="button" class="erp-btn erp-btn-add" @click="notYet('Add chart')"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add chart</button>
      <button type="button" class="erp-btn erp-btn-danger" @click="notYet('Clear')">Clear</button>
    </div>
  </div>

  <div v-if="failed" class="erp-card flex items-center justify-between px-5 py-4 text-[13px]">
    <span>The dashboard could not be loaded.</span>
    <button type="button" class="erp-btn erp-btn-secondary" @click="load">Try again</button>
  </div>

  <!-- KPI cards -->
  <div class="grid grid-cols-4 gap-4">
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

  <!-- Panels -->
  <div class="grid min-h-0 grow gap-4" :class="cols === 2 ? 'grid-cols-[1.5fr_1fr]' : 'grid-cols-3'">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Recent sales orders</h2>
        <RouterLink to="/sales/orders" class="erp-link text-[13px] font-semibold">View all</RouterLink>
      </div>
      <div class="overflow-x-auto">
        <table class="erp-table">
          <thead>
            <tr>
              <th>SO no</th>
              <th>Customer</th>
              <th class="num">Total (RM)</th>
              <th>Delivered</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="text-erp-muted">Loading…</td>
            </tr>
            <tr v-for="o in data?.recentOrders ?? []" :key="o.id">
              <td class="whitespace-nowrap">
                <span v-if="o.isMigrated" class="font-semibold">{{ o.docNo }}</span>
                <RouterLink v-else :to="`/sales/orders/${o.id}`" class="erp-link font-semibold">{{ o.docNo }}</RouterLink>
              </td>
              <td>{{ o.customerName }}</td>
              <td class="num"><MoneyText :value="o.total" /></td>
              <td class="erp-num">{{ formatQty(o.deliveredQty) }} / {{ formatQty(o.orderedQty) }}</td>
              <td><StatusChip :status="orderChip(o).status" :label="orderChip(o).label" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="flex flex-col gap-4" :class="{ contents: cols === 3 }">
      <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
        <div class="flex items-center justify-between">
          <h2 class="m-0 text-[15px] font-bold">Waiting for your approval</h2>
          <RouterLink to="/sales/approvals" class="erp-link text-[13px] font-semibold">Open inbox</RouterLink>
        </div>
        <p v-if="!loading && !data?.waiting.length" class="m-0 text-[13px] text-erp-muted">Nothing is waiting for you.</p>
        <RouterLink
          v-for="w in data?.waiting ?? []"
          :key="w.id"
          :to="{ path: '/sales/approvals', query: { id: w.id } }"
          class="flex items-center justify-between gap-3 rounded-lg bg-erp-head px-3 py-2.5 text-erp-text"
        >
          <span class="flex flex-col gap-0.5">
            <span class="text-[13px] font-semibold">{{ w.docNo }} · {{ w.customerName }}</span>
            <span class="text-xs text-erp-muted">{{ w.reason }}</span>
          </span>
          <StatusChip :status="w.kind" :label="KIND_LABEL[w.kind]" :group="KIND_GROUP[w.kind]" />
        </RouterLink>
      </section>

      <section class="erp-card flex grow flex-col gap-3 px-5 py-[18px]">
        <h2 class="m-0 text-[15px] font-bold">Ordered by agent · {{ agents?.month }}</h2>
        <p v-if="!loading && !agents?.rows.length" class="m-0 text-[13px] text-erp-muted">No sales orders this month yet.</p>
        <div class="flex flex-col gap-2.5 text-xs">
          <div v-for="r in agents?.rows ?? []" :key="r.agentCode" class="flex items-center gap-2.5">
            <span class="w-[96px] truncate">{{ r.agentName }}</span>
            <div class="h-2.5 grow rounded-[5px] bg-erp-track">
              <div class="h-2.5 rounded-[5px] bg-mod-primary" :style="{ width: `${r.width}%` }" />
            </div>
            <span class="w-[76px] text-right erp-num">RM {{ formatMoney(r.total, 0) }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
