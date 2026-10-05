<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Popover from 'primevue/popover'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import QtyProgress from '@/components/erp/QtyProgress.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatQty } from '@/utils/format'
import { salesLookupsApi, salesOrdersApi } from '../api/sales'
import type { OrderListItem } from '../types'

/** S10 · List of Sales Order (SalesOrderList.html) */
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'agent', 'branch'], fetch: salesOrdersApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pendingApproval', label: 'Pending approval' },
  { key: 'released', label: 'Released' },
  { key: 'partial', label: 'Partial' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
]

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

// ── Selection and actions ────────────────────────────────────────────────────
const selection = ref<OrderListItem[]>([])
watch(rows, () => (selection.value = selection.value.filter((s) => rows.value.some((r) => r.id === s.id))))
const selected = computed(() => (selection.value.length === 1 ? selection.value[0]! : null))
const releasable = computed(() => selection.value.filter((s) => s.allowedActions.includes('release')))
const canDo = (action: OrderListItem['allowedActions'][number]) => Boolean(selected.value?.allowedActions.includes(action))

const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  const to = Math.min(d.page * d.pageSize, d.total)
  return `Showing ${from}–${to} of ${d.total} orders${selection.value.length ? ` · ${selection.value.length} selected` : ''}`
})

/** Releases each selected draft; one that fails does not stop the others (FR-SAL-020). */
function releaseSelected() {
  const orders = releasable.value
  if (!orders.length) return
  confirm.require({
    header: orders.length === 1 ? `Release ${orders[0]!.docNo}?` : `Release ${orders.length} orders?`,
    message: 'Released orders are locked and shown in the delivery list. The credit check runs again for each one.',
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      const done: string[] = []
      const failed: string[] = []
      for (const o of orders) {
        try {
          await salesOrdersApi.release(o.id, o.version, true)
          done.push(o.docNo)
        } catch (error) {
          failed.push(`${o.docNo}: ${error instanceof ApiError ? error.message : 'could not be released'}`)
        }
      }
      if (done.length) toast.add({ severity: 'success', summary: `${done.join(', ')} released`, life: 4000 })
      selection.value = []
      void list.reload()
      if (failed.length) toast.add({ severity: 'warn', summary: 'Not released', detail: failed.join('\n'), life: 8000 })
    },
  })
}

function createInvoice() {
  if (selected.value) void router.push({ path: '/sales/invoices/new', query: { order: selected.value.id } })
}
function cancelBalance() {
  if (selected.value) void router.push({ path: '/sales/cancel-orders/new', query: { order: selected.value.id } })
}

// ── Columns ──────────────────────────────────────────────────────────────────
const OPTIONAL = [
  { key: 'date', label: 'Order date' },
  { key: 'agent', label: 'Sales agent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'invoiced', label: 'Invoiced (RM)' },
  { key: 'credit', label: 'Credit' },
] as const
const COLS_KEY = 'zora.soList.columns'
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
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of sales orders comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: OrderListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesOrdersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['SO no', 'Order date', 'Customer', 'Sales agent', 'Total (RM)', 'Delivered', 'Ordered', 'Invoiced (RM)', 'Status', 'Credit'].map(cell).join(','),
    ...all.map((o) =>
      [o.docNo, o.docDate, o.customerName, o.agentName, o.total, formatQty(o.deliveredQty), formatQty(o.orderedQty), o.invoicedAmount, o.statusLabel, o.credit]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `sales-orders-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const chipOf = (o: OrderListItem) => (o.balanceCancelled ? { status: 'CANCELLED', label: 'Balance cancelled' } : { status: o.status, label: o.statusLabel })
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Sales Order" subtitle="Confirmed customer orders. Delivered and invoiced quantities update as documents are released." />

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

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('sales.order.edit')" to="/sales/orders/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new order
        </RouterLink>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="!releasable.length" @click="releaseSelected">Release selected</button>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!canDo('invoice')" @click="createInvoice">Create invoice</button>
        <button type="button" class="erp-btn erp-btn-danger" :disabled="!canDo('cancelBalance')" @click="cancelBalance">Cancel balance</button>
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
      The orders could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList v-model:selection="selection" :rows="rows" :loading="list.loading.value" selectable empty-text="No sales orders match these filters.">
      <Column selection-mode="multiple" header-style="width: 44px" />
      <Column header="SO no">
        <template #body="{ data }: { data: OrderListItem }">
          <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
          <RouterLink v-else :to="`/sales/orders/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column v-if="show('date')" header="Order date">
        <template #body="{ data }: { data: OrderListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Customer">
        <template #body="{ data }: { data: OrderListItem }">
          {{ data.customerName }}
          <span v-if="data.isBuyToOrder" class="ml-1 rounded-md bg-erp-head px-1.5 py-px text-[11px] font-semibold whitespace-nowrap text-erp-muted">Buy to order</span>
        </template>
      </Column>
      <Column v-if="show('agent')" header="Sales agent" field="agentName" />
      <Column header="Total (RM)" class="erp-col-num">
        <template #body="{ data }: { data: OrderListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column v-if="show('delivered')" header="Delivered">
        <template #body="{ data }: { data: OrderListItem }"><QtyProgress :done="data.deliveredQty" :total="data.orderedQty" /></template>
      </Column>
      <Column v-if="show('invoiced')" header="Invoiced (RM)" class="erp-col-num">
        <template #body="{ data }: { data: OrderListItem }"><MoneyText :value="data.invoicedAmount" /></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: OrderListItem }"><StatusChip :status="chipOf(data).status" :label="chipOf(data).label" /></template>
      </Column>
      <Column v-if="show('credit')" header="Credit">
        <template #body="{ data }: { data: OrderListItem }">
          <span
            class="whitespace-nowrap"
            :class="data.overLimit ? 'font-semibold text-note-error-text' : data.credit === 'OK' ? 'text-chip-done-text' : 'text-erp-muted'"
            >{{ data.credit }}</span
          >
        </template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
