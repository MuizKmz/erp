<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Popover from 'primevue/popover'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
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
import { lookupsApi, requestsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { RequestListItem } from '../types'

/** P05 · List of Purchase Request (PurRequestList.html) */
const router = useRouter()
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['requester', 'department', 'branch'], fetch: requestsApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'converted', label: 'Converted' },
  { key: 'rejected', label: 'Rejected' },
]

// ── Filters ──────────────────────────────────────────────────────────────────
const branches = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  branches.value = (await lookupsApi.branches()).items
})
const departments = computed(() => list.data.value?.departments ?? [])

const requesterText = ref(list.params.value.requester ?? '')
let requesterTimer: ReturnType<typeof setTimeout> | undefined
watch(requesterText, (value) => {
  clearTimeout(requesterTimer)
  requesterTimer = setTimeout(() => list.setFilter('requester', value.trim()), 350)
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
const datePlaceholder = computed(() =>
  today.value ? `Filter by date: 01 ${formatDate(today.value).split(' ')[1]} – ${formatDate(today.value)}` : 'Filter by date',
)

// ── Selection and actions ────────────────────────────────────────────────────
const selection = ref<RequestListItem[]>([])
watch(rows, () => (selection.value = selection.value.filter((s) => rows.value.some((r) => r.id === s.id))))
const selected = computed(() => (selection.value.length === 1 ? selection.value[0]! : null))
const canDo = (action: RequestListItem['allowedActions'][number]) => Boolean(selected.value?.allowedActions.includes(action))

const selectionText = computed(() => {
  if (!selection.value.length) return 'Requests come from the Demand list, from staff, or from buy-to-order sales lines.'
  if (!selected.value) return `${selection.value.length} selected · pick one submitted request for these actions`
  const s = selected.value
  return s.status === 'SUBMITTED' ? `1 selected · ${s.docNo} is waiting for Purchasing` : `1 selected · ${s.docNo} is ${s.status.toLowerCase()}`
})

/** Both buttons open the request: the buyer sees stock, sales orders and prices before deciding. */
function createPo() {
  if (selected.value) void router.push({ path: `/purchase/requests/${selected.value.id}`, query: { do: 'po' } })
  else void router.push('/purchase/orders/new')
}
function createRfq() {
  void router.push({ path: '/purchase/rfqs/new', query: selected.value ? { request: selected.value.id } : {} })
}

// ── Columns ──────────────────────────────────────────────────────────────────
const OPTIONAL = [
  { key: 'date', label: 'Date' },
  { key: 'neededBy', label: 'Needed by' },
  { key: 'turnedInto', label: 'Turned into' },
] as const
const COLS_KEY = 'zora.requestList.columns'
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

const requesterLine = (r: RequestListItem) => [r.requesterTitle, r.department].filter(Boolean).join(' · ')

// ── Import / export ──────────────────────────────────────────────────────────
function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of purchase requests comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: RequestListItem[] = []
  for (let page = 1; ; page++) {
    const result = await requestsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Request no', 'Date', 'Requested by', 'Department', 'What', 'Needed by', 'Est. value (RM)', 'Turned into', 'Status'].map(cell).join(','),
    ...all.map((r) =>
      [
        r.docNo,
        r.docDate,
        r.requestedByName,
        r.department ?? '',
        r.summary ?? '',
        r.neededBy ?? '',
        r.estValue,
        r.turnedInto.map((c) => c.map((d) => d.docNo).join(' → ')).join(', '),
        r.status,
      ]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `purchase-requests-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const footer = computed(() => {
  const d = list.data.value
  if (!d) return ''
  const waiting = d.statusCounts.submitted ?? 0
  return `${d.total} ${d.total === 1 ? 'request' : 'requests'} · ${waiting} waiting for Purchasing`
})
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Purchase Request" subtitle="Anyone can ask for something to be bought. Purchasing turns requests into RFQs or purchase orders.">
      <template #actions>
        <RouterLink v-if="can('purchase.request.create')" to="/purchase/requests/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new request
        </RouterLink>
        <template v-if="can('purchase.request.process')">
          <button type="button" class="erp-btn erp-btn-primary" :disabled="Boolean(selected) && !canDo('toRfq')" @click="createRfq">Create RFQ</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="Boolean(selected) && !canDo('toPo')" @click="createPo">Create PO directly</button>
        </template>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="requesterText" class="erp-input" placeholder="Filter by requester" aria-label="Filter by requester" />
      <select
        class="erp-input"
        aria-label="Filter by department"
        :value="list.params.value.department"
        @change="list.setFilter('department', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">Filter by department</option>
        <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
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
      The requests could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList v-model:selection="selection" :rows="rows" :loading="list.loading.value" selectable empty-text="No purchase requests match these filters.">
      <Column selection-mode="multiple" header-style="width: 44px" />
      <Column header="Request no">
        <template #body="{ data }: { data: RequestListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/requests/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column v-if="show('date')" header="Date">
        <template #body="{ data }: { data: RequestListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Requested by">
        <template #body="{ data }: { data: RequestListItem }">
          <div class="whitespace-nowrap">{{ data.requestedByName }}</div>
          <div v-if="requesterLine(data)" class="text-xs whitespace-nowrap text-erp-muted">{{ requesterLine(data) }}</div>
        </template>
      </Column>
      <Column header="What">
        <template #body="{ data }: { data: RequestListItem }"><span class="whitespace-nowrap">{{ data.summary }}</span></template>
      </Column>
      <Column v-if="show('neededBy')" header="Needed by">
        <template #body="{ data }: { data: RequestListItem }"><span class="whitespace-nowrap">{{ formatDate(data.neededBy) || '—' }}</span></template>
      </Column>
      <Column header="Est. value (RM)" class="erp-col-num">
        <template #body="{ data }: { data: RequestListItem }"><MoneyText :value="data.estValue" /></template>
      </Column>
      <Column v-if="show('turnedInto')" header="Turned into">
        <template #body="{ data }: { data: RequestListItem }">
          <span v-if="data.status === 'REJECTED'" class="text-xs text-erp-muted">{{ data.rejectReason || 'Rejected' }}</span>
          <span v-else-if="!data.turnedInto.length" class="text-erp-muted">—</span>
          <span v-else class="whitespace-nowrap">
            <template v-for="(chain, ci) in data.turnedInto" :key="ci">
              <template v-if="ci > 0">, </template>
              <template v-for="(d, di) in chain" :key="d.docNo">
                <template v-if="di > 0"> → </template>
                <RouterLink v-if="docRoute(d.type, d.id) && !isLegacyNo(d.docNo)" :to="docRoute(d.type, d.id)!" class="erp-link">{{ d.docNo }}</RouterLink>
                <template v-else>{{ d.docNo }}</template>
              </template>
            </template>
          </span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: RequestListItem }"><StatusChip :status="data.status" /></template>
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
