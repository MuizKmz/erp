<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import { useToast } from 'primevue/usetoast'
import { FileText, Package, ReceiptText } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDayMonth, formatMoney, formatRm } from '@/utils/format'
import { invoicesApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { InvoiceKpis, InvoiceListItem } from '../types'

/** P16 · List of Purchase Invoice (PiList.html, FlowP5 step 1) */
const toast = useToast()
const { can, today } = useSession()

const kpis = ref<InvoiceKpis | null>(null)
onMounted(async () => {
  kpis.value = await invoicesApi.kpis()
})

const list = useListPage({ filterKeys: ['supplier', 'supplierInvoiceNo', 'match'], fetch: invoicesApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'toMatch', label: 'To match' },
  { key: 'pendingApproval', label: 'Pending approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'paid', label: 'Paid', hideWhenEmpty: true },
]

// ── Filters ──────────────────────────────────────────────────────────────────
function debounced(key: 'supplier' | 'supplierInvoiceNo') {
  const text = ref(list.params.value[key] ?? '')
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => list.setFilter(key, value.trim()), 350)
  })
  return text
}
const supplierText = debounced('supplier')
const invoiceNoText = debounced('supplierInvoiceNo')

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

// ── Display ──────────────────────────────────────────────────────────────────
const TONE = { good: 'text-chip-done-text font-semibold', warn: 'text-note-warn-strong font-semibold', bad: 'text-note-error-text font-semibold', muted: 'text-erp-muted' }
const linkTo = (type: string, id: string | null, no: string) => (isLegacyNo(no) ? null : docRoute(type, id))
const footer = computed(() => {
  const m = list.data.value?.month
  return m ? `${m.count} ${m.count === 1 ? 'invoice' : 'invoices'} · RM ${formatMoney(m.total)} billed in ${m.name}` : ''
})
const toMatchSub = computed(() => {
  const l = kpis.value?.toMatch.latest
  if (!l) return 'Nothing waiting'
  return `${l.docNo} · ${l.docDate === today.value ? 'arrived today' : formatDayMonth(l.docDate)}`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of supplier invoices comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: InvoiceListItem[] = []
  for (let page = 1; ; page++) {
    const result = await invoicesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['PI no', 'Date', 'Supplier', 'Their invoice', 'PO', 'GRN', 'Amount (RM)', 'Match result', 'Status'].map(cell).join(','),
    ...all.map((r) =>
      [r.docNo, r.docDate, r.supplierName, r.supplierInvoiceNo, r.poNo, r.grns.map((g) => g.docNo).join(' '), r.total, r.matchSummary ?? '', r.statusLabel]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `purchase-invoices-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="grid grid-cols-4 gap-3.5">
    <KpiCard compact label="To match" :value="kpis?.toMatch.count ?? ''" :sub="toMatchSub" :loading="!kpis" />
    <KpiCard
      compact
      tone="warning"
      label="Waiting for approval"
      :value="kpis?.pending.count ?? ''"
      :sub="kpis?.pending.latest ? `${kpis.pending.latest.docNo} · ${kpis.pending.latest.summary}` : 'Nothing waiting'"
      :loading="!kpis"
    />
    <KpiCard
      compact
      tone="success"
      :label="kpis?.financeConnected ? 'Matched · sent to Finance' : 'Matched · waiting for Finance'"
      :value="kpis?.approved.count ?? ''"
      :sub="kpis ? `${formatRm(kpis.approved.total)} to pay` : ''"
      :loading="!kpis"
    />
    <KpiCard
      compact
      :tone="kpis?.rejected.count ? 'danger' : 'default'"
      label="Rejected this month"
      :value="kpis?.rejected.count ?? ''"
      :sub="kpis?.rejected.latest ? `${kpis.rejected.latest.docNo} · ${kpis.rejected.latest.why}` : 'None'"
      :loading="!kpis"
    />
  </div>

  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Purchase Invoice" subtitle="Supplier bills. Each one is matched against what was ordered and what was received before it can be paid.">
      <template #actions>
        <RouterLink v-if="can('purchase.invoice.edit')" to="/purchase/invoices/new" class="erp-btn erp-btn-add">Record supplier invoice</RouterLink>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input v-model="supplierText" class="erp-input" placeholder="Filter by supplier" aria-label="Filter by supplier" />
      <input v-model="invoiceNoText" class="erp-input" placeholder="Filter by their invoice no" aria-label="Filter by their invoice no" />
      <select class="erp-input" aria-label="Filter by match result" :value="list.params.value.match" @change="list.setFilter('match', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by match result</option>
        <option value="MATCHED">All three agree</option>
        <option value="DIFFERENCE">Difference</option>
        <option value="NOT_MATCHED">Not matched yet</option>
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
      The invoices could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No supplier invoices match these filters.">
      <Column header="PI no">
        <template #body="{ data }: { data: InvoiceListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/invoices/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: InvoiceListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Supplier · their invoice">
        <template #body="{ data }: { data: InvoiceListItem }">
          <div class="font-semibold whitespace-nowrap">{{ data.supplierName }}</div>
          <div class="text-xs text-erp-muted">{{ data.supplierInvoiceNo }}</div>
        </template>
      </Column>
      <Column header="PO · GRN">
        <template #body="{ data }: { data: InvoiceListItem }">
          <span class="whitespace-nowrap">
            <RouterLink v-if="linkTo('PUR_ORDER', data.poId, data.poNo)" :to="linkTo('PUR_ORDER', data.poId, data.poNo)!" class="erp-link">{{ data.poNo }}</RouterLink>
            <template v-else>{{ data.poNo }}</template>
            <template v-for="g in data.grns" :key="g.id">
              ·
              <RouterLink v-if="linkTo('PUR_RECEIPT', g.id, g.docNo)" :to="linkTo('PUR_RECEIPT', g.id, g.docNo)!" class="erp-link">{{ g.docNo }}</RouterLink>
              <template v-else>{{ g.docNo }}</template>
            </template>
          </span>
        </template>
      </Column>
      <Column header="Amount (RM)" class="erp-col-num">
        <template #body="{ data }: { data: InvoiceListItem }"><MoneyText :value="data.total" /></template>
      </Column>
      <Column header="Match result">
        <template #body="{ data }: { data: InvoiceListItem }"><span class="whitespace-nowrap" :class="TONE[data.matchTone]">{{ data.matchSummary }}</span></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: InvoiceListItem }"><StatusChip :status="data.status" :group="data.statusGroup" :label="data.statusLabel" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ footer }}</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <section class="erp-card flex items-center gap-[18px] px-5 py-4">
    <div class="flex w-[250px] shrink-0 flex-col gap-1.5">
      <h2 class="m-0 text-[15px] font-bold">How matching works</h2>
      <p class="m-0 text-[13px] leading-normal text-erp-subtle">
        Three documents must agree before a bill is approved. Small price differences inside the tolerance pass on their own.
      </p>
    </div>
    <template v-for="(box, i) in [
      { icon: FileText, title: 'Ordered · PO', text: 'Quantity and price we agreed' },
      { icon: Package, title: 'Received · GRN', text: 'Quantity that arrived' },
      { icon: ReceiptText, title: 'Billed · invoice', text: 'What the supplier asks for' },
    ]" :key="box.title">
      <span v-if="i > 0" class="text-lg text-erp-off-text">=</span>
      <div class="flex flex-1 flex-col gap-1.5 rounded-[10px] border border-erp-border px-4 py-3.5">
        <div class="flex items-center gap-2"><component :is="box.icon" :size="16" class="text-mod-accent" aria-hidden="true" /><strong class="text-[13px]">{{ box.title }}</strong></div>
        <span class="text-xs text-erp-muted">{{ box.text }}</span>
      </div>
    </template>
  </section>

  <NoticeBanner v-if="kpis && !kpis.financeConnected" kind="warning">
    <strong>Finance is not connected yet.</strong> Approved invoices are kept as payables and posted automatically when the Finance module is plugged in.
  </NoticeBanner>
</template>
