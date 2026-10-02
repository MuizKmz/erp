<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatDayMonth, formatMoney } from '@/utils/format'
import { lookupsApi, rfqsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { RfqListItem, RfqOpenReply } from '../types'

/** P07 · List of Request for Quotation (RfqList.html) */
const toast = useToast()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['item', 'supplier', 'buyer'], fetch: rfqsApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting for replies' },
  { key: 'ready', label: 'Ready to compare' },
  { key: 'awarded', label: 'Awarded' },
  { key: 'closed', label: 'Closed without order' },
]

// ── Filters ──────────────────────────────────────────────────────────────────
const buyers = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  buyers.value = (await lookupsApi.users('PURCHASE_BUYER')).items
})

function debounced(key: 'item' | 'supplier') {
  const text = ref(list.params.value[key] ?? '')
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => list.setFilter(key, value.trim()), 350)
  })
  return text
}
const itemText = debounced('item')
const supplierText = debounced('supplier')

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

// ── Replies still open ───────────────────────────────────────────────────────
const openReplies = computed(() => list.data.value?.openReplies ?? [])
const reminding = ref('')
async function remind(r: RfqOpenReply) {
  reminding.value = `${r.rfqId}/${r.supplierCode}`
  try {
    await rfqsApi.remind(r.rfqId, r.supplierCode)
    toast.add({ severity: 'success', summary: 'Reminder sent', detail: `${r.supplierName} gets the ${r.rfqNo} email again with their reply link.`, life: 3500 })
    void list.reload()
  } finally {
    reminding.value = ''
  }
}
const replyText = (r: RfqOpenReply) => [r.unitPrice ? `RM ${formatMoney(r.unitPrice)} each` : 'Quoted', r.leadTimeText].filter(Boolean).join(' · ')

