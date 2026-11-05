<script setup lang="ts">
import { computed } from 'vue'
import FilterSelect from '@/components/erp/FilterSelect.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import ReportActions from '@/components/erp/ReportActions.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useReport } from '@/composables/useReport'
import { downloadCsv } from '@/utils/csv'
import { formatDayMonth, formatMonthName, formatMonthYear, formatRm } from '@/utils/format'
import { salesReportsApi } from '../api/sales'
import type { EInvoiceState } from '../types'

/** S05 · e-Invoice status (SRS FR-EIV-010): every document that needs an LHDN e-Invoice, and where it stands. */
const { data: report, loading, filters, setFilter } = useReport(['period', 'branch', 'type', 'show'], salesReportsApi.eInvoiceStatus)

const TYPES = [
  { value: 'invoice', label: 'Invoices' },
  { value: 'debit-note', label: 'Debit notes' },
  { value: 'credit-note', label: 'Credit notes' },
  { value: 'cash-sale', label: 'Cash sales' },
]
const SHOW = [
  { value: '', label: 'Waiting for LHDN' },
  { value: 'all', label: 'All documents' },
]
const STATE_GROUP: Record<EInvoiceState, 'draft' | 'pending' | 'done' | 'cancelled'> = { WAITING: 'pending', SUBMITTED: 'done', FAILED: 'cancelled', OLD_SYSTEM: 'draft' }

const options = computed(() => ({
  periods: (report.value?.periods ?? []).map((p) => ({ value: p, label: formatMonthYear(p) })),
  branches: (report.value?.filters.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
}))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`e-invoice-status-${r.period}.csv`, [
    ['Document', 'Type', 'Date', 'Customer', 'TIN', 'Total (RM)', 'e-Invoice', 'Waiting since', 'Days waiting', 'To fix'],
    ...r.rows.map((x) => [x.docNo, x.typeLabel, x.docDate, x.customerName, x.tin ?? '', x.total, x.stateLabel, x.since, x.days, x.problem ?? '']),
  ])
}
</script>

<template>
  <PageHeader title="e-Invoice status" subtitle="Every document that needs an LHDN e-Invoice, and where it stands, so nothing waits unseen.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">
        {{ report.period === 'all' ? 'All months' : formatMonthYear(report.period) }}
      </span>
    </template>
    <template #actions><ReportActions :can-export="Boolean(report)" @export="exportCsv" /></template>
  </PageHeader>

  <NoticeBanner v-if="report && !report.connected" kind="warning">
    LHDN is not connected yet. Each e-Invoice is saved with its document and is submitted once LHDN is connected. Nothing has been sent.
  </NoticeBanner>

  <div class="grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] gap-3 print:hidden max-lg:grid-cols-2">
    <FilterSelect label="Period" all="all months" :model-value="filters.period === 'all' ? '' : (filters.period ?? '')" :options="options.periods" @update:model-value="setFilter('period', $event)" />
    <FilterSelect label="Branch" all="all" :model-value="filters.branch ?? ''" :options="options.branches" @update:model-value="setFilter('branch', $event)" />
    <FilterSelect label="Type" all="all" :model-value="filters.type ?? ''" :options="TYPES" @update:model-value="setFilter('type', $event)" />
    <FilterSelect label="Show" :model-value="filters.show ?? ''" :options="SHOW" @update:model-value="setFilter('show', $event)" />
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard
      label="Waiting for LHDN"
      tone="warning"
      :value="report ? report.kpis.waiting.count : '—'"
      :sub="report ? (report.kpis.waiting.count ? `${formatRm(report.kpis.waiting.amount)} · oldest ${plural(report.kpis.waiting.oldestDays, 'day', 'days')}` : 'Nothing waiting') : ''"
      :loading="loading && !report"
    />
    <KpiCard label="Submitted" :value="report ? report.kpis.submitted.count : '—'" sub="Once LHDN is connected" :loading="loading && !report" />
    <KpiCard
      label="Would be refused"
      :tone="report?.kpis.problems.count ? 'danger' : 'default'"
      :value="report ? report.kpis.problems.count : '—'"
      :sub="report ? (report.kpis.problems.count ? 'A TIN is missing, or it could not be sent' : 'Nothing to fix') : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Consolidated e-Invoice"
      :value="report?.kpis.consolidated ? plural(report.kpis.consolidated.count, 'cash sale', 'cash sales') : '—'"
      :sub="report?.kpis.consolidated ? `${formatMonthName(report.kpis.consolidated.month)} · ${formatRm(report.kpis.consolidated.amount)} · due ${formatDayMonth(report.kpis.consolidated.due)}` : 'No cash sales'"
      :loading="loading && !report"
    />
  </div>

  <section v-if="report" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <h2 class="m-0 text-[15px] font-bold">Documents</h2>
    <div class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr><th>Document</th><th>Date</th><th>Customer</th><th>TIN</th><th class="num">Total (RM)</th><th>e-Invoice</th><th class="num">Waiting</th><th>To fix</th></tr>
        </thead>
        <tbody>
          <tr v-if="!report.rows.length"><td colspan="8" class="text-erp-muted">Nothing is waiting for LHDN.</td></tr>
          <tr v-for="r in report.rows" :key="r.id">
            <td class="whitespace-nowrap">
              <RouterLink :to="r.to" class="erp-link font-semibold">{{ r.docNo }}</RouterLink>
              <span class="block text-xs text-erp-muted">{{ r.typeLabel }}</span>
            </td>
            <td class="whitespace-nowrap">{{ formatDayMonth(r.docDate) }}</td>
            <td>{{ r.customerName }}</td>
            <td class="whitespace-nowrap">{{ r.tin ?? '—' }}</td>
            <td class="num"><MoneyText :value="r.total" /></td>
            <td><StatusChip :status="r.state" :label="r.stateLabel" :group="STATE_GROUP[r.state]" /></td>
            <td class="num whitespace-nowrap">{{ r.state === 'SUBMITTED' ? '—' : plural(r.days, 'day', 'days') }}</td>
            <td :class="r.problem ? 'font-semibold text-note-error-text' : 'text-erp-muted'">{{ r.problem ?? 'Nothing' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="report" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <h2 class="m-0 text-[15px] font-bold">Consolidated e-Invoices for cash sales</h2>
    <table class="erp-table">
      <thead><tr><th>Month</th><th class="num">Cash sales</th><th class="num">Amount (RM)</th><th>Due</th><th>e-Invoice</th></tr></thead>
      <tbody>
        <tr v-if="!report.consolidated.length"><td colspan="5" class="text-erp-muted">No cash sales without their own e-Invoice.</td></tr>
        <tr v-for="c in report.consolidated" :key="c.month">
          <td>{{ formatMonthYear(c.month) }}</td>
          <td class="num">{{ c.count }}</td>
          <td class="num"><MoneyText :value="c.amount" /></td>
          <td class="whitespace-nowrap">{{ formatDayMonth(c.due) }}</td>
          <td>
            <StatusChip v-if="c.late" status="LATE" label="Late · not submitted" group="cancelled" />
            <StatusChip v-else status="WAITING" label="Waiting for LHDN" group="pending" />
          </td>
        </tr>
      </tbody>
    </table>
    <p class="m-0 text-xs text-erp-muted">{{ report.footnote }}</p>
  </section>
</template>
