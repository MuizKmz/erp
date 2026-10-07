<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { ArrowRight } from '@lucide/vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { formatDate, formatDateTime, formatDayMonth, formatQty, qtyWithUnit } from '@/utils/format'
import { salesDeliveriesApi, salesOrdersApi } from '../api/sales'
import { docRoute } from '../routes'
import type { SalesOrderFlow } from '../types'

/** S03 · Document flow of one sales order (DocFlow.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const setCrumb = usePageCrumb()
const flow = ref<SalesOrderFlow | null>(null)
const loading = ref(true)
const creating = ref(false)

async function load() {
  loading.value = true
  try {
    flow.value = await salesOrdersApi.flow(String(route.params.id))
    setCrumb('Document flow')
  } finally {
    loading.value = false
  }
}
watch(() => route.params.id, load, { immediate: true })

const TYPE_LABEL: Record<string, string> = {
  SAL_ENQUIRY: 'Enquiry',
  SAL_QUOTATION: 'Quotation',
  SAL_ORDER: 'Sales order',
  SAL_DELIVERY: 'Delivery',
  SAL_INVOICE: 'Invoice',
  SAL_PROFORMA: 'Proforma',
  SAL_RETURN: 'Return',
  SAL_DEBIT_NOTE: 'Debit note',
  SAL_CANCEL_ORDER: 'Cancel order',
  PUR_ORDER: 'Purchase order',
}

/** Card line under the number: the document's own summary plus its date from the quantity table. */
function cardText(type: string, docNo: string, summary: string) {
  const row = flow.value?.quantity?.rows.find((r) => r.docNo === docNo)
  const own = summary && summary !== TYPE_LABEL[type] ? summary : ''
  return [own, row?.date ? formatDayMonth(row.date) : ''].filter(Boolean).join(' · ')
}

async function createDelivery() {
  const f = flow.value!
  creating.value = true
  try {
    const d = await salesDeliveriesApi.create(f.order.id)
    toast.add({ severity: 'success', summary: `${d.docNo} created`, detail: 'Check what leaves the warehouse, then confirm.', life: 3500 })
    void router.push(`/sales/deliveries/${d.id}`)
  } finally {
    creating.value = false
  }
}
const audit = computed(() => flow.value?.audit ?? [])
</script>

