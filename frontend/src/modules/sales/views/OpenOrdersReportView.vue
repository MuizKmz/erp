<script setup lang="ts">
import { computed } from 'vue'
import BarRows from '@/components/erp/BarRows.vue'
import FilterSelect from '@/components/erp/FilterSelect.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import ReportActions from '@/components/erp/ReportActions.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useReport } from '@/composables/useReport'
import { downloadCsv } from '@/utils/csv'
import { formatDate, formatDayMonth, formatQty, formatRm, qtyWithUnit } from '@/utils/format'
import { salesReportsApi } from '../api/sales'
import type { OpenReason } from '../types'

/** S05 · Open orders (SRS RPT-024): every sales order not finished yet, what is left and what it waits for. */
const { data: report, loading, filters, setFilter } = useReport(['branch', 'agent', 'group', 'show'], salesReportsApi.openOrders)

const SHOW = [
  { value: 'released', label: 'Released and partly delivered' },
  { value: 'approval', label: 'Waiting for approval' },
  { value: 'draft', label: 'Draft' },
]
const REASON_GROUP: Record<OpenReason, 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'> = {
  DRAFT: 'draft',
  APPROVAL: 'pending',
  CANCELLING: 'cancelled',
  DEPOSIT: 'pending',
  PURCHASE: 'partial',
  NO_STOCK: 'pending',
  READY: 'done',
  TO_INVOICE: 'released',
}

const options = computed(() => {
  const f = report.value?.filters
  return {
    branches: (f?.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
    agents: (f?.agents ?? []).map((a) => ({ value: a.code, label: a.name })),
    groups: (f?.groups ?? []).map((g) => ({ value: g, label: g })),
  }
})
const chart = computed(() => (report.value?.byReason ?? []).map((r) => ({ key: r.key, label: r.label, value: r.amount, sub: `${r.lines} ${r.lines === 1 ? 'line' : 'lines'}` })))
const lineCount = computed(() => (report.value?.orders ?? []).reduce((n, o) => n + o.lines.length, 0))

const openSub = computed(() => {
  const k = report.value?.kpis.open
  if (!k) return ''
  const parts = [k.released && `${k.released} released`, k.partial && `${k.partial} partial`, k.approval && `${k.approval} waiting`, k.draft && `${k.draft} draft`].filter(Boolean)
  return `${formatRm(k.ordered)} ordered${parts.length ? ` · ${parts.join(', ')}` : ''}`
})

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`open-orders-${r.today}.csv`, [
    ['Order', 'Date', 'Status', 'Customer', 'Sales agent', 'Wanted by', 'Promised', 'Item', 'Description', 'Unit', 'Ordered', 'Delivered', 'Invoiced', 'Open', 'Open (RM)', 'Waiting for', 'Detail'],
    ...r.orders.flatMap((o) =>
      o.lines.map((l) => [
        o.docNo, o.docDate, o.status, o.customerName, o.agentName, o.wantedBy ?? '', o.promisedDate ?? '',
        l.itemCode, l.itemName, l.uomCode, l.ordered, l.delivered, l.invoiced, l.open, l.openValue, l.reasonLabel, l.detail ?? '',
      ]),
    ),
  ])
}
</script>

