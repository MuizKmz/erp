<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'
import DataList from '@/components/erp/DataList.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDayMonth, formatQty } from '@/utils/format'
import { receiptsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ReceiptListItem, ReceiptWaiting, StockState } from '../types'

/** P14 · Goods Receipt: what is waiting to be received, and the receipts (GrnList.html, FlowP4 step 1) */
const toast = useToast()
const { today } = useSession()

const waiting = ref<ReceiptWaiting | null>(null)
const waitingFailed = ref(false)
onMounted(async () => {
  try {
    waiting.value = await receiptsApi.waiting()
  } catch {
    waitingFailed.value = true
  }
})
const kpis = computed(() => waiting.value?.kpis)

const list = useListPage({ fetch: receiptsApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const STOCK: Record<StockState, { text: string; class: string }> = {
  NONE: { text: '—', class: 'text-erp-muted' },
  QUEUED: { text: 'Queued', class: 'text-note-warn-strong' },
  POSTED: { text: 'Posted', class: 'text-chip-done-text' },
  FAILED: { text: 'Failed', class: 'text-note-error-text' },
  OLD_SYSTEM: { text: 'Old system', class: 'text-erp-muted' },
}
const chip = (r: ReceiptListItem) =>
  r.status === 'DRAFT'
    ? { status: 'DRAFT', label: 'Draft' }
    : Number(r.shortQty) > 0
      ? { status: 'PARTIAL', label: `Short ${formatQty(r.shortQty)}` }
      : { status: 'DONE', label: 'Received' }
const receivedText = (r: ReceiptListItem) =>
  `${r.status === 'DRAFT' && Number(r.receivedQty) === 0 ? '—' : formatQty(r.receivedQty)} of ${formatQty(r.openQtyBefore)}`
const poRoute = (id: string | null, no: string) => (isLegacyNo(no) ? null : docRoute('PUR_ORDER', id))

const footer = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${from + d.items.length - 1} of ${d.total} ${d.total === 1 ? 'receipt' : 'receipts'}`
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of goods receipts comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: ReceiptListItem[] = []
  for (let page = 1; ; page++) {
    const result = await receiptsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['GRN no', 'Date', 'Purchase order', 'Supplier', 'Supplier DO', 'Received', 'Of', 'Received by', 'Stock', 'Status'].map(cell).join(','),
    ...all.map((r) =>
      [r.docNo, r.docDate, r.poNo, r.supplierName, r.supplierDoNo ?? '', formatQty(r.receivedQty), formatQty(r.openQtyBefore), r.receivedByName, STOCK[r.stock].text, chip(r).label]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `goods-receipts-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="grid grid-cols-4 gap-3.5">
    <KpiCard
      compact
      label="Orders waiting for goods"
      :value="kpis?.waiting.count ?? ''"
      :sub="kpis ? `${formatQty(kpis.waiting.units)} units still to come` : ''"
      :loading="!kpis && !waitingFailed"
    />
    <KpiCard
      compact
      tone="success"
      label="Arrived today"
      :value="kpis?.arrivedToday.count ?? ''"
      :sub="kpis?.arrivedToday.first ? `${kpis.arrivedToday.first} · being counted` : 'Nothing being counted'"
      :loading="!kpis && !waitingFailed"
    />
    <KpiCard
      compact
      :tone="kpis?.late.count ? 'danger' : 'default'"
      label="Late"
      :value="kpis?.late.count ?? ''"
      :sub="kpis?.late.worst ? `${kpis.late.worst.poNo} · ${kpis.late.worst.days} ${kpis.late.worst.days === 1 ? 'day' : 'days'}` : 'Nothing overdue'"
      :loading="!kpis && !waitingFailed"
    />
    <KpiCard
      compact
      :tone="waiting?.inventoryConnected ? 'default' : 'warning'"
      label="Waiting for Inventory"
      :value="kpis ? `${kpis.waitingForInventory.count} ${kpis.waitingForInventory.count === 1 ? 'receipt' : 'receipts'}` : ''"
      :sub="waiting?.inventoryConnected ? 'Stock posts as soon as a receipt is confirmed' : 'Stock posts when Inventory plugs in'"
      :loading="!kpis && !waitingFailed"
    />
  </div>

  <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
    <div class="flex items-center justify-between">
      <h2 class="m-0 text-[15px] font-bold">Waiting to be received</h2>
      <span class="text-xs text-erp-muted">Released and partially received orders</span>
    </div>
    <p v-if="waitingFailed" class="m-0 text-[13px] text-note-error-text">The orders could not be loaded.</p>
    <p v-else-if="waiting && !waiting.items.length" class="m-0 text-[13px] text-erp-muted">Nothing is waiting to be received.</p>
    <table v-else-if="waiting" class="erp-table">
      <thead>
        <tr>
          <th>Purchase order</th>
          <th>Supplier</th>
          <th>Item</th>
          <th class="num">Open</th>
          <th>Expected</th>
          <th>Note</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="w in waiting.items" :key="w.poId">
          <td>
            <RouterLink v-if="poRoute(w.poId, w.poNo)" :to="poRoute(w.poId, w.poNo)!" class="erp-link font-semibold whitespace-nowrap">{{ w.poNo }}</RouterLink>
            <strong v-else class="whitespace-nowrap">{{ w.poNo }}</strong>
          </td>
          <td>{{ w.supplierName }}</td>
          <td>
            {{ w.item.code }} {{ w.item.name }}<span v-if="w.item.more" class="text-erp-muted"> + {{ w.item.more }} more</span>
          </td>
          <td class="num">{{ w.openText }}</td>
          <td>
            <span v-if="w.arrivedToday" class="font-semibold whitespace-nowrap text-chip-done-text">Arrived today</span>
            <span v-else-if="w.lateDays" class="font-semibold whitespace-nowrap text-note-error-text">{{ formatDayMonth(w.expected) }} · late</span>
            <span v-else class="whitespace-nowrap">{{ formatDate(w.expected) || '—' }}</span>
          </td>
          <td>
            <RouterLink v-if="w.cancelOrder" :to="docRoute('PUR_CANCEL_ORDER', w.cancelOrder.id)!" class="erp-link">{{ w.cancelOrder.docNo }} cancelling</RouterLink>
            <template v-else>{{ w.note }}</template>
          </td>
          <td class="w-[110px]">
            <RouterLink v-if="w.action === 'CONTINUE' && w.draftReceipt" :to="`/purchase/receipts/${w.draftReceipt.id}`" class="erp-btn erp-btn-primary h-[30px] px-3">Continue</RouterLink>
            <RouterLink v-else-if="w.action === 'RECEIVE'" :to="{ path: '/purchase/receipts/new', query: { po: w.poId } }" class="erp-btn erp-btn-primary h-[30px] px-3">Receive</RouterLink>
            <span v-else class="text-xs text-erp-muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="m-0 py-4 text-center text-[13px] text-erp-muted">Loading…</p>
  </section>

  <section class="erp-card flex grow flex-col gap-2.5 px-5 py-4">
    <div class="flex items-center justify-between">
      <h2 class="m-0 text-[15px] font-bold">Goods receipts</h2>
      <div class="flex gap-2">
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </div>
    </div>

    <div v-if="list.failed.value" class="flex items-center justify-between rounded-lg bg-note-error-bg px-4 py-3 text-[13px] text-note-error-text">
      The receipts could not be loaded.
      <button type="button" class="erp-btn erp-btn-secondary" @click="list.reload()">Try again</button>
    </div>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No goods receipts yet.">
      <Column header="GRN no">
        <template #body="{ data }: { data: ReceiptListItem }">
          <strong v-if="data.isMigrated" class="whitespace-nowrap">{{ data.docNo }}</strong>
          <RouterLink v-else :to="`/purchase/receipts/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: ReceiptListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
      <Column header="Purchase order">
        <template #body="{ data }: { data: ReceiptListItem }">
          <RouterLink v-if="poRoute(data.poId, data.poNo)" :to="poRoute(data.poId, data.poNo)!" class="erp-link whitespace-nowrap">{{ data.poNo }}</RouterLink>
          <span v-else class="whitespace-nowrap">{{ data.poNo }}</span>
        </template>
      </Column>
      <Column header="Supplier" field="supplierName" />
      <Column header="Supplier DO">
        <template #body="{ data }: { data: ReceiptListItem }">{{ data.supplierDoNo ?? '—' }}</template>
      </Column>
      <Column header="Received" class="erp-col-num">
        <template #body="{ data }: { data: ReceiptListItem }"><span class="whitespace-nowrap">{{ receivedText(data) }}</span></template>
      </Column>
      <Column header="Received by" field="receivedByName" />
      <Column header="Stock">
        <template #body="{ data }: { data: ReceiptListItem }"><span class="whitespace-nowrap" :class="STOCK[data.stock].class">{{ STOCK[data.stock].text }}</span></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: ReceiptListItem }"><StatusChip :status="chip(data).status" :label="chip(data).label" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ footer }}</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