<template>
  <div v-if="loading && !flow" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="flow">
    <PageHeader :title="`Document flow · ${flow.order.docNo}`" document>
      <template #subtitle>{{ flow.order.customerName }} · every document linked to this order, in order</template>
      <template #actions>
        <RouterLink :to="`/sales/orders/${flow.order.id}`" class="erp-btn erp-btn-secondary">Back to order</RouterLink>
      </template>
    </PageHeader>

    <div class="flex items-stretch gap-2 overflow-x-auto pb-1">
      <template v-for="(d, i) in flow.chain" :key="`${d.type}-${d.docNo}`">
        <ArrowRight v-if="i > 0" :size="16" class="shrink-0 self-center text-erp-muted" aria-hidden="true" />
        <component :is="docRoute(d.type, d.id) && !d.current ? 'RouterLink' : 'div'" :to="docRoute(d.type, d.id) ?? undefined" class="erp-node min-w-[150px]" :class="{ current: d.current }">
          <span class="text-[11px] font-semibold tracking-[0.04em] text-erp-muted uppercase">{{ TYPE_LABEL[d.type] ?? d.type }}</span>
          <span class="text-[15px] font-bold">{{ d.docNo }}</span>
          <span v-if="d.current" class="text-xs">Balance <strong class="text-[15px]">{{ formatQty(flow.order.open) }}</strong> of {{ formatQty(flow.order.ordered) }}</span>
          <span v-else class="text-xs text-erp-subtle">{{ cardText(d.type, d.docNo, d.summary) }}</span>
          <span class="mt-auto"><StatusChip v-if="d.status" :status="d.status" :label="d.label ?? undefined" :group="d.group ?? undefined" /></span>
        </component>
      </template>
    </div>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section v-if="flow.quantity" class="erp-card flex flex-col gap-3 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">
            Quantity through the chain · {{ flow.quantity.itemCode }} {{ flow.quantity.itemName }}
            <span v-if="flow.quantity.more" class="text-xs font-normal text-erp-muted">(first line; {{ flow.quantity.more }} more on the order)</span>
          </h2>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead>
                <tr><th>Document</th><th>Date</th><th class="num">Received from previous</th><th class="num">Moved to next</th><th class="num">Still open</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in flow.quantity.rows" :key="`${r.type}-${r.docNo}`" :class="{ 'bg-mod-light': r.docNo === flow.order.docNo }">
                  <td>
                    <RouterLink v-if="docRoute(r.type, r.id) && r.docNo !== flow.order.docNo" :to="docRoute(r.type, r.id)!" class="erp-link font-semibold">{{ r.docNo }}</RouterLink>
                    <span v-else class="font-semibold text-erp-link">{{ r.docNo }}</span>
                  </td>
                  <td class="whitespace-nowrap">{{ formatDate(r.date) }}</td>
                  <td class="num">{{ r.fromPrevious }}</td>
                  <td class="num">{{ r.movedToNext }}</td>
                  <td class="num" :class="{ 'font-bold text-mod-accent': r.docNo === flow.order.docNo && r.stillOpen !== '0' }">{{ r.stillOpen }}</td>
                  <td><StatusChip :status="r.label" :label="r.label" :group="r.group ?? undefined" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="m-0 text-xs text-erp-muted">Balances are calculated by the database from the lines, so they never need a repair job.</p>
        </section>

        <section class="erp-card flex flex-col px-5 py-[18px]">
          <h2 class="m-0 mb-1.5 text-[15px] font-bold">Audit trail · who did what</h2>
          <p v-if="!audit.length" class="m-0 text-[13px] text-erp-muted">Nothing yet.</p>
          <div v-for="e in audit" :key="e.id" class="flex gap-3 border-b border-erp-row py-2 text-[13px] last:border-b-0">
            <time class="w-[124px] shrink-0 text-xs text-erp-muted" :datetime="e.at">{{ formatDateTime(e.at) }}</time>
            <span class="w-[120px] shrink-0 font-semibold">{{ e.userName }}</span>
            <div class="min-w-0">
              <div><span class="text-erp-muted">{{ e.docNo }} · </span>{{ e.message }}</div>
              <div v-if="e.comment" class="mt-0.5 text-xs whitespace-pre-line text-erp-muted">“{{ e.comment }}”</div>
            </div>
          </div>
        </section>
      </div>

      <div class="flex flex-col gap-3.5">
        <SideCard title="Still open on this order">
          <template v-if="flow.stillOpen">
            <div class="text-[28px] font-bold text-mod-accent">{{ qtyWithUnit(flow.stillOpen.qty, flow.stillOpen.uomCode) }}</div>
            <p class="m-0 text-[13px] text-erp-subtle">
              Not delivered yet.<template v-if="flow.stillOpen.wantedBy"> Customer wants them by {{ formatDate(flow.stillOpen.wantedBy) }}.</template>
            </p>
            <div class="flex gap-2">
              <button v-if="flow.stillOpen.canDeliver" type="button" class="erp-btn erp-btn-primary" :disabled="creating" @click="createDelivery">Create delivery</button>
              <RouterLink v-if="flow.stillOpen.canCancel" :to="`/sales/cancel-orders/new?order=${flow.order.id}`" class="erp-btn erp-btn-secondary">Cancel balance</RouterLink>
            </div>
          </template>
          <p v-else class="m-0 text-[13px] text-erp-muted">Nothing left to deliver.</p>
        </SideCard>

        <SideCard title="Waiting for other modules">
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Finance postings queued</span><strong class="erp-num">{{ flow.waiting.finance }}</strong></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>e-Invoice submissions pending</span><strong class="erp-num">{{ flow.waiting.eInvoice }}</strong></div>
            <div class="flex justify-between gap-3 py-[7px]"><span>Inventory events saved</span><strong class="erp-num">{{ flow.waiting.inventory }}</strong></div>
          </div>
          <p class="m-0 text-xs text-erp-muted">Sent automatically when each module is plugged in.</p>
        </SideCard>
      </div>
    </div>
  </template>
</template>
