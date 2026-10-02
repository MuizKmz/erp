<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight } from '@lucide/vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { formatDate, formatDateTime, formatDayMonth, formatQty, qtyWithUnit } from '@/utils/format'
import { ordersApi } from '../api/purchase'
import { docRoute } from '../routes'
import type { OrderFlow } from '../types'

/** P03 · Document flow of one purchase order (PurDocFlow.html) */
const route = useRoute()
const flow = ref<OrderFlow | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    flow.value = await ordersApi.flow(String(route.params.id))
  } finally {
    loading.value = false
  }
}
watch(() => route.params.id, load, { immediate: true })

const TYPE_LABEL: Record<string, string> = {
  PUR_REQUEST: 'Request',
  PUR_RFQ: 'RFQ',
  SAL_ORDER: 'Sales order',
  PUR_ORDER: 'Purchase order',
  PUR_RECEIPT: 'Goods receipt',
  PUR_INVOICE: 'Supplier invoice',
  PUR_RETURN: 'Return',
  PUR_CANCEL_ORDER: 'Cancel order',
  PUR_DEBIT_NOTE: 'Debit note',
}

/** Card line under the number: the document's own summary plus its date from the quantity table. */
function cardText(docNo: string, summary: string) {
  const row = flow.value?.quantity?.rows.find((r) => r.docNo === docNo)
  return [summary, row?.date ? formatDayMonth(row.date) : ''].filter(Boolean).join(' · ')
}
const auditOldestFirst = computed(() => flow.value?.audit ?? [])
</script>

<template>
  <div v-if="loading && !flow" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="flow">
    <PageHeader :title="`Document flow · ${flow.po.docNo}`" document>
      <template #subtitle>{{ flow.po.supplierName }} · every document linked to this order, in order</template>
      <template #actions>
        <RouterLink :to="`/purchase/orders/${flow.po.id}`" class="erp-btn erp-btn-secondary">Back to order</RouterLink>
      </template>
    </PageHeader>

    <div class="flex items-stretch gap-2">
      <template v-for="(d, i) in flow.chain" :key="`${d.type}-${d.docNo}`">
        <ArrowRight v-if="i > 0" :size="16" class="shrink-0 self-center text-erp-muted" aria-hidden="true" />
        <component :is="docRoute(d.type, d.id) && !d.current ? 'RouterLink' : 'div'" :to="docRoute(d.type, d.id) ?? undefined" class="erp-node" :class="{ current: d.current }">
          <span class="text-[11px] font-semibold tracking-[0.04em] text-erp-muted uppercase">{{ TYPE_LABEL[d.type] ?? d.type }}</span>
          <span class="text-[15px] font-bold">{{ d.docNo }}</span>
          <template v-if="d.current">
            <span class="text-xs text-erp-subtle">To receive</span>
            <span class="text-xs"><strong class="text-[15px]">{{ formatQty(flow.po.open) }}</strong> of {{ formatQty(flow.po.ordered) }}</span>
          </template>
          <span v-else class="text-xs text-erp-subtle">{{ cardText(d.docNo, d.summary) }}</span>
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
                <tr><th>Document</th><th>Date</th><th class="num">From previous</th><th class="num">Moved to next</th><th class="num">Still open</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in flow.quantity.rows" :key="`${r.type}-${r.docNo}`">
                  <td>
                    <RouterLink v-if="docRoute(r.type, r.id)" :to="docRoute(r.type, r.id)!" class="erp-link font-semibold">{{ r.docNo }}</RouterLink>
                    <strong v-else>{{ r.docNo }}</strong>
                  </td>
                  <td class="whitespace-nowrap">{{ formatDate(r.date) }}</td>
                  <td class="num">{{ r.fromPrevious }}</td>
                  <td class="num">{{ r.movedToNext }}</td>
                  <td class="num" :class="{ 'font-semibold': r.stillOpen !== '0' }">{{ r.stillOpen }}</td>
                  <td><StatusChip :status="r.label" :label="r.label" :group="r.group ?? undefined" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="erp-card flex flex-col px-5 py-[18px]">
          <h2 class="m-0 mb-1.5 text-[15px] font-bold">Audit trail · who did what</h2>
          <p v-if="!auditOldestFirst.length" class="m-0 text-[13px] text-erp-muted">Nothing yet.</p>
          <div v-for="e in auditOldestFirst" :key="e.id" class="flex gap-3 border-b border-erp-row py-2 text-[13px] last:border-b-0">
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
            <div class="text-2xl font-bold">{{ qtyWithUnit(flow.stillOpen.qty, flow.stillOpen.uomCode) }}</div>
            <p class="m-0 text-[13px] text-erp-subtle">
              <template v-if="flow.stillOpen.promisedDate">Supplier says they arrive on {{ formatDate(flow.stillOpen.promisedDate) }}. </template>They will be billed on arrival.
            </p>
            <div class="flex gap-2">
              <RouterLink v-if="flow.stillOpen.canReceive" :to="`/purchase/receipts/new?po=${flow.po.id}`" class="erp-btn erp-btn-primary">Receive</RouterLink>
              <RouterLink v-if="flow.stillOpen.canCancel" :to="`/purchase/cancel-orders/new?po=${flow.po.id}`" class="erp-btn erp-btn-danger">Cancel balance</RouterLink>
            </div>
          </template>
          <p v-else class="m-0 text-[13px] text-erp-muted">Nothing left to receive.</p>
        </SideCard>

        <SideCard title="Waiting for other modules">
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Finance payables queued</span><strong class="erp-num">{{ flow.waiting.finance }}</strong></div>
            <div class="flex justify-between gap-3 py-[7px]"><span>Inventory events saved</span><strong class="erp-num">{{ flow.waiting.inventory }}</strong></div>
          </div>
          <p class="m-0 text-xs text-erp-muted">Sent automatically when each module is plugged in.</p>
        </SideCard>
      </div>
    </div>
  </template>
</template>
