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
import { formatDate, formatDayMonth, formatRm } from '@/utils/format'
import { salesReportsApi } from '../api/sales'

/** S05 · Customer aging (SRS RPT-023): what each customer owes today, by how long it has been owed. */
const { data: report, loading, filters, setFilter } = useReport(['branch', 'agent', 'group', 'steps', 'basis'], salesReportsApi.customerAging)

const STEPS = [
  { value: '4', label: '4 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
]
const BASIS = [
  { value: 'due', label: 'Due date' },
  { value: 'invoice', label: 'Invoice date' },
]

const options = computed(() => {
  const f = report.value?.filters
  return {
    branches: (f?.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
    agents: (f?.agents ?? []).map((a) => ({ value: a.code, label: a.name })),
    groups: (f?.groups ?? []).map((g) => ({ value: g, label: g })),
  }
})
const byDue = computed(() => report.value?.basis !== 'invoice')
/** "1–30 days overdue", "Over 90 days old" … */
function columnName(c: { key: string; label: string }): string {
  if (c.key === 'notDue') return c.label
  return `${c.label} days ${byDue.value ? 'overdue' : 'old'}`
}
const chart = computed(() => (report.value?.columns ?? []).map((c) => ({ key: c.key, label: columnName(c), value: report.value!.totals.cells[c.key] ?? '0.00' })))
const isZero = (v: string | undefined) => !v || Number(v) === 0
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
const columnLabel = (key: string) => report.value?.columns.find((c) => c.key === key)?.label ?? ''

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`customer-aging-${r.today}.csv`, [
    ['Customer', 'Credit limit (RM)', 'Invoices', 'Balance (RM)', ...r.columns.map((c) => columnName(c)), 'Oldest (days)'],
    ...r.rows.map((x) => [x.customerName, x.creditLimit ?? '', x.invoices, x.balance, ...r.columns.map((c) => x.cells[c.key] ?? '0.00'), x.oldestDays]),
    ['Total', '', '', r.totals.balance, ...r.columns.map((c) => r.totals.cells[c.key] ?? '0.00'), ''],
  ])
}
</script>

