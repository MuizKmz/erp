<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { Clock } from '@lucide/vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import { useSession } from '@/composables/useSession'
import { formatRm } from '@/utils/format'
import { salesReportsApi } from '../api/sales'
import type { SalesByCustomerReport } from '../types'

/** S05 · Sales by customer (SalesReports.html). Filters live in the URL so back and refresh keep them. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { today } = useSession()

const report = ref<SalesByCustomerReport | null>(null)
const loading = ref(false)
const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = computed(() => ({ period: q('period'), branch: q('branch'), agent: q('agent'), group: q('group') }))

async function load() {
  loading.value = true
  try {
    const f = filters.value
    report.value = await salesReportsApi.byCustomer({ period: f.period || undefined, branch: f.branch || undefined, agent: f.agent || undefined, group: f.group || undefined })
  } finally {
    loading.value = false
  }
}
watch(filters, load, { immediate: true })
function setFilter(key: string, value: string) {
  void router.replace({ query: { ...route.query, [key]: value || undefined } })
}

const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const maxOrdered = computed(() => Math.max(1, ...(report.value?.rows.map((r) => Number(r.ordered)) ?? [1])))
const pct = (v: string) => `${(Number(v) / maxOrdered.value) * 100}%`

const printPage = () => window.print()
function later(what: string) {
  toast.add({ severity: 'info', summary: what, detail: 'This comes later with scheduled reports.', life: 3000 })
}
function exportCsv() {
  const r = report.value
  if (!r) return
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Customer', 'Orders', 'Ordered (RM)', 'Invoiced (RM)', 'Cancelled (RM)', 'Open (RM)', 'Share %'].map(cell).join(','),
    ...r.rows.map((x) => [x.customerName, String(x.orders), x.ordered, x.invoiced, x.cancelled, x.open, x.sharePct].map(cell).join(',')),
    ['Total', String(r.totals.orders), r.totals.ordered, r.totals.invoiced, r.totals.cancelled, r.totals.open, '100'].map(cell).join(','),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `sales-by-customer-${r.period}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <PageHeader title="Sales by customer" subtitle="Ordered, invoiced and still open, per customer. Cancelled balances are left out of “open”.">
    <template #chip>
      <span v-if="report" class="rounded-xl bg-chip-released-bg px-2.5 py-[3px] text-xs font-semibold text-chip-released-text">{{ monthName(report.period) }}</span>
    </template>
    <template #actions>
      <button type="button" class="erp-btn erp-btn-secondary" @click="later('Schedule email')"><Clock :size="14" aria-hidden="true" />Schedule email</button>
      <button type="button" class="erp-btn erp-btn-secondary" @click="printPage">PDF</button>
      <button type="button" class="erp-btn erp-btn-export" :disabled="!report" @click="exportCsv">Export to Excel</button>
    </template>
  </PageHeader>

  <div class="grid grid-cols-5 gap-3 print:hidden">
    <select class="erp-input" aria-label="Period" :value="filters.period || report?.period" @change="setFilter('period', ($event.target as HTMLSelectElement).value)">
      <option v-for="p in report?.periods ?? [today.slice(0, 7)]" :key="p" :value="p">Period: {{ monthName(p) }}</option>
    </select>
    <select class="erp-input" aria-label="Branch" :value="filters.branch" @change="setFilter('branch', ($event.target as HTMLSelectElement).value)">
      <option value="">Branch: all</option>
      <option v-for="b in report?.filters.branches ?? []" :key="b.code" :value="b.code">Branch: {{ b.name }}</option>
    </select>
    <select class="erp-input" aria-label="Sales agent" :value="filters.agent" @change="setFilter('agent', ($event.target as HTMLSelectElement).value)">
      <option value="">Sales agent: all</option>
      <option v-for="a in report?.filters.agents ?? []" :key="a.code" :value="a.code">Sales agent: {{ a.name }}</option>
    </select>
    <select class="erp-input" aria-label="Customer group" :value="filters.group" @change="setFilter('group', ($event.target as HTMLSelectElement).value)">
      <option value="">Customer group: all</option>
      <option v-for="g in report?.filters.groups ?? []" :key="g" :value="g">Customer group: {{ g }}</option>
    </select>
    <select class="erp-input" aria-label="Compare" disabled><option>Compare: none</option></select>
  </div>

  <div class="grid grid-cols-4 gap-4">
    <KpiCard label="Ordered" :value="report ? formatRm(report.kpis.ordered.amount) : '—'" :sub="report ? `${report.kpis.ordered.orders} sales orders` : ''" :loading="loading && !report" />
    <div class="erp-card flex flex-col gap-1 border-mod-light-border bg-mod-light px-5 py-4">
      <span class="text-[13px] font-semibold text-mod-accent">Invoiced</span>
      <span class="text-[22px] font-bold text-mod-accent">{{ report ? formatRm(report.kpis.invoiced.amount) : '—' }}</span>
      <span class="text-xs text-mod-accent">{{ report ? `${report.kpis.invoiced.pct}% of ordered` : '' }}</span>
    </div>
    <KpiCard label="Cancelled" tone="danger" :value="report ? formatRm(report.kpis.cancelled.amount) : '—'" :sub="report?.kpis.cancelled.docs.join(', ') || 'Nothing cancelled'" :loading="loading && !report" />
    <KpiCard label="Still open" :value="report ? formatRm(report.kpis.open.amount) : '—'" sub="To deliver and invoice" :loading="loading && !report" />
  </div>

  <div v-if="report" class="grid grow items-start gap-4 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">Ordered by customer (RM)</h2>
        <span class="flex items-center gap-3 text-xs text-erp-subtle">
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-mod-primary" />Invoiced</span>
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-mod-light-border" />Ordered</span>
        </span>
      </div>
      <p v-if="!report.rows.length" class="m-0 text-[13px] text-erp-muted">No sales orders in this period.</p>
      <div v-for="r in report.rows" :key="r.customerCode" class="grid grid-cols-[minmax(0,1fr)_84px_92px] items-center gap-3 text-[13px]">
        <span class="truncate">{{ r.customerName }}</span>
        <span class="relative h-4 overflow-hidden rounded bg-erp-head" role="img" :aria-label="`${r.customerName}: ordered ${r.ordered}, invoiced ${r.invoiced}`">
          <span class="absolute inset-y-0 left-0 bg-mod-light-border" :style="{ width: pct(r.ordered) }" />
          <span class="absolute inset-y-0 left-0 bg-mod-primary" :style="{ width: pct(r.invoiced) }" />
        </span>
        <span class="text-right"><MoneyText :value="r.ordered" /></span>
      </div>
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
