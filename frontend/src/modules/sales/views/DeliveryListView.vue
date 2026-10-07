<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate, formatQty } from '@/utils/format'
import { salesDeliveriesApi } from '../api/sales'
import type { DeliveryListItem, DeliveryOverview } from '../types'

/** S15 · Delivery orders (DeliveryList.html): what is waiting to be delivered, and the delivery orders. */
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const { can, today } = useSession()

const overview = ref<DeliveryOverview | null>(null)
const loadingOverview = ref(true)
async function loadOverview() {
  loadingOverview.value = true
  try {
    overview.value = await salesDeliveriesApi.overview()
  } finally {
    loadingOverview.value = false
  }
}
onMounted(loadOverview)

const list = useListPage({ filterKeys: [], fetch: salesDeliveriesApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  return `Showing ${Math.min(d.page * d.pageSize, d.total) - (d.page - 1) * d.pageSize} of ${d.total}`
})

const kpis = computed(() => overview.value?.kpis)
const joinNos = (nos: string[]) => (nos.length > 1 ? `${nos.slice(0, -1).join(', ')} and ${nos.at(-1)}` : (nos[0] ?? '—'))
const canCreate = computed(() => can('sales.delivery.edit'))

// ── Creating a DO ────────────────────────────────────────────────────────────
type WaitingRow = DeliveryOverview['waiting'][number]
const creating = ref(false)
async function create(orderId: string) {
  creating.value = true
  try {
    const d = await salesDeliveriesApi.create(orderId)
    toast.add({ severity: 'success', summary: `${d.docNo} created`, detail: `From ${d.order.no}. Check what leaves the warehouse, then confirm.`, life: 3500 })
    void router.push(`/sales/deliveries/${d.id}`)
  } finally {
    creating.value = false
    pickOpen.value = false
  }
}

const HOLD_TEXT: Record<Exclude<WaitingRow['state'], 'READY'>, (r: WaitingRow) => { header: string; message: string }> = {
  NO_STOCK: (r) => ({
    header: `No stock of ${r.itemCode} shown`,
    message: `The stock list shows ${formatQty(r.onHand)} ${r.uomCode} at the warehouse. Inventory is not connected yet, so create the DO only if the goods are really there.`,
  }),
  PURCHASE: (r) => ({
    header: r.purchase?.state === 'PO_CANCELLED' ? `Purchase cancelled part of ${r.purchaseOrderNo}` : `${r.itemCode} is bought to order`,
    message: `${r.purchase?.state === 'PO_CANCELLED' ? `${r.purchase.label}. Ask Purchase for another supplier, or cancel the order balance.` : r.purchase?.state === 'PART_RECEIVED' ? `Only part has arrived (${r.purchase.label}).` : r.purchaseOrderNo ? `Purchase order ${r.purchaseOrderNo} has not arrived yet.` : r.purchase ? `${r.purchase.label}.` : 'The goods have not arrived yet.'} Create the DO only if the goods are in the warehouse.`,
  }),
  DEPOSIT: (r) => ({
    header: `Deposit not paid on ${r.proforma?.docNo}`,
    message: `${r.orderNo} waits for a deposit of RM ${r.proforma?.amount}. You can prepare the DO now, but it cannot be confirmed until the deposit is paid.`,
  }),
}

function act(r: WaitingRow) {
  if (r.draft) {
    void router.push(`/sales/deliveries/${r.draft.id}`)
    return
  }
  if (r.state === 'READY') {
    void create(r.orderId)
    return
  }
  const text = HOLD_TEXT[r.state](r)
  confirm.require({ header: text.header, message: text.message, acceptLabel: 'Create DO anyway', rejectLabel: 'Not now', accept: () => create(r.orderId) })
}
const actLabel = (r: WaitingRow) => {
  if (r.draft) return `Open ${r.draft.docNo}`
  if (r.state === 'NO_STOCK') return 'Waiting for stock'
  if (r.state === 'PURCHASE') return 'Waiting for purchase'
  if (r.state === 'DEPOSIT') return `Deposit · ${r.proforma?.docNo}`
  return 'Create DO'
}

