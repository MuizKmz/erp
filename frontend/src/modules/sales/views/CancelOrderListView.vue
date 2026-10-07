<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import { salesCancelOrdersApi } from '../api/sales'
import type { CancelListItem, CancelOpenOrder } from '../types'

/** S13 · List of Cancel Order (CancelOrderList.html) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['customer', 'order', 'reason'], fetch: salesCancelOrdersApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
]

const openOrders = ref<CancelOpenOrder[]>([])
onMounted(async () => {
  openOrders.value = (await salesCancelOrdersApi.openOrders()).items
})

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
const datePlaceholder = computed(() => (today.value ? `Filter by date: 01 Aug – ${formatDate(today.value)}` : 'Filter by date'))

const footer = computed(() => {
  const d = list.data.value
  if (!d) return ''
  const since = d.totals.since ? new Date(`${d.totals.since}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' }) : ''
  return `${d.total} ${d.total === 1 ? 'cancellation' : 'cancellations'} · RM ${formatMoney(d.totals.value)}${since ? ` since ${since}` : ''}`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of cancellations comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: CancelListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesCancelOrdersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['CO no', 'Date', 'Sales order', 'Customer', 'What', 'Value (RM)', 'Reason', 'Status'].map(cell).join(','),
    ...all.map((c) => [c.docNo, c.docDate, c.salesOrderNo, c.customerName, c.summary ?? '', c.total, c.reason, c.status === 'DRAFT' ? 'Draft' : 'Released'].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `cancel-orders-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="List of Cancel Order" subtitle="Closes the part of a sales order that will never be delivered. Delivered goods go back through a sales return instead.">
        <template #actions>
          <RouterLink v-if="can('sales.cancel_order.edit')" to="/sales/cancel-orders/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New cancellation</RouterLink>
          <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
          <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        </template>
      </PageHeader>

      <FilterBar>
        <input v-model="customerText" class="erp-input" placeholder="Filter by customer" aria-label="Filter by customer" />
        <input v-model="orderText" class="erp-input" placeholder="Filter by sales order no" aria-label="Filter by sales order no" />
        <select class="erp-input" aria-label="Filter by reason" :value="list.params.value.reason" @change="list.setFilter('reason', ($event.target as HTMLSelectElement).value)">
          <option value="">Filter by reason</option>
          <option v-for="r in list.data.value?.reasons ?? []" :key="r" :value="r">{{ r }}</option>
        </select>
        <DatePicker v-model="dateRange" selection-mode="range" date-format="d M yy" :placeholder="datePlaceholder" :manual-input="false" show-button-bar fluid class="erp-date" @update:model-value="onDateRange" @clear-click="onDateRange(null)" />
      </FilterBar>

      <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

      <DataList :rows="rows" :loading="list.loading.value" empty-text="No cancellations match these filters.">
        <Column header="CO no">
          <template #body="{ data }: { data: CancelListItem }">
            <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
            <RouterLink v-else :to="`/sales/cancel-orders/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
          </template>
        </Column>
        <Column header="Date">
          <template #body="{ data }: { data: CancelListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
        </Column>
        <Column header="Sales order">
          <template #body="{ data }: { data: CancelListItem }">
            <span class="whitespace-nowrap">{{ data.salesOrderNo }}</span>
          </template>
        </Column>
        <Column header="Customer" field="customerName" />
        <Column header="What" field="summary" />
        <Column header="Value (RM)" class="erp-col-num">
          <template #body="{ data }: { data: CancelListItem }"><MoneyText :value="data.total" /></template>
        </Column>
        <Column header="Reason" field="reason" />
        <Column header="Status">
          <template #body="{ data }: { data: CancelListItem }">
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
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="m-0 text-[15px] font-bold">Sales orders with an open balance</h2>
          <span class="text-xs text-erp-muted">Released or partly delivered</span>
        </div>
        <table class="erp-table">
          <thead><tr><th>Sales order</th><th>Customer</th><th class="num">Open</th><th>Promised</th><th>Waiting for</th><th aria-label="Action" /></tr></thead>
          <tbody>
            <tr v-if="!openOrders.length"><td colspan="6" class="text-center text-erp-muted">No sales order has an open balance.</td></tr>
            <tr v-for="o in openOrders" :key="o.id">
              <td><RouterLink :to="`/sales/orders/${o.id}`" class="erp-link font-semibold whitespace-nowrap">{{ o.docNo }}</RouterLink></td>
              <td>{{ o.customerName }}</td>
              <td class="num whitespace-nowrap">{{ o.open }}</td>
              <td class="whitespace-nowrap">{{ formatDate(o.promisedDate ?? '') || '—' }}</td>
              <td>{{ o.waitingFor }}</td>
              <td class="text-right">
                <span v-if="o.linkedToPo" class="text-xs whitespace-nowrap text-erp-muted" title="Purchase is warned before the balance is cancelled">Linked to a PO</span>
                <RouterLink v-else-if="can('sales.cancel_order.edit')" :to="`/sales/cancel-orders/new?order=${o.id}`" class="erp-btn erp-btn-secondary whitespace-nowrap">Cancel balance</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <NextSteps title="Cancel or return?">
        <li><span><strong>Cancel</strong> what has not been delivered. Nothing is posted to accounts.</span></li>
        <li><span><strong>Return</strong> what was delivered and invoiced. It creates a credit note.</span></li>
        <li><span>A buy-to-order line linked to a PO warns Purchase before it can be cancelled.</span></li>
        <template #footer><RouterLink to="/sales/returns" class="erp-link text-[13px] font-semibold">Go to Sales Return →</RouterLink></template>
      </NextSteps>
    </div>
  </div>
</template>
