<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatRm } from '@/utils/format'
import { salesCashSalesApi } from '../api/sales'
import type { CashListItem } from '../types'

/** S23 · List of Cash Sales (CashSaleList.html) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['buyer', 'method', 'counter'], fetch: salesCashSalesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const kpis = computed(() => list.data.value?.kpis)
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
]

const buyerText = ref(list.params.value.buyer ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch(buyerText, (b) => {
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('buyer', b.trim()), 350)
})
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateRange = ref<Date[] | null>(
  list.params.value.dateFrom && list.params.value.dateTo
    ? [new Date(`${list.params.value.dateFrom}T00:00`), new Date(`${list.params.value.dateTo}T00:00`)]
    : null,
)
function onDateRange(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const [from, to] = Array.isArray(value) ? value : []
  if (!value || (from && to)) list.setFilters({ dateFrom: from ? isoDay(from) : undefined, dateTo: to ? isoDay(to) : undefined })
}
const datePlaceholder = computed(() => (today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date'))
const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} cash sales`
})
const todaySub = computed(() => {
  const t = kpis.value?.today
  if (!t) return ''
  return `${t.count} ${t.count === 1 ? 'sale' : 'sales'}${t.drafts.length ? ` · ${t.drafts.join(', ')} draft` : ''}`
})
const paidByTop = computed(() => kpis.value?.paidBy[0] ?? null)
const paidByRest = computed(() => kpis.value?.paidBy.slice(1).map((p) => `${p.label.replace(' QR', '')} ${p.pct}%`).join(' · ') ?? '')
const dueText = computed(() => (kpis.value ? `Due ${formatDate(kpis.value.consolidated.due).split(' ').slice(0, 2).join(' ')} · sent when e-Invoice plugs in` : ''))

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of cash sales comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: CashListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesCashSalesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['CS no', 'Date', 'Buyer', 'What', 'Paid by', 'Total (RM)', 'E-invoice', 'Status'].map(cell).join(','),
    ...all.map((c) => [c.docNo, c.docDate, c.buyer, c.summary ?? '', c.paidBy, c.total, c.eInvoice, c.status === 'DRAFT' ? 'Draft' : 'Released'].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `cash-sales-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <div class="grid grid-cols-4 gap-4">
      <KpiCard label="Today at the counter" :value="kpis ? formatRm(kpis.today.amount) : '—'" :sub="todaySub" :loading="list.loading.value && !kpis" />
      <KpiCard :label="kpis?.month.name ?? 'This month'" :value="kpis ? formatRm(kpis.month.amount) : '—'" :sub="kpis ? `${kpis.month.count} cash sales` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Paid by" :value="paidByTop ? `${paidByTop.label.replace(' QR', '')} ${paidByTop.pct}%` : '—'" :sub="paidByRest" :loading="list.loading.value && !kpis" />
      <KpiCard label="Consolidated e-Invoice" tone="warning" :value="kpis ? `${kpis.consolidated.count} sales` : '—'" :sub="dueText" :loading="list.loading.value && !kpis" />
    </div>

    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Cash Sales" subtitle="Walk-in sales paid on the spot. One document records the sale, the payment and the stock going out.">
        <template #actions>
          <RouterLink v-if="can('sales.cash_sale.edit')" to="/sales/cash-sales/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New cash sale</RouterLink>
          <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
          <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        </template>
      </PageHeader>

      <FilterBar>
        <input v-model="buyerText" class="erp-input" placeholder="Filter by buyer" aria-label="Filter by buyer" />
        <select class="erp-input" aria-label="Filter by payment" :value="list.params.value.method" @change="list.setFilter('method', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by payment</option>
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="DUITNOW">DuitNow QR</option>
          <option value="TRANSFER">Bank transfer</option>
        </select>
        <select class="erp-input" aria-label="Filter by counter" :value="list.params.value.counter" @change="list.setFilter('counter', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by counter</option>
          <option v-for="c in list.data.value?.counters ?? []" :key="c" :value="c">{{ c }}</option>
        </select>
        <DatePicker v-model="dateRange" selection-mode="range" date-format="d M yy" :placeholder="datePlaceholder" :manual-input="false" show-button-bar fluid class="erp-date" @update:model-value="onDateRange" @clear-click="onDateRange(null)" />
      </FilterBar>

      <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No cash sales match these filters.">
        <Column header="CS no">
          <template #body="{ data }: { data: CashListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/cash-sales/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: CashListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Buyer" field="buyer" />
        <Column header="What" field="summary" />
        <Column header="Paid by" field="paidBy" />
        <Column header="Total (RM)" class="erp-col-num">
          <template #body="{ data }: { data: CashListItem }"><MoneyText :value="data.total" /></template>
        </Column>
        <Column header="E-invoice">
          <template #body="{ data }: { data: CashListItem }">
            <span :class="data.ownPending ? 'font-semibold text-attention' : 'text-erp-subtle'">{{ data.eInvoice }}</span>
          </template>
        </Column>
        <Column header="Status">
          <template #body="{ data }: { data: CashListItem }">
            <StatusChip :status="data.status" :label="data.status === 'DRAFT' ? 'Draft' : 'Released'" :group="data.status === 'DRAFT' ? 'draft' : 'done'" />
          </template>
        </Column>
      </DataList>

      <div class="mt-auto flex items-center justify-between pt-2">
        <span class="text-xs text-erp-muted">{{ showing }}</span>
        <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
      </div>
    </section>
  </div>
</template>