// "New delivery order": pick one of the orders waiting to be delivered.
const pickOpen = ref(false)
const waitingOrders = computed(() => {
  const seen = new Map<string, { orderId: string; orderNo: string; customerName: string; items: string[]; draft: WaitingRow['draft'] }>()
  for (const r of overview.value?.waiting ?? []) {
    const entry = seen.get(r.orderId) ?? { orderId: r.orderId, orderNo: r.orderNo, customerName: r.customerName, items: [], draft: r.draft }
    entry.items.push(`${formatQty(r.balance)} × ${r.itemCode}`)
    seen.set(r.orderId, entry)
  }
  return [...seen.values()]
})

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of delivery orders comes later.', life: 3000 })
}

async function exportCsv() {
  const all: DeliveryListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesDeliveriesApi.list({ page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['DO no', 'Date', 'Customer', 'From order', 'Qty', 'Vehicle', 'Driver', 'Consignment note', 'Status'].map(cell).join(','),
    ...all.map((d) => [d.docNo, d.docDate, d.customerName, d.salesOrderNo, formatQty(d.qty), d.vehicle ?? '', d.driver ?? '', d.consignmentNote ?? '', d.statusLabel].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `delivery-orders-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <PageHeader title="Delivery orders" subtitle="Confirmed here in Sales until the Inventory module takes over picking and delivery.">
      <template #actions>
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
        <button v-if="canCreate" type="button" class="erp-btn erp-btn-add" :disabled="!waitingOrders.length" @click="pickOpen = true">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />New delivery order
        </button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-4 gap-4">
      <KpiCard label="Orders waiting to be delivered" :value="kpis?.waiting.orders ?? '—'" :sub="kpis ? `${formatQty(kpis.waiting.units)} units in total` : ''" :loading="loadingOverview" />
      <KpiCard label="Due in the next 14 days" :value="kpis?.dueSoon.orders ?? '—'" :sub="kpis ? (kpis.dueSoon.orders ? joinNos(kpis.dueSoon.orderNos) : 'Nothing due') : ''" :loading="loadingOverview" />
      <KpiCard label="Draft delivery orders" :value="kpis?.drafts.count ?? '—'" :sub="kpis ? (kpis.drafts.count ? `${joinNos(kpis.drafts.docNos)} · not confirmed` : 'None') : ''" :loading="loadingOverview" />
      <KpiCard
        label="Delivered this month"
        :value="kpis ? formatQty(kpis.deliveredThisMonth.units) : '—'"
        :sub="kpis ? `units on ${kpis.deliveredThisMonth.deliveries} delivery ${kpis.deliveredThisMonth.deliveries === 1 ? 'order' : 'orders'}` : ''"
        :loading="loadingOverview"
      />
    </div>

    <!-- Waiting to be delivered -->
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">Waiting to be delivered</h2>
        <span class="text-xs text-erp-muted">Released orders with a balance</span>
      </div>
      <div class="overflow-x-auto">
        <table class="erp-table">
          <thead>
            <tr><th>Sales order</th><th>Customer</th><th>Item</th><th class="num">Balance</th><th>Wanted by</th><th>Stock</th><th aria-label="Action" /></tr>
          </thead>
          <tbody>
            <tr v-if="loadingOverview"><td colspan="7" class="text-center text-erp-muted">Loading…</td></tr>
            <tr v-else-if="!overview?.waiting.length"><td colspan="7" class="text-center text-erp-muted">Nothing is waiting to be delivered.</td></tr>
            <tr v-for="r in overview?.waiting ?? []" :key="`${r.orderId}-${r.lineNo}`">
              <td><RouterLink :to="`/sales/orders/${r.orderId}`" class="erp-link font-semibold whitespace-nowrap">{{ r.orderNo }}</RouterLink></td>
              <td>{{ r.customerName }}</td>
              <td>{{ r.itemCode }} · {{ r.itemName }}</td>
              <td class="num">{{ formatQty(r.balance) }}</td>
              <td class="whitespace-nowrap">{{ formatDate(r.wantedBy ?? '') || '—' }}</td>
              <td>
                <span v-if="r.isBuyToOrder && r.purchase?.state === 'RECEIVED'" class="rounded-md bg-chip-done-bg px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-chip-done-text" :title="r.purchase.label">Received · {{ r.purchaseOrderNo }}</span>
                <span v-else-if="r.isBuyToOrder && r.purchase?.state === 'PO_CANCELLED'" class="rounded-md bg-note-warn-bg px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-attention" :title="r.purchase.label">PO cancelled</span>
                <span v-else-if="r.isBuyToOrder && Number(r.onHand) < Number(r.balance)" class="rounded-md bg-erp-head px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-erp-subtle" :title="r.purchase?.label">Buy to order</span>
                <span v-else-if="Number(r.onHand) > 0" class="rounded-md bg-chip-done-bg px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-chip-done-text">{{ formatQty(r.onHand) }} in stock</span>
                <span v-else class="rounded-md bg-note-warn-bg px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-attention">0 in stock</span>
              </td>
              <td class="text-right">
                <button
                  v-if="canCreate"
                  type="button"
                  class="erp-btn whitespace-nowrap"
                  :class="r.state === 'READY' && !r.draft ? 'erp-btn-primary' : 'erp-btn-secondary'"
                  :disabled="creating"
                  @click="act(r)"
                >
                  {{ actLabel(r) }}
                </button>
                <span v-else class="text-xs text-erp-muted">{{ actLabel(r) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Delivery orders -->
    <section class="erp-card flex grow flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">Delivery orders</h2>
        <span class="text-xs text-erp-muted">{{ showing }}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="erp-table">
          <thead>
            <tr><th>DO no</th><th>Date</th><th>Customer</th><th>From order</th><th class="num">Qty</th><th>Vehicle · driver</th><th>Consignment note</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-if="list.loading.value && !rows.length"><td colspan="8" class="text-center text-erp-muted">Loading…</td></tr>
            <tr v-else-if="!rows.length"><td colspan="8" class="text-center text-erp-muted">No delivery orders yet.</td></tr>
            <tr v-for="d in rows" :key="d.id">
              <td>
                <span v-if="d.isMigrated" class="font-semibold whitespace-nowrap">{{ d.docNo }}</span>
                <RouterLink v-else :to="`/sales/deliveries/${d.id}`" class="erp-link font-semibold whitespace-nowrap">{{ d.docNo }}</RouterLink>
              </td>
              <td class="whitespace-nowrap">{{ formatDate(d.docDate) }}</td>
              <td>{{ d.customerName }}</td>
              <td class="whitespace-nowrap">{{ d.salesOrderNo }}</td>
              <td class="num">{{ formatQty(d.qty) }}</td>
              <td class="whitespace-nowrap">{{ [d.vehicle, d.driver].filter(Boolean).join(' · ') || '—' }}</td>
              <td class="whitespace-nowrap">{{ d.consignmentNote ?? '—' }}</td>
              <td><StatusChip :status="d.status" :label="d.statusLabel" :group="d.status === 'CONFIRMED' ? 'released' : 'draft'" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-auto flex items-center justify-end pt-2">
        <Pager v-if="list.data.value && list.data.value.total > list.data.value.pageSize" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
      </div>
    </section>

    <Dialog v-model:visible="pickOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '520px' }" header="New delivery order">
      <p class="m-0 mb-3 text-[13px] text-erp-subtle">Pick the released order to deliver. Everything still open is copied; change the quantities on the next screen.</p>
      <div class="flex flex-col gap-2">
        <button
          v-for="o in waitingOrders"
          :key="o.orderId"
          type="button"
          class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-erp-border bg-erp-card px-3.5 py-2.5 text-left text-[13px] hover:bg-erp-head"
          :disabled="creating"
          @click="o.draft ? router.push(`/sales/deliveries/${o.draft.id}`) : create(o.orderId)"
        >
          <span>
            <span class="font-semibold">{{ o.orderNo }}</span> · {{ o.customerName }}
            <span class="block text-xs text-erp-muted">{{ o.items.join(', ') }}</span>
          </span>
          <span class="text-xs font-semibold whitespace-nowrap text-mod-accent">{{ o.draft ? `Open ${o.draft.docNo}` : 'Create DO' }}</span>
        </button>
      </div>
    </Dialog>
  </div>
</template>
