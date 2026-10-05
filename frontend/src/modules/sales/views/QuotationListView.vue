<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Popover from 'primevue/popover'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Clock, Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { salesLookupsApi, salesQuotationsApi } from '../api/sales'
import type { QuotationListItem } from '../types'

/** S08 · List of Quotation (QuotationList.html). "Draft Quotation" in the menu opens this list on the Draft tab. */
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'agent', 'branch'], fetch: salesQuotationsApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
  { key: 'ordered', label: 'Turned into order' },
  { key: 'expired', label: 'Expired' },
]
const GROUP: Record<string, 'draft' | 'pending' | 'released' | 'done' | 'cancelled'> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending',
  RELEASED: 'released',
  ORDERED: 'done',
  LOST: 'cancelled',
  SUPERSEDED: 'cancelled',
}
const groupOf = (q: QuotationListItem) => (q.expired ? 'cancelled' : GROUP[q.status])

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
const datePlaceholder = computed(() =>
  today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date',
)

/** "2 released quotations expire within 3 days: QT-0001 (2 Oct) and QT-0009 (3 Oct)." */
const expiryBanner = computed(() => {
  const soon = list.data.value?.expiringSoon ?? []
  if (!soon.length) return null
  const short = (iso: string) => formatDate(iso).split(' ').slice(0, 2).join(' ')
  const names = soon.map((s) => `${s.docNo} (${short(s.validUntil)})`)
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return { lead: `${soon.length} released quotation${soon.length > 1 ? 's' : ''} expire${soon.length > 1 ? '' : 's'} within 3 days:`, rest: `${joined}. Follow up or revise the validity date.` }
})
const soonNos = computed(() => new Set((list.data.value?.expiringSoon ?? []).map((s) => s.docNo)))

// ── Selection and actions ────────────────────────────────────────────────────
const selection = ref<QuotationListItem[]>([])
watch(rows, () => (selection.value = selection.value.filter((s) => rows.value.some((r) => r.id === s.id))))
const selected = computed(() => (selection.value.length === 1 ? selection.value[0]! : null))
const releasable = computed(() => selection.value.filter((s) => s.allowedActions.includes('release')))
const deletable = computed(() => selection.value.filter((s) => s.allowedActions.includes('delete')))

