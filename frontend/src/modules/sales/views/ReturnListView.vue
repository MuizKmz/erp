<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatRm } from '@/utils/format'
import { salesReturnsApi } from '../api/sales'
import type { ReturnListItem } from '../types'

/** S27 · List of Sales Return (SalesReturnList.html) */
const router = useRouter()
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'invoice', 'reason'], fetch: salesReturnsApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const kpis = computed(() => list.data.value?.kpis)
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
]

const customerText = ref(list.params.value.customer ?? '')
const invoiceText = ref(list.params.value.invoice ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch([customerText, invoiceText], ([c, i]) => {
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilters({ customer: c.trim() || undefined, invoice: i.trim() || undefined }), 350)
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
const footer = computed(() => {
  const d = list.data.value
  return d ? `${d.total} ${d.total === 1 ? 'return' : 'returns'} · ${d.units} units back` : ''
})
const maxUnits = computed(() => Math.max(1, ...(kpis.value?.wentTo.map((w) => Number(w.units)) ?? [1])) * 1.35)

// ── New return: pick the invoice ─────────────────────────────────────────────
const pickOpen = ref(false)
const search = ref('')
const invoices = ref<{ id: string; docNo: string; docDate: string; customerName: string; total: string; isMigrated: boolean }[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined
async function findInvoices() {
  invoices.value = (await salesReturnsApi.invoices(search.value)).items
}
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(findInvoices, 300)
})
async function openPick() {
  search.value = ''
  await findInvoices()
  pickOpen.value = true
}

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of returns comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: ReturnListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesReturnsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['SR no', 'Date', 'Customer', 'From invoice', 'What', 'Reason', 'Goods went to', 'Credit (RM)', 'Status'].map(cell).join(','),
    ...all.map((r) => [r.docNo, r.docDate, r.customerName, r.invoiceNo, r.summary ?? '', r.reason, r.goodsToLabel, r.total, r.status === 'DRAFT' ? 'Draft' : 'Released'].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `sales-returns-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <div class="grid grid-cols-4 gap-4">
      <KpiCard label="Credited this month" :value="kpis ? formatRm(kpis.credited.amount) : '—'" :sub="kpis ? `${kpis.credited.count} returns released` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Draft" tone="warning" :value="kpis?.drafts.count ?? '—'" :sub="kpis?.drafts.first ?? 'None'" :loading="list.loading.value && !kpis" />
      <KpiCard label="Top reason" :value="kpis?.topReason?.reason ?? '—'" :sub="kpis?.topReason ? `${kpis.topReason.units} of ${kpis.topReason.of} units` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Credit notes for LHDN" tone="warning" :value="kpis ? `${kpis.creditNotesQueued} queued` : '—'" sub="Sent when e-Invoice plugs in" :loading="list.loading.value && !kpis" />
    </div>

    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Sales Return" subtitle="Goods the customer sends back after delivery. Each return credits the original invoice.">
        <template #actions>
          <button v-if="can('sales.return.edit')" type="button" class="erp-btn erp-btn-add" @click="openPick"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New return</button>
          <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
          <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        </template>
      </PageHeader>

      <FilterBar>
        <input v-model="customerText" class="erp-input" placeholder="Filter by customer" aria-label="Filter by customer" />
        <input v-model="invoiceText" class="erp-input" placeholder="Filter by invoice no" aria-label="Filter by invoice no" />
        <select class="erp-input" aria-label="Filter by reason" :value="list.params.value.reason" @change="list.setFilter('reason', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by reason</option>
          <option v-for="r in list.data.value?.reasons ?? []" :key="r" :value="r">{{ r }}</option>
        </select>
        <DatePicker v-model="dateRange" selection-mode="range" date-format="d M yy" :placeholder="datePlaceholder" :manual-input="false" show-button-bar fluid class="erp-date" @update:model-value="onDateRange" @clear-click="onDateRange(null)" />
      </FilterBar>

      <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No returns match these filters.">
        <Column header="SR no">
          <template #body="{ data }: { data: ReturnListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/returns/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: ReturnListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Customer" field="customerName" />
        <Column header="From invoice">
          <template #body="{ data }: { data: ReturnListItem }">
            <RouterLink v-if="data.invoiceId" :to="`/sales/invoices/${data.invoiceId}`" class="erp-link whitespace-nowrap">{{ data.invoiceNo }}</RouterLink>
            <span v-else class="whitespace-nowrap">{{ data.invoiceNo }}</span>
          </template>
        </Column>
        <Column header="What" field="summary" />
        <Column header="Reason" field="reason" />
        <Column header="Goods went to" field="goodsToLabel" />
        <Column header="Credit (RM)" class="erp-col-num">
          <template #body="{ data }: { data: ReturnListItem }"><MoneyText :value="data.total" /></template>
        </Column>
        <Column header="Status">
          <template #body="{ data }: { data: ReturnListItem }">
            <StatusChip :status="data.status" :label="data.status === 'DRAFT' ? 'Draft' : 'Released'" :group="data.status === 'DRAFT' ? 'draft' : 'done'" />
          </template>
        </Column>
      </DataList>

      <div class="mt-auto flex items-center justify-between pt-2">
        <span class="text-xs text-erp-muted">{{ footer }}</span>
        <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
      </div>
    </section>

    <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_360px]">
      <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
        <h2 class="m-0 text-[15px] font-bold">Where returned goods went</h2>
        <p v-if="!kpis?.wentTo.length" class="m-0 text-[13px] text-erp-muted">No returns this month.</p>
        <div v-for="w in kpis?.wentTo ?? []" :key="w.label" class="flex flex-col gap-1.5">
          <div class="flex justify-between text-[13px]"><span>{{ w.label }}</span><strong>{{ w.units }} units</strong></div>
          <div class="h-2 overflow-hidden rounded bg-erp-track"><div class="h-full rounded bg-mod-primary" :style="{ width: `${(Number(w.units) / maxUnits) * 100}%` }" /></div>
        </div>
      </section>
      <NextSteps title="Return or cancel?">
        <li><span><strong>Return</strong> goods that were delivered and invoiced.</span></li>
        <li><span><strong>Cancel</strong> the balance that was never delivered.</span></li>
        <template #footer><RouterLink to="/sales/cancel-orders" class="erp-link text-[13px] font-semibold">Go to Cancel Order →</RouterLink></template>
      </NextSteps>
    </div>

    <Dialog v-model:visible="pickOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '540px' }" header="New return">
      <p class="m-0 mb-3 text-[13px] text-erp-subtle">A return always comes from one released invoice. Find it by number or customer.</p>
      <input v-model="search" class="erp-input mb-3 w-full" placeholder="Invoice no or customer" aria-label="Find the invoice" />
      <p v-if="!invoices.length" class="m-0 text-[13px] text-erp-muted">No released invoice with something left to return.</p>
      <div class="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
        <button
          v-for="i in invoices"
          :key="i.id"
          type="button"
          class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-erp-border bg-erp-card px-3.5 py-2.5 text-left text-[13px] hover:bg-erp-head"
          @click="router.push(`/sales/returns/new?invoice=${i.id}`)"
        >
          <span><span class="font-semibold">{{ i.docNo }}</span> · {{ i.customerName }}<span class="block text-xs text-erp-muted">{{ formatDate(i.docDate) }}{{ i.isMigrated ? ' · migrated' : '' }}</span></span>
          <span class="erp-num text-xs font-semibold whitespace-nowrap">RM {{ formatMoney(i.total) }}</span>
        </button>
      </div>
    </Dialog>
  </div>
</template>
