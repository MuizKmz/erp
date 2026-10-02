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
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatRm, percentOf } from '@/utils/format'
import { cashPurchasesApi, lookupsApi } from '../api/purchase'
import type { CashOverview, CashPurchaseListItem, PaymentMethodOption } from '../types'

/** P18 · List of Cash Purchase (CashPurchaseList.html, FlowP7) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['supplier', 'paidBy', 'branch'], fetch: cashPurchasesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
]

const overview = ref<CashOverview | null>(null)
const methods = ref<PaymentMethodOption[]>([])
const branches = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  const [o, m, b] = await Promise.all([cashPurchasesApi.overview(), cashPurchasesApi.paymentMethods(), lookupsApi.branches()])
  overview.value = o
  methods.value = m.items
  branches.value = b.items
})

const supplierText = ref(list.params.value.supplier ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch(supplierText, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('supplier', value.trim()), 350)
})
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateRange = ref<Date[] | null>(null)
function onDateRange(value: Date | Date[] | (Date | null)[] | null | undefined) {
  const [from, to] = Array.isArray(value) ? value : []
  if (!value || (from && to)) list.setFilters({ dateFrom: from ? isoDay(from) : undefined, dateTo: to ? isoDay(to) : undefined })
}
const datePlaceholder = computed(() =>
  today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date',
)
const footer = computed(() => (overview.value ? `${overview.value.count} cash purchases · RM ${formatMoney(overview.value.total)} in ${overview.value.month}` : ''))

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of cash purchases comes later.', life: 3000 })
}
async function exportCsv() {
  const all = (await cashPurchasesApi.list({ ...list.params.value, status: list.params.value.status === 'all' ? undefined : list.params.value.status, page: 1, pageSize: 100 })).items
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['CP no', 'Date', 'Supplier', 'What', 'Paid by', 'Bought by', 'Total (RM)', 'Status'].map(cell).join(','),
    ...all.map((r) => [r.docNo, r.docDate, r.supplierName, r.summary ?? '', r.paidByLabel, r.boughtByName, r.total, r.status].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `cash-purchases-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Cash Purchase" subtitle="Small buys paid on the spot, with no purchase order. The receipt photo is the proof.">
      <template #actions>
        <RouterLink v-if="can('purchase.cash_purchase.edit')" to="/purchase/cash-purchases/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New cash purchase</RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <select class="erp-input" aria-label="Filter by paid by" :value="list.params.value.paidBy" @change="list.setFilter('paidBy', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by paid by</option>
        <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.label }}</option>
      </select>
      <select class="erp-input" aria-label="Filter by branch" :value="list.params.value.branch" @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by branch</option>
        <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
      </select>
      <DatePicker v-model="dateRange" selection-mode="range" date-format="d M yy" :placeholder="datePlaceholder" :manual-input="false" show-button-bar fluid class="erp-date" @update:model-value="onDateRange" @clear-click="onDateRange(null)" />
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No cash purchases match these filters.">
      <Column header="CP no">
        <template #body="{ data }: { data: CashPurchaseListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/cash-purchases/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: CashPurchaseListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Supplier" field="supplierName" />
      <Column header="What">
        <template #body="{ data }: { data: CashPurchaseListItem }"><span class="whitespace-nowrap">{{ data.summary }}</span></template>
      </Column>
      <Column header="Paid by">
        <template #body="{ data }: { data: CashPurchaseListItem }"><span class="whitespace-nowrap">{{ data.paidByLabel }}</span></template>
      </Column>
      <Column header="Bought by" field="boughtByName" />
      <Column header="Total (RM)" class="erp-col-num">
        <template #body="{ data }: { data: CashPurchaseListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column header="Receipt">
        <template #body="{ data }: { data: CashPurchaseListItem }">
          <span v-if="data.receipt === 'PHOTO'" class="font-semibold whitespace-nowrap text-chip-done-text">✓ Photo</span>
          <span v-else-if="data.receipt === 'MISSING'" class="font-semibold whitespace-nowrap text-note-error-text">Missing</span>
          <span v-else class="text-erp-muted">Old system</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: CashPurchaseListItem }"><StatusChip :status="data.status" :group="data.status === 'RELEASED' ? 'done' : 'draft'" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ footer }}</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <div v-if="overview" class="grid grid-cols-3 items-start gap-4">
    <SideCard :title="`${overview.month} by payment method`">
      <div v-for="m in overview.byMethod" :key="m.code" class="flex flex-col gap-1.5 text-[13px]">
        <div class="flex justify-between gap-3"><span>{{ m.label }}</span><strong class="erp-num">{{ formatRm(m.total) }}</strong></div>
        <div class="h-1.5 overflow-hidden rounded bg-erp-track"><div class="h-full bg-mod-line" :style="{ width: `${percentOf(m.total, overview.total)}%` }" /></div>
      </div>
      <div class="flex justify-between gap-3 border-t border-erp-row pt-2 text-[13px]"><span>Total this month</span><strong class="erp-num">{{ formatRm(overview.total) }}</strong></div>
    </SideCard>
    <SideCard v-for="f in overview.floats" :key="f.code" :title="`Petty cash float · ${f.branchCode}`">
      <div class="flex flex-col text-[13px] erp-num">
        <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Float</span><span>{{ formatRm(f.float) }}</span></div>
        <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Spent in {{ overview.month }}</span><span>{{ formatRm(f.spent) }}</span></div>
        <div class="flex justify-between gap-3 py-[7px]"><span>Left</span><strong>{{ formatRm(f.left) }}</strong></div>
      </div>
      <p class="m-0 text-xs text-erp-muted">Next top-up once Finance is connected.</p>
    </SideCard>
    <NextSteps title="Cash purchase rules">
      <li><span>Up to <strong>{{ formatRm(overview.limit) }}</strong> per receipt. Anything bigger needs a purchase order.</span></li>
      <li><span>A photo of the receipt is required before release.</span></li>
      <li><span>Goods count as received at once. The stock event is queued for Inventory.</span></li>
      <template #footer><RouterLink to="/purchase/settings/approval-rules" class="erp-link text-xs font-semibold">See Approval Rules →</RouterLink></template>
    </NextSteps>
  </div>
</template>