const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} quotations${selection.value.length ? ` · ${selection.value.length} selected` : ''}`
})

/** Releases each selected draft; one that fails (discount over the rule, no valid-until date) does not stop the others. */
function releaseSelected() {
  const items = releasable.value
  if (!items.length) return
  confirm.require({
    header: items.length === 1 ? `Release ${items[0]!.docNo}?` : `Release ${items.length} quotations?`,
    message: 'Released quotations are locked. Change one later by revising it.',
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      const done: string[] = []
      const failed: string[] = []
      for (const q of items) {
        try {
          await salesQuotationsApi.release(q.id, q.version, true)
          done.push(q.docNo)
        } catch (error) {
          failed.push(`${q.docNo}: ${error instanceof ApiError ? error.message : 'could not be released'}`)
        }
      }
      if (done.length) toast.add({ severity: 'success', summary: `${done.join(', ')} released`, life: 4000 })
      selection.value = []
      void list.reload()
      if (failed.length) toast.add({ severity: 'warn', summary: 'Not released', detail: failed.join('\n'), life: 8000 })
    },
  })
}

function transferSelected() {
  const q = selected.value
  if (!q) return
  if (!q.allowedActions.includes('transfer')) {
    toast.add({ severity: 'warn', summary: `${q.docNo} cannot be turned into a sales order`, detail: q.expired ? 'It has expired. Revise the validity date first.' : 'Only a released quotation can be turned into a sales order.', life: 5000 })
    return
  }
  confirm.require({
    header: `Turn ${q.docNo} into a sales order?`,
    message: 'A draft sales order is created with the same customer, prices and discounts. The credit check runs on the order.',
    acceptLabel: 'Create sales order',
    rejectLabel: 'Cancel',
    accept: async () => {
      const result = await salesQuotationsApi.transfer(q.id, q.version)
      toast.add({ severity: 'success', summary: `${result.orderNo} created from ${q.docNo}`, life: 4000 })
      void router.push(`/sales/orders/${result.orderId}`)
    },
  })
}

function deleteSelected() {
  const items = deletable.value
  if (!items.length) return
  confirm.require({
    header: items.length === 1 ? `Delete ${items[0]!.docNo}?` : `Delete ${items.length} drafts?`,
    message: 'Only drafts can be deleted. Deleting a revision brings back the previous one.',
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep',
    acceptClass: 'p-button-danger',
    accept: async () => {
      for (const q of items) await salesQuotationsApi.remove(q.id, q.version)
      toast.add({ severity: 'success', summary: `${items.map((q) => q.docNo).join(', ')} deleted`, life: 3000 })
      selection.value = []
      void list.reload()
    },
  })
}

// ── Columns ──────────────────────────────────────────────────────────────────
const OPTIONAL = [
  { key: 'rev', label: 'Rev' },
  { key: 'date', label: 'Date' },
  { key: 'agent', label: 'Sales agent' },
  { key: 'order', label: 'Sales order' },
] as const
const COLS_KEY = 'zora.qtList.columns'
const hidden = ref<string[]>(readHidden())
function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
watch(hidden, (value) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
})
const show = (key: string) => !hidden.value.includes(key)
const columnsPanel = ref<InstanceType<typeof Popover> | null>(null)

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of quotations comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: QuotationListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesQuotationsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['QT no', 'Rev', 'Date', 'Valid until', 'Customer', 'Sales agent', 'Total (RM)', 'Sales order', 'Status'].map(cell).join(','),
    ...all.map((q) => [q.docNo, String(q.revision), q.docDate, q.validUntil ?? '', q.customerName, q.agentName, q.total, q.salesOrder?.no ?? '', q.label].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `quotations-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Quotation" subtitle="Price offers sent to customers. A released quotation can be revised or turned into a sales order." />

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

    <div v-if="expiryBanner" class="flex items-center gap-2.5 rounded-[10px] border border-note-warn-border bg-note-warn-bg px-3.5 py-2.5 text-[13px] text-note-warn-text" role="status">
      <Clock :size="16" class="shrink-0 text-note-warn-strong" aria-hidden="true" />
      <span><strong>{{ expiryBanner.lead }}</strong> {{ expiryBanner.rest }}</span>
    </div>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('sales.quotation.edit')" to="/sales/quotations/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new quotation
        </RouterLink>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="!releasable.length" @click="releaseSelected">Release selected</button>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!selected" @click="transferSelected">Turn into sales order</button>
        <button type="button" class="erp-btn erp-btn-danger" :disabled="!deletable.length" @click="deleteSelected">Delete draft</button>
      </div>
      <div class="flex gap-2">
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        <button type="button" class="erp-btn erp-btn-secondary" @click="columnsPanel?.toggle($event)">Select columns</button>
        <Popover ref="columnsPanel">
          <div class="flex flex-col gap-2 p-1 text-[13px]">
            <label v-for="c in OPTIONAL" :key="c.key" class="flex items-center gap-2">
              <input type="checkbox" :checked="show(c.key)" @change="hidden = show(c.key) ? [...hidden, c.key] : hidden.filter((h) => h !== c.key)" />
              {{ c.label }}
            </label>
          </div>
        </Popover>
      </div>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <div v-if="list.failed.value" class="flex items-center justify-between rounded-lg bg-note-error-bg px-4 py-3 text-[13px] text-note-error-text">
      The quotations could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList v-model:selection="selection" :rows="rows" :loading="list.loading.value" selectable empty-text="No quotations match these filters.">
      <Column selection-mode="multiple" header-style="width: 44px" />
      <Column header="QT no">
        <template #body="{ data }: { data: QuotationListItem }">
          <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
          <RouterLink v-else :to="`/sales/quotations/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column v-if="show('rev')" header="Rev" field="revision" />
      <Column v-if="show('date')" header="Date">
        <template #body="{ data }: { data: QuotationListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Valid until">
        <template #body="{ data }: { data: QuotationListItem }">
          <span class="whitespace-nowrap" :class="soonNos.has(data.docNo) ? 'font-bold text-attention' : ''">{{ data.validUntil ? formatDate(data.validUntil) : '—' }}</span>
        </template>
      </Column>
      <Column header="Customer" field="customerName" />
      <Column v-if="show('agent')" header="Sales agent" field="agentName" />
      <Column header="Total (RM)" class="erp-col-num">
        <template #body="{ data }: { data: QuotationListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column v-if="show('order')" header="Sales order">
        <template #body="{ data }: { data: QuotationListItem }">
          <RouterLink v-if="data.salesOrder?.id" :to="`/sales/orders/${data.salesOrder.id}`" class="erp-link whitespace-nowrap">{{ data.salesOrder.no }}</RouterLink>
          <span v-else-if="data.salesOrder" class="whitespace-nowrap text-erp-muted">{{ data.salesOrder.no }}</span>
          <span v-else class="text-erp-muted">—</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: QuotationListItem }"><StatusChip :status="data.status" :label="data.label" :group="groupOf(data)" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
