<script setup lang="ts">
import { computed } from 'vue'
import FilterSelect from '@/components/erp/FilterSelect.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import ReportActions from '@/components/erp/ReportActions.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useReport } from '@/composables/useReport'
import { downloadCsv } from '@/utils/csv'
import { formatDayMonth, formatMonthYear, formatRm } from '@/utils/format'
import { salesReportsApi } from '../api/sales'
import type { EInvoiceState, PaymentKey } from '../types'

/** S05 · Invoice register: the invoices, debit notes and credit notes released in a month. */
const { data: report, loading, filters, setFilter } = useReport(['period', 'branch', 'agent', 'group', 'type'], salesReportsApi.invoiceRegister)

const TYPES = [
  { value: 'invoice', label: 'Invoices' },
  { value: 'debit-note', label: 'Debit notes' },
  { value: 'credit-note', label: 'Credit notes' },
]
// As the Invoices list (S17) colours them.
const PAYMENT_GROUP: Record<PaymentKey, 'draft' | 'pending' | 'released' | 'done' | 'cancelled'> = { DRAFT: 'draft', PENDING: 'pending', UNPAID: 'released', OVERDUE: 'cancelled', PAID: 'done' }
const EINVOICE_GROUP: Record<EInvoiceState, 'draft' | 'pending' | 'done' | 'cancelled'> = { WAITING: 'pending', SUBMITTED: 'done', FAILED: 'cancelled', OLD_SYSTEM: 'draft' }

const options = computed(() => {
  const f = report.value?.filters
  return {
    periods: (report.value?.periods ?? []).map((p) => ({ value: p, label: formatMonthYear(p) })),
    branches: (f?.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
    agents: (f?.agents ?? []).map((a) => ({ value: a.code, label: a.name })),
    groups: (f?.groups ?? []).map((g) => ({ value: g, label: g })),
  }
})
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`invoice-register-${r.period}.csv`, [
    ['Date', 'Document', 'Type', 'Customer', 'Reference', 'Before tax (RM)', 'Tax (RM)', 'Total (RM)', 'Balance due (RM)', 'Due', 'Payment', 'e-Invoice'],
    ...r.rows.map((x) => [x.docDate, x.docNo, x.typeLabel, x.customerName, x.reference ?? '', x.beforeTax, x.tax, x.total, x.balance ?? '', x.dueDate ?? '', x.payment?.label ?? '', x.eInvoice?.label ?? '']),
    ['Total', '', '', '', '', r.totals.beforeTax, r.totals.tax, r.totals.total, '', '', '', ''],
  ])
}
</script>

<template>
  <PageHeader title="Invoice register" subtitle="Invoices, debit notes and credit notes released in the month, with what is still owed on each invoice.">
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
    <FilterSelect label="Type" all="all" :model-value="filters.type ?? ''" :options="TYPES" @update:model-value="setFilter('type', $event)" />
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard
      label="Invoiced"
      :value="report ? formatRm(report.kpis.invoiced.amount) : '—'"
      :sub="report ? plural(report.kpis.invoiced.count, 'invoice', 'invoices') : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Debit notes"
      :value="report ? formatRm(report.kpis.debitNotes.amount) : '—'"
      :sub="report ? plural(report.kpis.debitNotes.count, 'debit note', 'debit notes') : ''"
      :loading="loading && !report"
    />
    <KpiCard
      label="Credit notes"
      tone="danger"
      :value="report ? formatRm(report.kpis.credited.amount) : '—'"
      :sub="report ? plural(report.kpis.credited.count, 'sales return', 'sales returns') : ''"
      :loading="loading && !report"
    />
    <div class="erp-card flex flex-col gap-1 border-mod-light-border bg-mod-light px-5 py-4">
      <span class="text-[13px] font-semibold text-mod-accent">Net billed</span>
      <span class="text-[22px] font-bold text-mod-accent">{{ report ? formatRm(report.kpis.net.amount) : '—' }}</span>
      <span class="text-xs text-mod-accent">Invoices and debit notes, less credit notes</span>
    </div>
  </div>

  <section v-if="report" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <h2 class="m-0 text-[15px] font-bold">Register</h2>
    <div class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Document</th>
            <th>Customer</th>
            <th>Reference</th>
            <th class="num">Before tax</th>
            <th class="num">Tax</th>
            <th class="num">Total (RM)</th>
            <th class="num">Balance due</th>
            <th>Payment</th>
            <th>e-Invoice</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!report.rows.length"><td colspan="10" class="text-erp-muted">Nothing released in this period.</td></tr>
          <tr v-for="r in report.rows" :key="r.id">
            <td class="whitespace-nowrap">{{ formatDayMonth(r.docDate) }}</td>
            <td class="whitespace-nowrap">
              <RouterLink v-if="r.to" :to="r.to" class="erp-link font-semibold">{{ r.docNo }}</RouterLink>
              <span v-else class="font-semibold">{{ r.docNo }}</span>
              <span class="block text-xs text-erp-muted">{{ r.typeLabel }}</span>
            </td>
            <td>{{ r.customerName }}</td>
            <td class="whitespace-nowrap">{{ r.reference ?? '—' }}</td>
            <td class="num"><MoneyText :value="r.beforeTax" /></td>
            <td class="num"><MoneyText :value="r.tax" /></td>
            <td class="num font-semibold"><MoneyText :value="r.total" /></td>
            <td class="num">
              <template v-if="r.balance !== null"><MoneyText :value="r.balance" /><span v-if="r.dueDate" class="block text-[11px] text-erp-muted">due {{ formatDayMonth(r.dueDate) }}</span></template>
              <span v-else class="text-erp-muted">—</span>
            </td>
            <td><StatusChip v-if="r.payment" :status="r.payment.key" :label="r.payment.label" :group="PAYMENT_GROUP[r.payment.key]" /></td>
            <td><StatusChip v-if="r.eInvoice" :status="r.eInvoice.state" :label="r.eInvoice.label" :group="EINVOICE_GROUP[r.eInvoice.state]" /></td>
          </tr>
          <tr v-if="report.rows.length" class="bg-erp-head font-bold">
            <td colspan="4">Total · {{ plural(report.rows.length, 'document', 'documents') }}</td>
            <td class="num"><MoneyText :value="report.totals.beforeTax" /></td>
            <td class="num"><MoneyText :value="report.totals.tax" /></td>
            <td class="num"><MoneyText :value="report.totals.total" /></td>
            <td colspan="3" />
          </tr>
        </tbody>
      </table>
    </div>
    <p v-for="n in report.notes" :key="n" class="m-0 text-xs text-erp-muted">{{ n }}</p>
    <p class="m-0 text-xs text-erp-muted">{{ report.footnote }}</p>
  </section>
</template>
