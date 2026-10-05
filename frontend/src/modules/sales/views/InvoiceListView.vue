<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import { salesInvoicesApi, salesLookupsApi } from '../api/sales'
import type { InvoiceListItem, PaymentKey } from '../types'

/** S17 · List of Invoice (InvoiceList.html) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'agent', 'branch'], fetch: salesInvoicesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const kpis = computed(() => list.data.value?.kpis)

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
]
const PAYMENT_GROUP: Record<PaymentKey, 'draft' | 'pending' | 'released' | 'done' | 'cancelled'> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  UNPAID: 'released',
  OVERDUE: 'cancelled',
  PAID: 'done',
}

// ── Filters ──────────────────────────────────────────────────────────────────
const agents = ref<{ code: string; name: string }[]>([])
const branches = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  const [a, b] = await Promise.all([salesLookupsApi.agents(), salesLookupsApi.branches()])
  agents.value = a.items
  branches.value = b.items
})
const customerText = ref(list.params.value.customer ?? '')
let customerTimer: ReturnType<typeof setTimeout> | undefined
watch(customerText, (value) => {
  clearTimeout(customerTimer)
  customerTimer = setTimeout(() => list.setFilter('customer', value.trim()), 350)
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
const datePlaceholder = computed(() => (today.value ? `Filter by date: 01 Jun – ${formatDate(today.value)}` : 'Filter by date'))

const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} invoices`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of invoices comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: InvoiceListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesInvoicesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Invoice no', 'Date', 'Customer', 'Total (RM)', 'Balance due', 'Due date', 'Payment', 'From order'].map(cell).join(','),
    ...all.map((i) => [i.docNo, i.docDate, i.customerName, i.total, i.balance, i.dueDate ?? '', i.payment.label, i.salesOrderNo ?? ''].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `invoices-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const source = (i: InvoiceListItem) => (i.isMigrated ? 'migrated' : i.kind === 'DIRECT' ? 'direct' : i.salesOrderNo ? `from ${i.salesOrderNo}` : '')
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <div class="grid grid-cols-4 gap-4">
      <KpiCard label="Balance due" :value="kpis ? formatRm(kpis.balanceDue.amount) : '—'" :sub="kpis ? `${kpis.balanceDue.invoices} unpaid invoices` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Overdue" tone="danger" :value="kpis ? formatRm(kpis.overdue.amount) : '—'" :sub="kpis ? `${kpis.overdue.customers} customers` : ''" :loading="list.loading.value && !kpis" />
      <KpiCard label="Waiting for Finance" tone="warning" :value="kpis ? `${kpis.financeWaiting} postings` : '—'" sub="Sent when Finance plugs in" :loading="list.loading.value && !kpis" />
      <KpiCard label="LHDN e-Invoice pending" tone="warning" :value="kpis?.eInvoicePending ?? '—'" sub="Sent when e-Invoice plugs in" :loading="list.loading.value && !kpis" />
    </div>

    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Invoice" subtitle="Tax invoices. Invoices from before go-live are marked “migrated” and keep their old numbers.">
        <template #actions>
          <template v-if="can('sales.invoice.edit')">
            <RouterLink to="/sales/invoices/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Create from sales order</RouterLink>
            <RouterLink to="/sales/invoices/blank" class="erp-btn erp-btn-secondary">Blank invoice</RouterLink>
          </template>
          <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
          <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        </template>
      </PageHeader>

      <FilterBar>
        <input v-model="customerText" class="erp-input" placeholder="Filter by customer" aria-label="Filter by customer" />
        <select class="erp-input" aria-label="Filter by sales agent" :value="list.params.value.agent" @change="list.setFilter('agent', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by sales agent</option>
          <option v-for="a in agents" :key="a.code" :value="a.code">{{ a.name }}</option>
        </select>
        <select class="erp-input" aria-label="Filter by branch" :value="list.params.value.branch" @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by branch</option>
          <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
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

      <div v-if="list.failed.value" class="flex items-center justify-between rounded-lg bg-note-error-bg px-4 py-3 text-[13px] text-note-error-text">
        The invoices could not be loaded.
        <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
      </div>

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No invoices match these filters.">
        <Column header="Invoice no">
          <template #body="{ data }: { data: InvoiceListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/invoices/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
            <div class="text-xs whitespace-nowrap text-erp-muted">{{ source(data) }}</div>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: InvoiceListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Customer" field="customerName" />
        <Column header="Total (RM)" class="erp-col-num">
          <template #body="{ data }: { data: InvoiceListItem }"><MoneyText :value="data.total" /></template>
        </Column>
        <Column header="Balance due" class="erp-col-num">
          <template #body="{ data }: { data: InvoiceListItem }"><MoneyText :value="data.balance" /></template>
        </Column>
        <Column header="Due date">
          <template #body="{ data }: { data: InvoiceListItem }"><span class="whitespace-nowrap">{{ data.dueDate && data.payment.key !== 'DRAFT' && data.payment.key !== 'PENDING' ? formatDate(data.dueDate) : '—' }}</span></template>
        </Column>
        <Column header="Payment">
          <template #body="{ data }: { data: InvoiceListItem }"><StatusChip :status="data.payment.key" :label="data.payment.label" :group="PAYMENT_GROUP[data.payment.key]" /></template>
        </Column>
        <Column header="Accounts">
          <template #body="{ data }: { data: InvoiceListItem }">
            <StatusChip v-if="data.accounts === 'QUEUED'" status="QUEUED" label="Queued" group="pending" />
            <StatusChip v-else-if="data.accounts === 'OLD_SYSTEM'" status="OLD" label="Old system" group="draft" />
            <StatusChip v-else-if="data.accounts === 'POSTED'" status="POSTED" label="Posted" group="done" />
            <span v-else class="text-erp-muted">—</span>
          </template>
        </Column>
        <Column header="E-invoice">
          <template #body="{ data }: { data: InvoiceListItem }">
            <StatusChip v-if="data.eInvoice === 'PENDING'" status="PENDING" label="Pending" group="pending" />
            <StatusChip v-else-if="data.eInvoice === 'SUBMITTED'" status="SUBMITTED" label="Submitted" group="done" />
            <span v-else class="text-erp-muted">—</span>
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
