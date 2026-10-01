<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { formatDayMonth, formatMoney, formatMonthName, formatQty } from '@/utils/format'
import { purchaseApi } from '../api/purchase'
import { PURCHASE_MENU } from '../menu'
import type { PurchaseDashboard } from '../types'

/** P01 · Purchase home: three group tiles and the dashboard (PurHome.html). */
const toast = useToast()
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

// Dashboard layout: 2 or 3 columns, remembered per browser
const COLS_KEY = 'zora.purchaseHome.cols'
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

function supplierLine(o: PurchaseDashboard['recentOrders'][number]): string {
  return `${o.supplierName}${o.salesOrderNo ? ` · for ${o.salesOrderNo}` : ''}${o.isMigrated ? ' · migrated' : ''}`
}

function buySoonNote(b: PurchaseDashboard['buySoon'][number]): string {
  const left = `${formatQty(b.onHand)} left`
  if (b.reason === 'SALES_ORDER' && b.salesOrders.length) {
    return `${left} · ${b.salesOrders.map((s) => `${s.soNo} needs ${formatQty(s.qty)}`).join(', ')}`
  }
  return `${left} · reorder ${formatQty(b.reorderLevel)}`
}

const spend = computed(() => {
  const c = data.value?.committedBySupplier
  if (!c) return null
  // Bar widths are display only.
  const max = Math.max(...c.rows.map((r) => Number(r.amount)), 0)
  const pending = c.pendingApproval
  const pendingNote = pending.length
    ? ` ${pending.map((p) => `${p.docNo} (RM ${formatMoney(p.total)})`).join(' and ')} ${pending.length === 1 ? 'counts' : 'count'} once approved.`
    : ''
  return {
    month: formatMonthName(c.month),
    rows: c.rows.map((r) => ({ ...r, width: max > 0 ? (Number(r.amount) / max) * 100 : 0 })),
    note: `Released orders only.${pendingNote}`,
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

  <!-- Panels -->
  <div class="grid min-h-0 grow gap-4" :class="cols === 2 ? 'grid-cols-[1.5fr_1fr]' : 'grid-cols-3'">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Recent purchase orders</h2>
        <RouterLink to="/purchase/orders" class="erp-link text-[13px] font-semibold">View all</RouterLink>
      </div>
      <div class="overflow-x-auto">
        <table class="erp-table">
          <thead>
            <tr>
              <th>PO no</th>
              <th>Supplier</th>
              <th class="num">Total (RM)</th>
              <th>Received</th>
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
                <RouterLink v-else :to="`/purchase/orders/${o.id}`" class="erp-link font-semibold">{{ o.docNo }}</RouterLink>
              </td>
              <td>{{ supplierLine(o) }}</td>
              <td class="num"><MoneyText :value="o.total" /></td>
              <td class="erp-num">{{ formatQty(o.receivedQty) }} / {{ formatQty(o.orderedQty) }}</td>
              <td><StatusChip :status="o.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="flex flex-col gap-4" :class="{ contents: cols === 3 }">
      <section class="erp-card flex flex-col gap-2.5 px-5 py-[18px]">
        <div class="flex items-center justify-between">
          <h2 class="m-0 text-[15px] font-bold">Buy soon · below reorder level</h2>
          <RouterLink to="/purchase/demand" class="erp-link text-[13px] font-semibold">Demand list</RouterLink>
        </div>
        <p v-if="!loading && !data?.buySoon.length" class="m-0 text-[13px] text-erp-muted">Nothing needs buying right now.</p>
        <div
          v-for="b in data?.buySoon ?? []"
          :key="b.itemCode"
          class="flex justify-between gap-3 rounded-lg bg-erp-head px-3 py-2.5 text-[13px]"
        >
          <span><strong>{{ b.itemCode }}</strong> · {{ b.itemName }}</span>
          <span class="font-semibold whitespace-nowrap text-attention">{{ buySoonNote(b) }}</span>
        </div>
      </section>

      <section class="erp-card flex grow flex-col gap-3 px-5 py-[18px]">
        <h2 class="m-0 text-[15px] font-bold">Committed spend by supplier · {{ spend?.month }}</h2>
        <div class="flex flex-col gap-2.5 text-xs">
          <div v-for="r in spend?.rows ?? []" :key="r.supplierCode" class="flex items-center gap-2.5">
            <span class="w-[130px] truncate">{{ r.supplierName }}</span>
            <div class="h-2.5 grow rounded-[5px] bg-erp-track">
              <div class="h-2.5 rounded-[5px] bg-mod-side" :style="{ width: `${r.width}%` }" />
            </div>
            <span class="w-[76px] text-right erp-num">RM {{ formatMoney(r.amount, 0) }}</span>
          </div>
        </div>
        <p class="m-0 text-xs text-erp-muted">{{ spend?.note }}</p>
      </section>
    </div>
  </div>
</template>