<template>
  <PageHeader title="Customer aging" subtitle="What each customer owes today, by how long it has been owed.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">As at {{ formatDate(report.today) }}</span>
    </template>
    <template #actions><ReportActions :can-export="Boolean(report)" @export="exportCsv" /></template>
  </PageHeader>

  <div class="grid grid-cols-5 gap-3 print:hidden max-lg:grid-cols-2">
    <FilterSelect label="Branch" all="all" :model-value="filters.branch ?? ''" :options="options.branches" @update:model-value="setFilter('branch', $event)" />
    <FilterSelect label="Sales agent" all="all" :model-value="filters.agent ?? ''" :options="options.agents" @update:model-value="setFilter('agent', $event)" />
    <FilterSelect label="Customer group" all="all" :model-value="filters.group ?? ''" :options="options.groups" @update:model-value="setFilter('group', $event)" />
    <FilterSelect label="Aging" :model-value="filters.steps || '4'" :options="STEPS" @update:model-value="setFilter('steps', $event === '4' ? '' : $event)" />
    <FilterSelect label="Aged by" :model-value="filters.basis || 'due'" :options="BASIS" @update:model-value="setFilter('basis', $event === 'due' ? '' : $event)" />
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard label="Balance due" :value="report ? formatRm(report.kpis.due.amount) : '—'" :sub="report ? `${report.kpis.due.invoices} unpaid invoices` : ''" :loading="loading && !report" />
    <KpiCard
      label="Overdue"
      tone="danger"
      :value="report ? formatRm(report.kpis.overdue.amount) : '—'"
      :sub="report ? `${report.kpis.overdue.customers} ${report.kpis.overdue.customers === 1 ? 'customer' : 'customers'}` : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Over 60 days overdue"
      tone="warning"
      :value="report ? formatRm(report.kpis.over60.amount) : '—'"
      :sub="report ? report.kpis.over60.customers.join(', ') || 'Nobody' : ''"
      :loading="loading && !report"
    />
    <KpiCard label="Not yet due" :value="report ? formatRm(report.kpis.notDue.amount) : '—'" sub="Within their credit term" :loading="loading && !report" />
  </div>

  <section v-if="report" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="m-0 text-[15px] font-bold">By customer</h2>
      <span class="text-xs text-erp-muted">{{ byDue ? 'Days overdue, from the due date' : 'Days since the invoice date' }}</span>
    </div>
    <div class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th class="num">Credit limit</th>
            <th class="num">Balance</th>
            <th v-for="c in report.columns" :key="c.key" class="num">{{ c.label }}</th>
            <th class="num">Oldest</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!report.rows.length"><td :colspan="report.columns.length + 4" class="text-erp-muted">Nobody owes anything.</td></tr>
          <tr v-for="r in report.rows" :key="r.customerCode">
            <td class="font-bold">{{ r.customerName }}<span class="block text-xs font-normal text-erp-muted">{{ r.invoices }} {{ r.invoices === 1 ? 'invoice' : 'invoices' }}</span></td>
            <td class="num" :class="{ 'text-note-error-text': r.overLimit }"><MoneyText v-if="r.creditLimit" :value="r.creditLimit" /><span v-else class="text-erp-muted">No limit</span></td>
            <td class="num font-bold"><MoneyText :value="r.balance" /></td>
            <td v-for="c in report.columns" :key="c.key" class="num">
              <span v-if="isZero(r.cells[c.key])" class="text-erp-muted">–</span>
              <MoneyText v-else :value="r.cells[c.key]" />
            </td>
            <td class="num whitespace-nowrap">{{ r.oldestDays > 0 ? days(r.oldestDays) : 'Not due' }}</td>
          </tr>
          <tr v-if="report.rows.length" class="bg-erp-head font-bold">
            <td>Total</td>
            <td />
            <td class="num"><MoneyText :value="report.totals.balance" /></td>
            <td v-for="c in report.columns" :key="c.key" class="num">
              <span v-if="isZero(report.totals.cells[c.key])" class="font-normal text-erp-muted">–</span>
              <MoneyText v-else :value="report.totals.cells[c.key]" />
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="report" class="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-4 max-lg:grid-cols-1">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Balance by age (RM)</h2>
      <BarRows :rows="chart" empty="Nobody owes anything." />
    </section>
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Unpaid invoices, oldest first</h2>
      <table class="erp-table">
        <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th class="num">{{ byDue ? 'Overdue' : 'Age' }}</th><th class="num">Balance (RM)</th></tr></thead>
        <tbody>
          <tr v-for="i in report.invoices" :key="i.id">
            <td class="whitespace-nowrap">
              <RouterLink v-if="!i.isMigrated" :to="`/sales/invoices/${i.id}`" class="erp-link font-semibold">{{ i.docNo }}</RouterLink>
              <span v-else class="font-semibold">{{ i.docNo }}</span>
            </td>
            <td>{{ i.customerName }}</td>
            <td class="whitespace-nowrap">{{ i.dueDate ? formatDayMonth(i.dueDate) : '—' }}</td>
            <td class="num whitespace-nowrap" :class="{ 'font-semibold text-note-error-text': byDue && i.days > 60 }">
              {{ byDue && i.days <= 0 ? 'Not due' : days(i.days) }}
              <span v-if="i.column !== 'notDue'" class="block text-[11px] font-normal text-erp-muted">{{ columnLabel(i.column) }}</span>
            </td>
            <td class="num"><MoneyText :value="i.balance" /></td>
          </tr>
        </tbody>
      </table>
      <p class="m-0 text-xs text-erp-muted">{{ report.footnote }}</p>
    </section>
  </div>
</template>
