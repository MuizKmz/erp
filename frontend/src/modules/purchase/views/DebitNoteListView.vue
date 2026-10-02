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
import { formatDate, formatMoney } from '@/utils/format'
import { debitNotesApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { DebitNoteListItem } from '../types'

/** P20 · List of Supplier Debit Note (PurDebitNoteList.html, FlowP6 step 9) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['supplier', 'invoiceNo', 'reason'], fetch: debitNotesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pendingApproval', label: 'Pending approval', hideWhenEmpty: true },
  { key: 'released', label: 'Released' },
  { key: 'rejected', label: 'Rejected', hideWhenEmpty: true },
]
const CHIP = {
  DRAFT: { group: 'draft', label: 'Draft' },
  PENDING_APPROVAL: { group: 'pending', label: 'Pending approval' },
  RELEASED: { group: 'done', label: 'Released' },
  REJECTED: { group: 'cancelled', label: 'Rejected' },
} as const

function debounced(key: 'supplier' | 'invoiceNo') {
  const text = ref(list.params.value[key] ?? '')
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => list.setFilter(key, value.trim()), 350)
  })
  return text
}
const supplierText = debounced('supplier')
const invoiceText = debounced('invoiceNo')

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
const invoiceRoute = (id: string | null, no: string) => (isLegacyNo(no) ? null : docRoute('PUR_INVOICE', id))
const footer = computed(() => {
  const t = list.data.value?.totals
  if (!t || !t.count) return ''
  return `${t.count} ${t.count === 1 ? 'debit note' : 'debit notes'} · RM ${formatMoney(t.total)}${t.since ? ` since ${t.since}` : ''}`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of debit notes comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: DebitNoteListItem[] = []
  for (let page = 1; ; page++) {
    const result = await debitNotesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['PDN no', 'Date', 'Supplier', 'Their note', 'Invoice', 'Their invoice', 'Reason', 'Amount (RM)', 'Status'].map(cell).join(','),
    ...all.map((r) => [r.docNo, r.docDate, r.supplierName, r.theirNoteNo, r.invoiceNo, r.supplierInvoiceNo ?? '', r.reasonText, r.total, CHIP[r.status].label].map(cell).join(',')),
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
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Supplier Debit Note" subtitle="Extra charges a supplier adds to an invoice we already have. They increase what we owe.">
      <template #actions>
        <RouterLink v-if="can('purchase.debit_note.edit')" to="/purchase/debit-notes/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Record debit note</RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <input v-model="invoiceText" class="erp-input" placeholder="Filter by invoice no" aria-label="Filter by invoice no" />
      <select class="erp-input" aria-label="Filter by reason" :value="list.params.value.reason" @change="list.setFilter('reason', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by reason</option>
        <option v-for="r in list.data.value?.reasons ?? []" :key="r" :value="r">{{ r }}</option>
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

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No debit notes match these filters.">
      <Column header="PDN no">
        <template #body="{ data }: { data: DebitNoteListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/debit-notes/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: DebitNoteListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Supplier · their note">
        <template #body="{ data }: { data: DebitNoteListItem }">
          <div class="font-semibold whitespace-nowrap">{{ data.supplierName }}</div>
          <div class="text-xs text-erp-muted">{{ data.theirNoteNo }}</div>
        </template>
      </Column>
      <Column header="Adds to invoice">
        <template #body="{ data }: { data: DebitNoteListItem }">
          <span class="whitespace-nowrap">
            <RouterLink v-if="invoiceRoute(data.invoiceId, data.invoiceNo)" :to="invoiceRoute(data.invoiceId, data.invoiceNo)!" class="erp-link">{{ data.invoiceNo }}</RouterLink>
            <template v-else>{{ data.invoiceNo }}</template>
            <template v-if="data.supplierInvoiceNo && !isLegacyNo(data.invoiceNo)"> · {{ data.supplierInvoiceNo }}</template>
          </span>
        </template>
      </Column>
      <Column header="Reason" field="reasonText" />
      <Column header="Amount (RM)" class="erp-col-num">
        <template #body="{ data }: { data: DebitNoteListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: DebitNoteListItem }"><StatusChip :status="data.status" :group="CHIP[data.status].group" :label="CHIP[data.status].label" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ footer }}</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <div class="flex gap-4">
    <section class="erp-card flex grow flex-col gap-2.5 px-5 py-4">
      <h2 class="m-0 text-[15px] font-bold">Debit note, credit note or return?</h2>
      <table class="erp-table">
        <thead>
          <tr><th>Document</th><th>Who issues it</th><th>Effect on what we owe</th><th>Goods move?</th></tr>
        </thead>
        <tbody>
          <tr><td><strong class="whitespace-nowrap">Supplier debit note</strong></td><td>Supplier</td><td class="whitespace-nowrap">Goes up</td><td>No</td></tr>
          <tr><td><strong class="whitespace-nowrap">Supplier credit note</strong></td><td>Supplier</td><td class="whitespace-nowrap">Goes down</td><td>No</td></tr>
          <tr><td><strong class="whitespace-nowrap">Purchase return</strong></td><td>Us</td><td class="whitespace-nowrap">Goes down, once credit arrives</td><td>Yes · goods go back</td></tr>
        </tbody>
      </table>
    </section>
    <NextSteps title="Rules" class="w-[380px] shrink-0">
      <li><span>A debit note always points to one supplier invoice.</span></li>
      <li><span>Charges that were not on the PO need the Purchasing Manager’s approval.</span></li>
      <li><span>Service charges use the service tax code from Master Data.</span></li>
    </NextSteps>
  </div>
</template>
