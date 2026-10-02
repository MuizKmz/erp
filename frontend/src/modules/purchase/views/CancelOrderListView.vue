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
import { formatDate } from '@/utils/format'
import { cancelOrdersApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { CancelOrderListItem, OpenBalance } from '../types'

/** P12 · List of Cancel Order and orders with an open balance (PoCancelList.html, FlowP6 step 2) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['supplier', 'poNo', 'reason'], fetch: cancelOrdersApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const reasons = computed(() => list.data.value?.reasons ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
]

const balances = ref<OpenBalance[] | null>(null)
onMounted(async () => {
  balances.value = (await cancelOrdersApi.openBalances()).items
})

function debounced(key: 'supplier' | 'poNo') {
  const text = ref(list.params.value[key] ?? '')
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => list.setFilter(key, value.trim()), 350)
  })
  return text
}
const supplierText = debounced('supplier')
const poText = debounced('poNo')

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
const poRoute = (id: string | null, no: string) => (isLegacyNo(no) ? null : docRoute('PUR_ORDER', id))

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of cancellations comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: CancelOrderListItem[] = []
  for (let page = 1; ; page++) {
    const result = await cancelOrdersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Cancel no', 'Date', 'Purchase order', 'Supplier', 'What', 'Value (RM)', 'Reason', 'Status'].map(cell).join(','),
    ...all.map((r) => [r.docNo, r.docDate, r.poNo, r.supplierName, r.summary ?? '', r.totalValue, r.reason, r.status].map(cell).join(',')),
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
  <section class="erp-card flex flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Cancel Order" subtitle="Cancelled balances of purchase orders. Each one is kept for audit and releases committed spend.">
      <template #actions>
        <RouterLink v-if="can('purchase.cancel_order.edit')" to="/purchase/cancel-orders/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New cancellation
        </RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <input v-model="poText" class="erp-input" placeholder="Filter by PO no" aria-label="Filter by PO no" />
      <select class="erp-input" aria-label="Filter by reason" :value="list.params.value.reason" @change="list.setFilter('reason', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by reason</option>
        <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
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
      The cancellations could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No cancellations match these filters.">
      <Column header="Cancel no">
        <template #body="{ data }: { data: CancelOrderListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/cancel-orders/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: CancelOrderListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Purchase order">
        <template #body="{ data }: { data: CancelOrderListItem }">
          <RouterLink v-if="poRoute(data.poId, data.poNo)" :to="poRoute(data.poId, data.poNo)!" class="erp-link">{{ data.poNo }}</RouterLink>
          <template v-else>{{ data.poNo }}</template>
        </template>
      </Column>
      <Column header="Supplier" field="supplierName" />
      <Column header="What" field="summary" />
      <Column header="Value (RM)" class="erp-col-num">
        <template #body="{ data }: { data: CancelOrderListItem }"><MoneyText :value="data.totalValue" /></template>
      </Column>
      <Column header="Reason" field="reason" />
      <Column header="Status">
        <template #body="{ data }: { data: CancelOrderListItem }"><StatusChip :status="data.status" :group="data.status === 'RELEASED' ? 'done' : 'draft'" /></template>
      </Column>
    </DataList>

    <div v-if="list.data.value && list.data.value.total > list.data.value.pageSize" class="flex justify-end">
      <Pager :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <div class="flex grow gap-4">
    <section class="erp-card flex grow flex-col gap-2.5 px-5 py-4">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Orders with an open balance</h2>
        <span class="text-xs text-erp-muted">Released or partial, past or near the expected date</span>
      </div>
      <p v-if="balances && !balances.length" class="m-0 text-[13px] text-erp-muted">No order is late or due in the next few days.</p>
      <table v-else-if="balances" class="erp-table">
        <thead>
          <tr>
            <th>Purchase order</th>
            <th>Supplier</th>
            <th class="num">Open</th>
            <th>Expected</th>
            <th>Supplier says</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in balances" :key="b.poId">
            <td>
              <RouterLink v-if="poRoute(b.poId, b.poNo)" :to="poRoute(b.poId, b.poNo)!" class="erp-link font-semibold">{{ b.poNo }}</RouterLink>
              <strong v-else>{{ b.poNo }}</strong>
            </td>
            <td>{{ b.supplierName }}</td>
            <td class="num">{{ b.openText }}</td>
            <td><span class="whitespace-nowrap" :class="{ 'text-note-error-text': b.late }">{{ formatDate(b.expected) }}</span></td>
            <td>{{ b.supplierSays ?? '—' }}</td>
            <td class="w-[130px]">
              <RouterLink v-if="b.cancelOrder" :to="`/purchase/cancel-orders/${b.cancelOrder.id}`" class="text-xs font-semibold text-note-warn-strong">{{ b.cancelOrder.docNo }} drafted</RouterLink>
              <RouterLink v-else-if="b.action === 'RECEIVE'" :to="{ path: '/purchase/receipts/new', query: { po: b.poId } }" class="erp-btn erp-btn-secondary h-[30px]">Receive</RouterLink>
              <RouterLink v-else-if="b.action === 'CANCEL'" :to="{ path: '/purchase/cancel-orders/new', query: { po: b.poId } }" class="erp-btn erp-btn-secondary h-[30px]">Cancel</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="m-0 py-4 text-center text-[13px] text-erp-muted">Loading…</p>
    </section>

    <NextSteps title="Cancel or return?" class="w-[380px] shrink-0">
      <li><span><strong>Cancel</strong> when goods have <em>not</em> arrived and will not come. Nothing moves in stock.</span></li>
      <li><span><strong>Return</strong> when goods arrived but are wrong or damaged. Use Purchase Return.</span></li>
      <li><span>A PO with invoices can still be cancelled for the part that was never received.</span></li>
      <template #footer>
        <RouterLink to="/purchase/returns" class="erp-link text-xs font-semibold">Go to Purchase Return →</RouterLink>
      </template>
    </NextSteps>
  </div>
</template>
