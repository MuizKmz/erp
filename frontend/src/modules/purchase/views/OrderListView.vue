<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Popover from 'primevue/popover'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import QtyProgress from '@/components/erp/QtyProgress.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatQty } from '@/utils/format'
import { lookupsApi, ordersApi } from '../api/purchase'
import { docRoute } from '../routes'
import type { OrderListItem } from '../types'

/** P09 · List of Purchase Order (PoList.html) */
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['supplier', 'buyer', 'branch'], fetch: ordersApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pendingApproval', label: 'Pending approval' },
  { key: 'released', label: 'Released' },
  { key: 'partial', label: 'Partially received' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled', hideWhenEmpty: true },
]

// ── Filters ──────────────────────────────────────────────────────────────────
const buyers = ref<{ code: string; name: string }[]>([])
const branches = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  const [b, br] = await Promise.all([lookupsApi.users('PURCHASE_BUYER'), lookupsApi.branches()])
  buyers.value = b.items
  branches.value = br.items
})

const supplierText = ref(list.params.value.supplier ?? '')
let supplierTimer: ReturnType<typeof setTimeout> | undefined
watch(supplierText, (value) => {
  clearTimeout(supplierTimer)
  supplierTimer = setTimeout(() => list.setFilter('supplier', value.trim()), 350)
})

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateRange = ref<Date[] | null>(
  list.params.value.dateFrom && list.params.value.dateTo
    ? [new Date(`${list.params.value.dateFrom}T00:00`), new Date(`${list.params.value.dateTo}T00:00`)]
    : null,
)
function onDateRange(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const [from, to] = Array.isArray(value) ? value : []
  if (!value || (from && to)) {
    list.setFilters({ dateFrom: from ? isoDay(from) : undefined, dateTo: to ? isoDay(to) : undefined })
  }
}
// "Filter by date: 01 Sep – 29 Sep 2026" (this month so far)
const datePlaceholder = computed(() =>
  today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date',
)

// ── Selection and actions ────────────────────────────────────────────────────
const selection = ref<OrderListItem[]>([])
watch(rows, () => (selection.value = selection.value.filter((s) => rows.value.some((r) => r.id === s.id))))
const selected = computed(() => (selection.value.length === 1 ? selection.value[0]! : null))
const canDo = (action: OrderListItem['allowedActions'][number]) => Boolean(selected.value?.allowedActions.includes(action))

const selectionText = computed(() => {
  if (!selection.value.length) return ''
  if (!selected.value) return `${selection.value.length} selected · pick one order for these actions`
  const s = selected.value
  return `1 selected · ${s.docNo} ${s.waitingFor ? `is waiting for ${s.waitingFor}` : `· ${s.statusLabel}`}`
})

function sendForApproval() {
  if (selected.value) void router.push({ path: `/purchase/orders/${selected.value.id}`, query: { approve: '1' } })
}

function release() {
  const po = selected.value
  if (!po) return
  confirm.require({
    header: `Release ${po.docNo}?`,
    message: `${po.docNo} is sent to ${po.supplierName} and locked. Corrections then go through Cancel order, Purchase return or Supplier debit note.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      const result = await ordersApi.release(po.id, po.version)
      toast.add({ severity: 'success', summary: `${po.docNo} released`, detail: result.activity[0]?.message ?? '', life: 4000 })
      selection.value = []
      void list.reload()
    },
  })
}

function deleteDraft() {
  const po = selected.value
  if (!po) return
  confirm.require({
    header: `Delete ${po.docNo}?`,
    message: `The draft is removed. Its number ${po.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await ordersApi.remove(po.id, po.version)
      toast.add({ severity: 'success', summary: `${po.docNo} deleted`, life: 3000 })
      selection.value = []
      notifyApprovalsChanged()
      void list.reload()
    },
  })
}

// ── Columns ──────────────────────────────────────────────────────────────────
const OPTIONAL = [
  { key: 'date', label: 'Date' },
  { key: 'source', label: 'Source' },
  { key: 'received', label: 'Received' },
  { key: 'invoiced', label: 'Invoiced' },
] as const
const COLS_KEY = 'zora.poList.columns'
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