<template>
  <PageHeader title="Open orders" subtitle="Every sales order not finished yet: what is left to deliver and to invoice, and what it waits for.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">As at {{ formatDate(report.today) }}</span>
    </template>
    <template #actions><ReportActions :can-export="Boolean(report)" @export="exportCsv" /></template>
  </PageHeader>

  <div class="grid grid-cols-4 gap-3 print:hidden max-lg:grid-cols-2">
    <FilterSelect label="Branch" all="all" :model-value="filters.branch ?? ''" :options="options.branches" @update:model-value="setFilter('branch', $event)" />
    <FilterSelect label="Sales agent" all="all" :model-value="filters.agent ?? ''" :options="options.agents" @update:model-value="setFilter('agent', $event)" />
    <FilterSelect label="Customer group" all="all" :model-value="filters.group ?? ''" :options="options.groups" @update:model-value="setFilter('group', $event)" />
    <FilterSelect label="Show" all="all open orders" :model-value="filters.show ?? ''" :options="SHOW" @update:model-value="setFilter('show', $event)" />
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard label="Open orders" :value="report ? report.kpis.open.orders : '—'" :sub="openSub" :loading="loading && !report" />
    <KpiCard
      label="Still to deliver"
      :value="report ? formatRm(report.kpis.toDeliver.amount) : '—'"
      :sub="report ? `${formatQty(report.kpis.toDeliver.units)} units on ${lineCount} lines` : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Due in the next 14 days"
      :tone="report?.kpis.dueSoon.late.length ? 'danger' : 'default'"
      :value="report ? report.kpis.dueSoon.orders : '—'"
      :sub="report ? (report.kpis.dueSoon.late.length ? `Late: ${report.kpis.dueSoon.late.join(', ')}` : report.kpis.dueSoon.orderNos.join(', ') || 'Nothing due soon') : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Waiting for approval"
      tone="warning"
      :value="report ? report.kpis.approval.orders : '—'"
      :sub="report ? (report.kpis.approval.orders ? `${formatRm(report.kpis.approval.amount)} · credit` : 'Nothing waiting') : ''"
      :loading="loading && !report"
    />
  </div>

  <NoticeBanner v-if="report && !report.inventoryConnected" kind="warning">
    Inventory is not connected yet. Stock is taken from the last snapshot, so “Waiting for stock” and “Ready to deliver” may change once it is.
  </NoticeBanner>

  <div v-if="report" class="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-start gap-4 max-lg:grid-cols-1">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Still to deliver, by what it waits for (RM)</h2>
      <BarRows :rows="chart" empty="No open sales orders." />
    </section>
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">By customer</h2>
      <table class="erp-table">
        <thead><tr><th>Customer</th><th class="num">Orders</th><th class="num">Still to deliver (RM)</th></tr></thead>
        <tbody>
          <tr v-if="!report.byCustomer.length"><td colspan="3" class="text-erp-muted">No open sales orders.</td></tr>
          <tr v-for="c in report.byCustomer" :key="c.customerCode">
            <td>{{ c.customerName }}</td>
            <td class="num">{{ c.orders }}</td>
            <td class="num"><MoneyText :value="c.openValue" /></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>

  <section v-if="report" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <h2 class="m-0 text-[15px] font-bold">Detail</h2>
    <div class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Wanted by</th>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Delivered</th>
            <th class="num">Invoiced</th>
            <th class="num">Open</th>
            <th class="num">Open (RM)</th>
            <th>Waiting for</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!report.orders.length"><td colspan="10" class="text-erp-muted">No open sales orders.</td></tr>
          <template v-for="o in report.orders" :key="o.id">
            <tr v-for="(l, i) in o.lines" :key="`${o.id}-${l.lineNo}`">
              <td v-if="i === 0" :rowspan="o.lines.length" class="align-top whitespace-nowrap">
                <RouterLink v-if="!o.isMigrated" :to="`/sales/orders/${o.id}`" class="erp-link font-semibold">{{ o.docNo }}</RouterLink>
                <span v-else class="font-semibold">{{ o.docNo }}</span>
                <span class="mt-1 block"><StatusChip :status="o.status" :label="o.balanceCancelled ? 'Balance cancelled' : undefined" /></span>
                <span class="mt-1 block text-xs text-erp-muted">{{ formatDate(o.docDate) }}</span>
              </td>
              <td v-if="i === 0" :rowspan="o.lines.length" class="align-top">
                {{ o.customerName }}
                <span class="block text-xs text-erp-muted">{{ o.agentName }}</span>
              </td>
              <td v-if="i === 0" :rowspan="o.lines.length" class="align-top whitespace-nowrap">
                {{ o.wantedBy ? formatDayMonth(o.wantedBy) : '—' }}
                <StatusChip v-if="o.late" status="LATE" label="Late" group="cancelled" />
                <span v-if="o.promisedDate" class="block text-xs text-erp-muted">Promised {{ formatDayMonth(o.promisedDate) }}</span>
              </td>
              <td>
                <span class="block font-semibold whitespace-nowrap">{{ l.itemCode }}</span>
                <span class="block text-xs text-erp-muted">{{ l.itemName }}</span>
              </td>
              <td class="num">{{ qtyWithUnit(l.ordered, l.uomCode) }}</td>
              <td class="num">{{ formatQty(l.delivered) }}</td>
              <td class="num">{{ formatQty(l.invoiced) }}</td>
              <td class="num font-semibold">{{ formatQty(l.open) }}</td>
              <td class="num"><MoneyText :value="l.openValue" /></td>
              <td>
                <StatusChip :status="l.reason" :label="l.reasonLabel" :group="REASON_GROUP[l.reason]" />
                <span v-if="l.detail" class="mt-0.5 block text-xs text-erp-muted">{{ l.detail }}</span>
              </td>
            </tr>
          </template>
          <tr v-if="report.orders.length" class="bg-erp-head font-bold">
            <td colspan="8">Total · {{ report.orders.length }} orders</td>
            <td class="num"><MoneyText :value="report.totals.openValue" /></td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
    <p class="m-0 text-xs text-erp-muted">
      Open = ordered − delivered − cancelled, valued at the order’s prices with tax. A balance a draft cancel order takes is shown as being cancelled until the
      cancel order is released.
    </p>
  </section>
</template>
