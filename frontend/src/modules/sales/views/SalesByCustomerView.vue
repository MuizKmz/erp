<script setup lang="ts">
import { computed } from 'vue'
import BarRows from '@/components/erp/BarRows.vue'
import FilterSelect from '@/components/erp/FilterSelect.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import ReportActions from '@/components/erp/ReportActions.vue'
import { useReport } from '@/composables/useReport'
import { downloadCsv } from '@/utils/csv'
import { formatMonthYear, formatRm } from '@/utils/format'
import { salesReportsApi } from '../api/sales'

/** S05 · Sales by customer (SalesReports.html). Filters live in the URL so back and refresh keep them. */
const { data: report, loading, filters, setFilter } = useReport(['period', 'branch', 'agent', 'group'], salesReportsApi.byCustomer)

const options = computed(() => {
  const f = report.value?.filters
  return {
    periods: (report.value?.periods ?? []).map((p) => ({ value: p, label: formatMonthYear(p) })),
    branches: (f?.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
    agents: (f?.agents ?? []).map((a) => ({ value: a.code, label: a.name })),
    groups: (f?.groups ?? []).map((g) => ({ value: g, label: g })),
  }
})
const chart = computed(() => (report.value?.rows ?? []).map((r) => ({ key: r.customerCode, label: r.customerName, value: r.ordered, part: r.invoiced })))

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`sales-by-customer-${r.period}.csv`, [
    ['Customer', 'Orders', 'Ordered (RM)', 'Invoiced (RM)', 'Cancelled (RM)', 'Open (RM)', 'Share %'],
    ...r.rows.map((x) => [x.customerName, x.orders, x.ordered, x.invoiced, x.cancelled, x.open, x.sharePct]),
    ['Total', r.totals.orders, r.totals.ordered, r.totals.invoiced, r.totals.cancelled, r.totals.open, '100'],
  ])
}
</script>

<template>
  <PageHeader title="Sales by customer" subtitle="Ordered, invoiced and still open, per customer. Cancelled balances are left out of “open”.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">{{ formatMonthYear(report.period) }}</span>
    </template>
    <template #actions><ReportActions :can-export="Boolean(report)" @export="exportCsv" /></template>
  </PageHeader>

  <div class="grid grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] gap-3 print:hidden max-lg:grid-cols-2">
    <FilterSelect label="Period" :model-value="filters.period || report?.period || ''" :options="options.periods" @update:model-value="setFilter('period', $event)" />
    <FilterSelect label="Branch" all="all" :model-value="filters.branch ?? ''" :options="options.branches" @update:model-value="setFilter('branch', $event)" />
    <FilterSelect label="Sales agent" all="all" :model-value="filters.agent ?? ''" :options="options.agents" @update:model-value="setFilter('agent', $event)" />
    <FilterSelect label="Customer group" all="all" :model-value="filters.group ?? ''" :options="options.groups" @update:model-value="setFilter('group', $event)" />
    <select class="erp-input" aria-label="Compare" disabled><option>Compare: none</option></select>
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard label="Ordered" :value="report ? formatRm(report.kpis.ordered.amount) : '—'" :sub="report ? `${report.kpis.ordered.orders} sales orders` : ''" :loading="loading && !report" />
    <div class="erp-card flex flex-col gap-1 border-mod-light-border bg-mod-light px-5 py-4">
      <span class="text-[13px] font-semibold text-mod-accent">Invoiced</span>
      <span class="text-[22px] font-bold text-mod-accent">{{ report ? formatRm(report.kpis.invoiced.amount) : '—' }}</span>
      <span class="text-xs text-mod-accent">{{ report ? `${report.kpis.invoiced.pct}% of ordered` : '' }}</span>
    </div>
    <KpiCard label="Cancelled" tone="danger" :value="report ? formatRm(report.kpis.cancelled.amount) : '—'" :sub="report?.kpis.cancelled.docs.join(', ') || 'Nothing cancelled'" :loading="loading && !report" />
    <KpiCard label="Still open" :value="report ? formatRm(report.kpis.open.amount) : '—'" sub="To deliver and invoice" :loading="loading && !report" />
  </div>

  <div v-if="report" class="grid grow grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-4 max-lg:grid-cols-1">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">Ordered by customer (RM)</h2>
        <span class="flex items-center gap-3 text-xs text-erp-subtle">
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-mod-primary" />Invoiced</span>
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-mod-light-border" />Ordered</span>
        </span>
      </div>
      <BarRows :rows="chart" empty="No sales orders in this period." />
      <p v-for="n in report.notes" :key="n" class="m-0 text-xs text-erp-muted">{{ n }}</p>

      <h2 class="m-0 mt-2 text-[15px] font-bold">By sales agent</h2>
      <table class="erp-table">
        <thead><tr><th>Agent</th><th class="num">Orders</th><th class="num">Ordered (RM)</th></tr></thead>
        <tbody>
          <tr v-for="a in report.agents" :key="a.agentCode"><td>{{ a.agentName }}</td><td class="num">{{ a.orders }}</td><td class="num"><MoneyText :value="a.ordered" /></td></tr>
        </tbody>
      </table>
    </section>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Detail</h2>
      <table class="erp-table">
        <thead><tr><th>Customer</th><th class="num">Orders</th><th class="num">Ordered</th><th class="num">Invoiced</th><th class="num">Open</th><th class="num">Share</th></tr></thead>
        <tbody>
          <tr v-for="r in report.rows" :key="r.customerCode">
            <td class="font-bold">{{ r.customerName }}</td>
            <td class="num">{{ r.orders }}</td>
            <td class="num"><MoneyText :value="r.ordered" /></td>
            <td class="num"><MoneyText :value="r.invoiced" /></td>
            <td class="num"><MoneyText :value="r.open" /></td>
            <td class="num">{{ r.sharePct }}%</td>
          </tr>
          <tr class="bg-erp-head font-bold">
            <td>Total</td>
            <td class="num">{{ report.totals.orders }}</td>
            <td class="num"><MoneyText :value="report.totals.ordered" /></td>
            <td class="num"><MoneyText :value="report.totals.invoiced" /></td>
            <td class="num"><MoneyText :value="report.totals.open" /></td>
            <td class="num">100%</td>
          </tr>
        </tbody>
      </table>
      <p class="m-0 text-xs text-erp-muted">{{ report.footnote }}</p>
    </section>
  </div>
</template>