// ── Import / export ──────────────────────────────────────────────────────────
function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of RFQs comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: RfqListItem[] = []
  for (let page = 1; ; page++) {
    const result = await rfqsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['RFQ no', 'Sent', 'What', 'Source', 'Replies', 'Reply by', 'Awarded to', 'Status'].map(cell).join(','),
    ...all.map((r) =>
      [
        r.docNo,
        r.docDate,
        r.summary ?? '',
        r.source.label,
        `${r.replies.replied} of ${r.replies.asked}`,
        r.replyBy ?? '',
        r.awardedTo ? [r.awardedTo.name, r.awardedTo.order?.docNo].filter(Boolean).join(' · ') : '',
        r.status === 'CLOSED' && r.closeReason ? `Closed · ${r.closeReason}` : r.status,
      ]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `rfqs-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const statusLabel = (r: RfqListItem) => (r.status === 'CLOSED' && r.closeReason ? `Closed · ${r.closeReason.charAt(0).toLowerCase()}${r.closeReason.slice(1)}` : undefined)
</script>

<template>
  <section class="erp-card flex flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Request for Quotation" subtitle="Price requests sent to suppliers. Compare the replies side by side, then award one and create the PO.">
      <template #actions>
        <RouterLink v-if="can('purchase.rfq.manage')" to="/purchase/rfqs/new" class="erp-btn erp-btn-add">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New RFQ
        </RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="itemText" class="erp-input" placeholder="Filter by item" aria-label="Filter by item" />
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <select class="erp-input" aria-label="Filter by buyer" :value="list.params.value.buyer" @change="list.setFilter('buyer', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by buyer</option>
        <option v-for="b in buyers" :key="b.code" :value="b.code">{{ b.name }}</option>
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
      The RFQs could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No RFQs match these filters.">
      <Column header="RFQ no">
        <template #body="{ data }: { data: RfqListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/rfqs/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Sent">
        <template #body="{ data }: { data: RfqListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="What">
        <template #body="{ data }: { data: RfqListItem }"><span class="whitespace-nowrap">{{ data.summary }}</span></template>
      </Column>
      <Column header="Source">
        <template #body="{ data }: { data: RfqListItem }">
          <RouterLink v-if="data.source.type === 'REQUEST' && data.source.id && !data.isMigrated" :to="docRoute('PUR_REQUEST', data.source.id)!" class="erp-link whitespace-nowrap">
            {{ data.source.label }}
          </RouterLink>
          <span v-else class="whitespace-nowrap">{{ data.source.label }}</span>
        </template>
      </Column>
      <Column header="Replies">
        <template #body="{ data }: { data: RfqListItem }">
          <div class="flex items-center gap-1 whitespace-nowrap" :aria-label="`${data.replies.replied} of ${data.replies.asked} replied`">
            <span
              v-for="n in data.replies.asked"
              :key="n"
              class="inline-block h-[9px] w-[9px] rounded-full"
              :class="n <= data.replies.replied ? 'bg-mod-line' : 'bg-erp-input'"
            />
            <span class="pl-1 text-xs text-erp-muted">{{ data.replies.replied }} of {{ data.replies.asked }}</span>
          </div>
        </template>
      </Column>
      <Column header="Reply by">
        <template #body="{ data }: { data: RfqListItem }"><span class="whitespace-nowrap">{{ formatDate(data.replyBy) || '—' }}</span></template>
      </Column>
      <Column header="Awarded to">
        <template #body="{ data }: { data: RfqListItem }">
          <span v-if="!data.awardedTo" class="text-erp-muted">—</span>
          <span v-else class="whitespace-nowrap">
            {{ data.awardedTo.name }}
            <template v-if="data.awardedTo.order">
              ·
              <RouterLink
                v-if="docRoute('PUR_ORDER', data.awardedTo.order.id) && !isLegacyNo(data.awardedTo.order.docNo)"
                :to="docRoute('PUR_ORDER', data.awardedTo.order.id)!"
                class="erp-link"
                >{{ data.awardedTo.order.docNo }}</RouterLink
              >
              <template v-else>{{ data.awardedTo.order.docNo }}</template>
            </template>
          </span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: RfqListItem }"><StatusChip :status="data.status" :label="statusLabel(data)" /></template>
      </Column>
    </DataList>

    <div v-if="list.data.value && list.data.value.total > list.data.value.pageSize" class="flex justify-end">
      <Pager :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <div class="flex grow gap-4">
    <section class="erp-card flex grow flex-col gap-2.5 px-5 py-4">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Replies still open</h2>
        <span class="text-xs text-erp-muted">Each supplier gets its own link to reply</span>
      </div>
      <p v-if="!openReplies.length" class="m-0 text-[13px] text-erp-muted">No RFQ is waiting for replies.</p>
      <table v-else class="erp-table">
        <thead>
          <tr>
            <th>RFQ</th>
            <th>Supplier</th>
            <th>Asked</th>
            <th>Reply</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in openReplies" :key="`${r.rfqId}/${r.supplierCode}`">
            <td><RouterLink :to="`/purchase/rfqs/${r.rfqId}`" class="erp-link">{{ r.rfqNo }}</RouterLink></td>
            <td>{{ r.supplierName }}</td>
            <td class="whitespace-nowrap">{{ formatDateTime(r.askedAt) }}</td>
            <td>
              <span v-if="r.status === 'REPLIED'" class="font-semibold whitespace-nowrap text-chip-done-text">{{ replyText(r) }}</span>
              <span v-else-if="r.status === 'DECLINED'" class="text-erp-muted">Declined</span>
              <span v-else class="text-erp-muted">Not yet<template v-if="r.dueSoon && r.replyBy"> · due {{ formatDayMonth(r.replyBy) }}</template></span>
            </td>
            <td class="w-[110px]">
              <button
                v-if="r.canRemind"
                type="button"
                class="erp-btn erp-btn-secondary h-[30px]"
                :disabled="reminding === `${r.rfqId}/${r.supplierCode}`"
                @click="remind(r)"
              >
                Remind
              </button>
              <span v-else-if="r.status !== 'ASKED'" class="text-xs text-erp-muted">{{ r.status === 'REPLIED' ? 'Replied' : 'Declined' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <NextSteps title="When is an RFQ needed?" class="w-[380px] shrink-0">
      <li><span>Orders over <strong>RM 50,000.00</strong> need replies from at least 2 suppliers before a PO can be released.</span></li>
      <li><span>Items with a contract price in Master Data skip the RFQ.</span></li>
      <li><span>Choosing a supplier that is not the cheapest needs a written reason.</span></li>
      <template #footer>
        <RouterLink to="/purchase/settings/approval-rules" class="erp-link text-xs font-semibold">See Approval Rules →</RouterLink>
      </template>
    </NextSteps>
  </div>
</template>
