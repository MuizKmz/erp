<script setup lang="ts">
import { computed } from 'vue'
import BarRows from '@/components/erp/BarRows.vue'
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
import type { QuoteOutcome } from '../types'

/** S05 · Quotation conversion: the quotations sent in a month and how they ended up. */
const { data: report, loading, filters, setFilter } = useReport(['period', 'branch', 'agent', 'group'], salesReportsApi.quotationConversion)

const OUTCOME_GROUP: Record<QuoteOutcome, 'draft' | 'released' | 'done' | 'cancelled'> = { WON: 'done', OPEN: 'released', EXPIRED: 'draft', LOST: 'cancelled' }

const options = computed(() => {
  const f = report.value?.filters
  return {
    periods: (report.value?.periods ?? []).map((p) => ({ value: p, label: formatMonthYear(p) })),
    branches: (f?.branches ?? []).map((b) => ({ value: b.code, label: b.name })),
    agents: (f?.agents ?? []).map((a) => ({ value: a.code, label: a.name })),
    groups: (f?.groups ?? []).map((g) => ({ value: g, label: g })),
  }
})
const chart = computed(() =>
  (report.value?.outcomes ?? []).filter((o) => o.count > 0).map((o) => ({ key: o.key, label: o.label, value: o.amount, sub: `${o.count} ${o.count === 1 ? 'quotation' : 'quotations'}` })),
)
const openSub = computed(() => {
  const k = report.value?.kpis.open
  if (!k) return ''
  const soon = k.expiringSoon.length ? `${k.expiringSoon.join(', ')} ${k.expiringSoon.length === 1 ? 'expires' : 'expire'} within 3 days` : 'none expiring soon'
  return `${formatRm(k.amount)} · ${soon}`
})

/** What the outcome column says after the chip: the order, the reason, or until when it is valid. */
function outcomeNote(r: NonNullable<typeof report.value>['rows'][number]): string {
  if (r.outcome === 'WON') return r.salesOrderNo ? `${r.salesOrderNo}${r.daysToOrder !== null ? ` · ${r.daysToOrder} ${r.daysToOrder === 1 ? 'day' : 'days'}` : ''}` : ''
  if (r.outcome === 'LOST') return r.lostReason ?? ''
  if (r.validUntil) return `${r.outcome === 'EXPIRED' ? 'Expired' : 'Valid until'} ${formatDayMonth(r.validUntil)}`
  return ''
}

function exportCsv() {
  const r = report.value
  if (!r) return
  downloadCsv(`quotation-conversion-${r.period}.csv`, [
    ['Quotation', 'Revision', 'Date', 'Valid until', 'Customer', 'Sales agent', 'Total (RM)', 'Outcome', 'Sales order', 'Days to order', 'Lost reason', 'From the old system'],
    ...r.rows.map((x) => [x.docNo, x.revision, x.docDate, x.validUntil ?? '', x.customerName, x.agentName, x.total, x.outcomeLabel, x.salesOrderNo ?? '', x.daysToOrder ?? '', x.lostReason ?? '', x.isMigrated ? 'Yes' : '']),
  ])
}
</script>

