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
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatQty, formatRm } from '@/utils/format'
import { returnsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ReturnListItem, ReturnOverview } from '../types'

/** P22 · List of Purchase Return and credit notes to chase (PurReturnList.html, FlowP6 step 5) */
const toast = useToast()
const { can, today } = useSession()

const overview = ref<ReturnOverview | null>(null)
async function loadOverview() {
  overview.value = await returnsApi.overview()
}
onMounted(loadOverview)
const kpis = computed(() => overview.value?.kpis)

const list = useListPage({ filterKeys: ['supplier', 'grnNo', 'reason'], fetch: returnsApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Waiting for credit' },
  { key: 'settled', label: 'Settled' },
]
const CHIP = { DRAFT: { group: 'draft', label: 'Draft' }, RELEASED: { group: 'pending', label: 'Waiting for credit' }, SETTLED: { group: 'done', label: 'Settled' } } as const

function debounced(key: 'supplier' | 'grnNo') {
  const text = ref(list.params.value[key] ?? '')
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => list.setFilter(key, value.trim()), 350)
  })
  return text
}
const supplierText = debounced('supplier')
const grnText = debounced('grnNo')

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
const grnRoute = (id: string | null, no: string) => (isLegacyNo(no) ? null : docRoute('PUR_RECEIPT', id))

