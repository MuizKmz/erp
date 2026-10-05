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
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatRm } from '@/utils/format'
import { salesProformasApi } from '../api/sales'
import type { ProformaListItem, ProformaStatus } from '../types'

/** S21 · List of Proforma Invoice (ProformaList.html) */
const router = useRouter()
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'order', 'request'], fetch: salesProformasApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const kpis = computed(() => list.data.value?.kpis)

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
  { key: 'used', label: 'Used on invoice' },
]
const GROUP: Record<ProformaStatus, 'draft' | 'released' | 'done' | 'partial' | 'cancelled'> = { DRAFT: 'draft', SENT: 'released', PAID: 'done', USED: 'partial', CANCELLED: 'cancelled' }

// ── Filters ──────────────────────────────────────────────────────────────────
const customerText = ref(list.params.value.customer ?? '')
const orderText = ref(list.params.value.order ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch([customerText, orderText], ([c, o]) => {
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilters({ customer: c.trim() || undefined, order: o.trim() || undefined }), 350)
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
const datePlaceholder = computed(() =>
  today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date',
)

const footer = computed(() => {
  const d = list.data.value
  if (!d) return ''
  const toPay = d.items.filter((r) => r.status === 'DRAFT' || r.status === 'SENT').length
  return `${d.total} ${d.total === 1 ? 'proforma' : 'proformas'} · ${toPay} still to be paid`
})
const waitingSub = computed(() => kpis.value?.waiting.docs.map((d) => `${d.docNo} ${d.status}`).join(' · ') || 'Nothing waiting')
const lastUsedText = computed(() => {
  const u = list.data.value?.lastUsed
  if (!u?.invoiceNo) return ''
  return ` ${u.docNo} was knocked off ${u.invoiceNo}${u.usedAt ? ` on ${formatDate(u.usedAt.slice(0, 10)).split(' ').slice(0, 2).join(' ')}` : ''}.`
})

// ── New proforma: pick a released order ──────────────────────────────────────
const pickOpen = ref(false)
const orders = ref<{ id: string; docNo: string; customerName: string; total: string; docDate: string }[]>([])
const creating = ref(false)
async function openPick() {
  orders.value = (await salesProformasApi.orders()).items
  pickOpen.value = true
}
async function create(orderId: string) {
  creating.value = true
  try {
    const p = await salesProformasApi.create({ salesOrderId: orderId })
    toast.add({ severity: 'success', summary: `${p.docNo} created`, detail: 'Deposit 30% by default. Check the request and the pay-by date, then release.', life: 4000 })
    void router.push(`/sales/proformas/${p.id}`)
  } finally {
    creating.value = false
    pickOpen.value = false
  }
}

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of proformas comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: ProformaListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesProformasApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['PF no', 'Date', 'Customer', 'Sales order', 'Request', 'Amount (RM)', 'Received (RM)', 'Status'].map(cell).join(','),
    ...all.map((p) => [p.docNo, p.docDate, p.customerName, p.salesOrderNo, p.request, p.amount, p.received ?? '', p.label].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `proformas-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <div class="grid grid-cols-4 gap-4">
      <KpiCard label="Deposits requested" :value="kpis ? formatRm(kpis.requested.amount) : '—'" :sub="kpis ? `${kpis.requested.count} proformas this month` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Received" tone="success" :value="kpis ? formatRm(kpis.received.amount) : '—'" :sub="kpis ? `${kpis.received.count} paid` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Waiting for payment" tone="warning" :value="kpis ? formatRm(kpis.waiting.amount) : '—'" :sub="waitingSub" :loading="list.loading.value && !kpis" />
      <div class="erp-card flex flex-col gap-1 border-mod-light-border bg-mod-light px-5 py-4">
        <span class="text-[13px] font-semibold text-mod-accent">Not a tax invoice</span>
        <span class="text-[22px] font-bold text-mod-accent">No posting</span>
        <span class="text-xs text-mod-accent">Nothing goes to accounts or LHDN</span>
      </div>
    </div>

    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Proforma Invoice" subtitle="Payment requests sent before delivery, for deposits or pay-first customers.">
        <template #actions>
          <button v-if="can('sales.proforma.edit')" type="button" class="erp-btn erp-btn-add" @click="openPick"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New proforma</button>
          <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
          <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        </template>
      </PageHeader>

      <FilterBar>
        <input v-model="customerText" class="erp-input" placeholder="Filter by customer" aria-label="Filter by customer" />
        <input v-model="orderText" class="erp-input" placeholder="Filter by sales order no" aria-label="Filter by sales order no" />
        <select class="erp-input" aria-label="Filter by request" :value="list.params.value.request" @change="list.setFilter('request', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by request</option>
          <option value="DEPOSIT_PCT">Deposit %</option>
          <option value="PAY_BEFORE_RELEASE">Pay before release</option>
        </select>
        <DatePicker
          v-model="dateRange"
          selection-mode="range"
          date-format="d M yy"
          :placeholder="datePlaceholder"
          :manual-input="false"
          show-button-bar
          fluid
          class="erp-date"
          @update:model-value="onDateRange"
          @clear-click="onDateRange(null)"
        />
      </FilterBar>

      <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No proformas match these filters.">
        <Column header="PF no">
          <template #body="{ data }: { data: ProformaListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/proformas/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: ProformaListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Customer" field="customerName" />
        <Column header="Sales order">
          <template #body="{ data }: { data: ProformaListItem }">
            <RouterLink v-if="data.salesOrderId" :to="`/sales/orders/${data.salesOrderId}`" class="erp-link whitespace-nowrap">{{ data.salesOrderNo }}</RouterLink>
            <span v-else class="whitespace-nowrap">{{ data.salesOrderNo }}</span>
          </template>
        </Column>
        <Column header="Request" field="request" />
        <Column header="Amount (RM)" class="erp-col-num">
          <template #body="{ data }: { data: ProformaListItem }"><MoneyText :value="data.amount" /></template>
        </Column>
        <Column header="Received (RM)" class="erp-col-num">
          <template #body="{ data }: { data: ProformaListItem }"><MoneyText v-if="data.received" :value="data.received" /><span v-else class="text-erp-muted">—</span></template>
        </Column>
        <Column header="Status">
          <template #body="{ data }: { data: ProformaListItem }"><StatusChip :status="data.status" :label="data.label" :group="GROUP[data.status]" /></template>
        </Column>
      </DataList>

      <div class="mt-auto flex items-center justify-between pt-2">
        <span class="text-xs text-erp-muted">{{ footer }}</span>
        <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
      </div>
    </section>

    <NoticeBanner>When the tax invoice is issued, the deposit on the proforma is knocked off it automatically.{{ lastUsedText }}</NoticeBanner>

    <Dialog v-model:visible="pickOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '520px' }" header="New proforma">
      <p class="m-0 mb-3 text-[13px] text-erp-subtle">Pick the released order to ask a deposit for. Orders that already have an open proforma are not listed.</p>
      <p v-if="!orders.length" class="m-0 text-[13px] text-erp-muted">No released order is waiting for a deposit.</p>
      <div class="flex flex-col gap-2">
        <button
          v-for="o in orders"
          :key="o.id"
          type="button"
          class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-erp-border bg-erp-card px-3.5 py-2.5 text-left text-[13px] hover:bg-erp-head"
          :disabled="creating"
          @click="create(o.id)"
        >
          <span><span class="font-semibold">{{ o.docNo }}</span> · {{ o.customerName }}<span class="block text-xs text-erp-muted">Ordered {{ formatDate(o.docDate) }}</span></span>
          <span class="erp-num text-xs font-semibold whitespace-nowrap">RM {{ formatMoney(o.total) }}</span>
        </button>
      </div>
    </Dialog>
  </div>
</template>