// ── Import / export ──────────────────────────────────────────────────────────
function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of purchase orders comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: OrderListItem[] = []
  for (let page = 1; ; page++) {
    const result = await ordersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['PO no', 'Date', 'Supplier', 'Source', 'Total (RM)', 'Received', 'Ordered', 'Billed', 'Status'].map(cell).join(','),
    ...all.map((o) =>
      [o.docNo, o.docDate, o.supplierName, o.source.label, o.total, formatQty(o.receivedQty), formatQty(o.orderedQty), formatQty(o.billedQty), o.statusLabel]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `purchase-orders-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const footer = computed(() => {
  const s = list.data.value?.summary
  return s ? `${s.count} ${s.count === 1 ? 'order' : 'orders'} · RM ${formatMoney(s.total)} in total, tax included` : ''
})
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Purchase Order" subtitle="Orders placed with suppliers. Released orders are sent to the supplier and wait for goods.">
      <template #actions>
        <RouterLink v-if="can('purchase.order.edit')" to="/purchase/orders/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new PO
        </RouterLink>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!canDo('submit')" @click="sendForApproval">Send for approval</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="!canDo('release')" @click="release">Release</button>
        <button type="button" class="erp-btn erp-btn-delete" :disabled="!canDo('delete')" @click="deleteDraft">Delete draft</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <select
        class="erp-input"
        aria-label="Filter by buyer"
        :value="list.params.value.buyer"
        @change="list.setFilter('buyer', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">Filter by buyer</option>
        <option v-for="b in buyers" :key="b.code" :value="b.code">{{ b.name }}</option>
      </select>
      <select
        class="erp-input"
        aria-label="Filter by branch"
        :value="list.params.value.branch"
        @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)"
      >
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
      <span class="text-xs text-erp-muted">{{ selectionText }}</span>
      <div class="flex gap-2">
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        <button type="button" class="erp-btn erp-btn-secondary" @click="columnsPanel?.toggle($event)">Select columns</button>
        <Popover ref="columnsPanel">
          <div class="flex flex-col gap-2 p-1 text-[13px]">
            <label v-for="c in OPTIONAL" :key="c.key" class="flex items-center gap-2">
              <input
                type="checkbox"
                :checked="show(c.key)"
                @change="hidden = show(c.key) ? [...hidden, c.key] : hidden.filter((h) => h !== c.key)"
              />
              {{ c.label }}
            </label>
          </div>
        </Popover>
      </div>
    </div>

    <div v-if="list.failed.value" class="flex items-center justify-between rounded-lg bg-note-error-bg px-4 py-3 text-[13px] text-note-error-text">
      The orders could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList v-model:selection="selection" :rows="rows" :loading="list.loading.value" selectable empty-text="No purchase orders match these filters.">
      <Column selection-mode="multiple" header-style="width: 44px" />
      <Column header="PO no">
        <template #body="{ data }: { data: OrderListItem }">
          <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
          <RouterLink v-else :to="`/purchase/orders/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column v-if="show('date')" header="Date">
        <template #body="{ data }: { data: OrderListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Supplier" field="supplierName" />
      <Column v-if="show('source')" header="Source">
        <template #body="{ data }: { data: OrderListItem }">
          <RouterLink
            v-if="(data.source.type === 'RFQ' || data.source.type === 'REQUEST') && data.source.id"
            :to="docRoute(data.source.type === 'RFQ' ? 'PUR_RFQ' : 'PUR_REQUEST', data.source.id)!"
            class="erp-link whitespace-nowrap"
            >{{ data.source.label }}</RouterLink
          >
          <span v-else class="whitespace-nowrap" :class="{ 'text-erp-muted': data.source.type === 'BUYER' || data.source.type === 'MIGRATED' }">
            {{ data.source.label }}
          </span>
        </template>
      </Column>
      <Column header="Total (RM)" class="erp-col-num">
        <template #body="{ data }: { data: OrderListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column v-if="show('received')" header="Received">
        <template #body="{ data }: { data: OrderListItem }"><QtyProgress :done="data.receivedQty" :total="data.orderedQty" /></template>
      </Column>
      <Column v-if="show('invoiced')" header="Invoiced">
        <template #body="{ data }: { data: OrderListItem }">
          <span v-if="data.openInvoice" class="whitespace-nowrap text-attention">{{ data.openInvoice.docNo }} · {{ data.openInvoice.state }}</span>
          <QtyProgress v-else-if="Number(data.billedQty) > 0" :done="data.billedQty" :total="data.orderedQty" />
          <span v-else class="text-erp-muted">—</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: OrderListItem }">
          <StatusChip :status="data.approved ? 'APPROVED' : data.status" :label="data.status === 'PARTIAL' ? 'Partial' : data.statusLabel" />
        </template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ footer }}</span>
      <Pager
        v-if="list.data.value"
        :page="list.data.value.page"
        :page-size="list.data.value.pageSize"
        :total="list.data.value.total"
        @change="list.setPage"
      />
    </div>
  </section>
</template>