const reminding = ref('')
async function remind(id: string, docNo: string) {
  reminding.value = id
  try {
    await returnsApi.remind(id)
    toast.add({ severity: 'success', summary: 'Reminder sent', detail: `The supplier gets the ${docNo} return notice again.`, life: 3500 })
    await loadOverview()
  } finally {
    reminding.value = ''
  }
}

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of returns comes later.', life: 3000 })
}
async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: ReturnListItem[] = []
  for (let page = 1; ; page++) {
    const result = await returnsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Return no', 'Date', 'Supplier', 'What', 'From receipt', 'Reason', 'Value (RM)', 'Settled by', 'Status'].map(cell).join(','),
    ...all.map((r) => [r.docNo, r.docDate, r.supplierName, r.summary ?? '', r.grnNo, r.reason, r.total, r.settledBy, CHIP[r.status].label].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `purchase-returns-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="grid grid-cols-4 gap-3.5">
    <KpiCard
      compact
      :tone="kpis?.waitingCredit.count ? 'warning' : 'default'"
      label="Waiting for supplier credit"
      :value="kpis ? formatRm(kpis.waitingCredit.total) : ''"
      :sub="kpis?.waitingCredit.first ?? 'Nothing to chase'"
      :loading="!kpis"
    />
    <KpiCard
      compact
      label="Returned this month"
      :value="kpis ? `${kpis.thisMonth.count} ${kpis.thisMonth.count === 1 ? 'return' : 'returns'}` : ''"
      :sub="kpis ? `${formatQty(kpis.thisMonth.units)} units back to suppliers` : ''"
      :loading="!kpis"
    />
    <KpiCard
      compact
      label="Top reason"
      :value="kpis?.topReason?.name ?? '—'"
      :sub="kpis?.topReason ? `${kpis.topReason.count} of ${kpis.topReason.of} returns` : 'No returns this month'"
      :loading="!kpis"
    />
    <KpiCard
      compact
      :tone="overview?.inventoryConnected ? 'default' : 'warning'"
      label="Waiting for Inventory"
      :value="kpis ? `${kpis.waitingInventory.count} ${kpis.waitingInventory.count === 1 ? 'stock-out' : 'stock-outs'}` : ''"
      :sub="overview?.inventoryConnected ? 'Posted as soon as a return is released' : 'Posts when Inventory plugs in'"
      :loading="!kpis"
    />
  </div>

  <section class="erp-card flex flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Purchase Return" subtitle="Goods sent back to a supplier after they were received. Each return waits for a credit note or a replacement.">
      <template #actions>
        <RouterLink v-if="can('purchase.return.edit')" to="/purchase/returns/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New return</RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <input v-model="grnText" class="erp-input" placeholder="Filter by GRN no" aria-label="Filter by GRN no" />
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

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No returns match these filters.">
      <Column header="Return no">
        <template #body="{ data }: { data: ReturnListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/returns/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: ReturnListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Supplier">
        <template #body="{ data }: { data: ReturnListItem }"><span class="whitespace-nowrap">{{ data.supplierName }}</span></template>
      </Column>
      <Column header="What · from receipt">
        <template #body="{ data }: { data: ReturnListItem }">
          <div class="whitespace-nowrap">{{ data.summary }}</div>
          <RouterLink v-if="grnRoute(data.grnId, data.grnNo)" :to="grnRoute(data.grnId, data.grnNo)!" class="erp-link text-xs">{{ data.grnNo }}</RouterLink>
          <div v-else class="text-xs text-erp-muted">{{ data.grnNo }}</div>
        </template>
      </Column>
      <Column header="Reason">
        <template #body="{ data }: { data: ReturnListItem }"><span class="whitespace-nowrap">{{ data.reason }}</span></template>
      </Column>
      <Column header="Value (RM)" class="erp-col-num">
        <template #body="{ data }: { data: ReturnListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column header="Settled by">
        <template #body="{ data }: { data: ReturnListItem }"><span class="whitespace-nowrap">{{ data.settledBy }}</span></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: ReturnListItem }"><StatusChip :status="data.status" :group="CHIP[data.status].group" :label="CHIP[data.status].label" /></template>
      </Column>
    </DataList>

    <div v-if="list.data.value && list.data.value.total > list.data.value.pageSize" class="flex justify-end">
      <Pager :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <div class="flex grow gap-4">
    <section class="erp-card flex grow flex-col gap-2.5 px-5 py-4">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Credit notes to chase</h2>
        <span class="text-xs text-erp-muted">Returns released but not yet settled</span>
      </div>
      <p v-if="overview && !overview.chase.length" class="m-0 text-[13px] text-erp-muted">Every return is settled.</p>
      <table v-else-if="overview" class="erp-table">
        <thead>
          <tr>
            <th>Return</th>
            <th>Supplier</th>
            <th class="num">Expected (RM)</th>
            <th>Goods left</th>
            <th>Supplier's RMA</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in overview.chase" :key="c.id">
            <td><RouterLink :to="`/purchase/returns/${c.id}`" class="erp-link whitespace-nowrap">{{ c.docNo }}</RouterLink></td>
            <td>{{ c.supplierName }}</td>
            <td class="num"><MoneyText :value="c.settleBy === 'CREDIT_NOTE' ? c.total : null" /><span v-if="c.settleBy !== 'CREDIT_NOTE'" class="text-xs text-erp-muted">replacement</span></td>
            <td><span class="whitespace-nowrap">{{ c.collection ?? '—' }}</span></td>
            <td>{{ c.rmaNo ?? '—' }}</td>
            <td class="w-[100px]">
              <button v-if="c.canRemind" type="button" class="erp-btn erp-btn-secondary h-[30px]" :disabled="reminding === c.id" @click="remind(c.id, c.docNo)">Remind</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="overview" class="mt-1 grid grid-cols-3 gap-3 border-t border-erp-row pt-3">
        <div class="flex flex-col gap-0.5"><span class="text-xs text-erp-muted">Average days to get a credit note</span><strong>{{ overview.stats.averageDaysToCredit === null ? '—' : `${overview.stats.averageDaysToCredit} days` }}</strong></div>
        <div class="flex flex-col gap-0.5"><span class="text-xs text-erp-muted">Settled by replacement</span><strong>{{ overview.stats.byReplacement }} of {{ overview.stats.of }}</strong></div>
        <div class="flex flex-col gap-0.5"><span class="text-xs text-erp-muted">Settled by credit note</span><strong>{{ overview.stats.byCreditNote }} of {{ overview.stats.of }}</strong></div>
      </div>
    </section>

    <NextSteps title="Return or cancel?" class="w-[380px] shrink-0">
      <li><span><strong>Return</strong> goods that arrived but are wrong, damaged or too many.</span></li>
      <li><span><strong>Cancel</strong> goods that have not arrived. Nothing moves in stock.</span></li>
      <li><span>Every return starts from a goods receipt, so you can never send back more than came in.</span></li>
      <template #footer>
        <RouterLink to="/purchase/cancel-orders" class="erp-link text-xs font-semibold">Go to Cancel Order →</RouterLink>
      </template>
    </NextSteps>
  </div>
</template>