<template>
  <PageHeader title="Quotation conversion" subtitle="Quotations sent in the month, and how many turned into sales orders.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">{{ formatMonthYear(report.period) }}</span>
    </template>
    <template #actions><ReportActions :can-export="Boolean(report)" @export="exportCsv" /></template>
  </PageHeader>

  <div class="grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] gap-3 print:hidden max-lg:grid-cols-2">
    <FilterSelect label="Period" :model-value="filters.period || report?.period || ''" :options="options.periods" @update:model-value="setFilter('period', $event)" />
    <FilterSelect label="Branch" all="all" :model-value="filters.branch ?? ''" :options="options.branches" @update:model-value="setFilter('branch', $event)" />
    <FilterSelect label="Sales agent" all="all" :model-value="filters.agent ?? ''" :options="options.agents" @update:model-value="setFilter('agent', $event)" />
    <FilterSelect label="Customer group" all="all" :model-value="filters.group ?? ''" :options="options.groups" @update:model-value="setFilter('group', $event)" />
  </div>

  <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
    <KpiCard
      label="Sent"
      :value="report ? report.kpis.sent.count : '—'"
      :sub="report ? `${formatRm(report.kpis.sent.amount)} quoted` : ''"
      :loading="loading && !report"
    />
    <div class="erp-card flex flex-col gap-1 border-mod-light-border bg-mod-light px-5 py-4">
      <span class="text-[13px] font-semibold text-mod-accent">Turned into order</span>
      <span class="text-[22px] font-bold text-mod-accent">{{ report ? `${report.kpis.won.pct}%` : '—' }}</span>
      <span class="text-xs text-mod-accent">
        {{ report ? `${report.kpis.won.count} of ${report.kpis.sent.count} · ${formatRm(report.kpis.won.amount)} (${report.kpis.won.valuePct}% of value)` : '' }}
      </span>
    </div>
    <KpiCard
      label="Lost"
      tone="danger"
      :value="report ? report.kpis.lost.count : '—'"
      :sub="report ? (report.kpis.lost.count ? `${formatRm(report.kpis.lost.amount)} · ${report.kpis.lost.topReason}` : 'Nothing lost') : ''"
      :loading="loading && !report"
    />
    <KpiCard label="Still open" :value="report ? report.kpis.open.count : '—'" :sub="openSub" :loading="loading && !report" />
  </div>

  <div v-if="report" class="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-4 max-lg:grid-cols-1">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">How they ended up (RM)</h2>
      <BarRows :rows="chart" empty="No quotations sent in this period." />
      <p v-if="report.kpis.won.avgDays !== null" class="m-0 text-xs text-erp-muted">
        On average {{ report.kpis.won.avgDays }} days from quotation to sales order.
      </p>

      <h2 class="m-0 mt-2 text-[15px] font-bold">Why we lost</h2>
      <p v-if="!report.reasons.length" class="m-0 text-[13px] text-erp-muted">Nothing lost in this period.</p>
      <table v-else class="erp-table">
        <thead><tr><th>Reason</th><th class="num">Quotations</th><th class="num">Value (RM)</th></tr></thead>
        <tbody>
          <tr v-for="x in report.reasons" :key="x.reason">
            <td>{{ x.reason }}</td>
            <td class="num">{{ x.count }}</td>
            <td class="num"><MoneyText :value="x.amount" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">By sales agent</h2>
      <table class="erp-table">
        <thead>
          <tr><th>Agent</th><th class="num">Sent</th><th class="num">Turned into order</th><th class="num">Open</th><th class="num">Expired</th><th class="num">Lost</th><th class="num">Rate</th></tr>
        </thead>
        <tbody>
          <tr v-if="!report.agents.length"><td colspan="7" class="text-erp-muted">No quotations sent in this period.</td></tr>
          <tr v-for="a in report.agents" :key="a.agentCode">
            <td>{{ a.agentName }}</td>
            <td class="num">{{ a.sent }}</td>
            <td class="num">{{ a.won }} · <MoneyText :value="a.wonAmount" /></td>
            <td class="num">{{ a.open }}</td>
            <td class="num">{{ a.expired }}</td>
            <td class="num">{{ a.lost }}</td>
            <td class="num font-bold">{{ a.pct }}%</td>
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
          <tr><th>Quotation</th><th>Date</th><th>Customer</th><th>Agent</th><th class="num">Total (RM)</th><th>Outcome</th><th /></tr>
        </thead>
        <tbody>
          <tr v-if="!report.rows.length"><td colspan="7" class="text-erp-muted">No quotations sent in this period.</td></tr>
          <tr v-for="r in report.rows" :key="r.id">
            <td class="whitespace-nowrap">
              <RouterLink v-if="!r.isMigrated" :to="`/sales/quotations/${r.id}`" class="erp-link font-semibold">{{ r.docNo }}</RouterLink>
              <span v-else class="font-semibold">{{ r.docNo }}</span>
              <span v-if="r.revision" class="ml-1 text-xs text-erp-muted">rev {{ r.revision }}</span>
              <span v-if="r.isMigrated" class="ml-1 text-xs text-erp-muted">· old system</span>
            </td>
            <td class="whitespace-nowrap">{{ formatDayMonth(r.docDate) }}</td>
            <td>{{ r.customerName }}</td>
            <td>{{ r.agentName }}</td>
            <td class="num"><MoneyText :value="r.total" /></td>
            <td><StatusChip :status="r.outcome" :label="r.outcomeLabel" :group="OUTCOME_GROUP[r.outcome]" /></td>
            <td class="text-xs" :class="r.expiresSoon ? 'font-semibold text-attention' : 'text-erp-muted'">{{ outcomeNote(r) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="m-0 text-xs text-erp-muted">{{ report.footnote }}</p>
  </section>
</template>
