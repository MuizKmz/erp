<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { salesDebitNotesApi } from '../api/sales'
import type { DebitListItem } from '../types'

/** S25 · List of Debit Note (DebitNoteList.html) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'invoice', 'reason'], fetch: salesDebitNotesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
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
const datePlaceholder = computed(() => (today.value ? `Filter by date: 01 Aug – ${formatDate(today.value)}` : 'Filter by date'))
const footer = computed(() => {
  const d = list.data.value
  if (!d) return ''
  const since = d.since ? new Date(`${d.since}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' }) : ''
  return `${d.total} debit ${d.total === 1 ? 'note' : 'notes'}${since ? ` since ${since}` : ''}`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of debit notes comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: DebitListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesDebitNotesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['DN no', 'Date', 'Customer', 'Adds to invoice', 'Reason', 'Amount (RM)', 'Status'].map(cell).join(','),
    ...all.map((d) => [d.docNo, d.docDate, d.customerName, d.invoiceNo, d.summary ?? d.reason, d.total, d.status === 'DRAFT' ? 'Draft' : 'Released'].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `debit-notes-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Debit Note" subtitle="Extra charges added to an invoice the customer already has. They increase what the customer owes.">
        <template #actions>
          <RouterLink v-if="can('sales.debit_note.edit')" to="/sales/debit-notes/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New debit note</RouterLink>
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

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No debit notes match these filters.">
        <Column header="DN no">
          <template #body="{ data }: { data: DebitListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/debit-notes/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: DebitListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Customer" field="customerName" />
        <Column header="Adds to invoice">
          <template #body="{ data }: { data: DebitListItem }">
            <RouterLink v-if="data.invoiceId" :to="`/sales/invoices/${data.invoiceId}`" class="erp-link whitespace-nowrap">{{ data.invoiceNo }}</RouterLink>
            <span v-else class="whitespace-nowrap">{{ data.invoiceNo }}</span>
          </template>
        </Column>
        <Column header="Reason">
          <template #body="{ data }: { data: DebitListItem }">{{ data.summary ?? data.reason }}</template>
        </Column>
        <Column header="Amount (RM)" class="erp-col-num">
          <template #body="{ data }: { data: DebitListItem }"><MoneyText :value="data.total" /></template>
        </Column>
        <Column header="E-invoice">
          <template #body="{ data }: { data: DebitListItem }">
            <StatusChip v-if="data.eInvoice === 'PENDING'" status="PENDING" label="Pending" group="pending" />
            <span v-else-if="data.eInvoice === 'OLD_SYSTEM'" class="text-erp-subtle">Old system</span>
            <span v-else class="text-erp-muted">—</span>
          </template>
        </Column>
        <Column header="Status">
          <template #body="{ data }: { data: DebitListItem }">
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
        <h2 class="m-0 text-[15px] font-bold">Debit note, credit note or sales return?</h2>
        <table class="erp-table">
          <thead><tr><th>Document</th><th>When to use it</th><th>Customer owes</th><th>Goods move?</th><th>E-invoice</th></tr></thead>
          <tbody>
            <tr><td class="font-semibold">Debit note</td><td>We forgot to charge something, or charge extra</td><td class="font-semibold text-note-error-text">More</td><td>No</td><td>Debit note e-Invoice</td></tr>
            <tr><td class="font-semibold">Sales return</td><td>Goods come back</td><td class="font-semibold text-chip-done-text">Less</td><td>Yes · back in</td><td>Credit note e-Invoice</td></tr>
            <tr><td class="font-semibold">Cancel order</td><td>Goods never delivered or invoiced</td><td>No change</td><td>No</td><td>None</td></tr>
          </tbody>
        </table>
      </section>
      <NextSteps title="Rules">
        <li><span>A debit note always points to one released invoice.</span></li>
        <li><span>A released invoice is never edited. Changes go through these documents.</span></li>
        <li><span>Posting and e-Invoice are queued until Finance and e-Invoice plug in.</span></li>
      </NextSteps>
    </div>
  </div>
</template>
