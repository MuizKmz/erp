<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Info, Lock } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatQty, formatRm } from '@/utils/format'
import { previewSaleLine, sumMoney } from '@/utils/money'
import { salesCancelOrdersApi } from '../api/sales'
import { docRoute } from '../routes'
import type { CancelAction, CancelDetail, CancelOpenOrder, CancelOrderLines } from '../types'

/** S14 · Cancel order balance (CancelOrder.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const co = ref<CancelDetail | null>(null)
const order = ref<CancelOrderLines | null>(null)
const openOrders = ref<CancelOpenOrder[]>([])
const reasons = ref<string[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const form = reactive({ orderId: '', docDate: '', reason: '', askedBy: '', customerRef: '', note: '', qty: {} as Record<string, string> })

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')

const saved = ref('')
const dirty = computed(() => JSON.stringify(form) !== saved.value)
const can = (a: CancelAction) => (isNew.value ? a === 'edit' : Boolean(co.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))
const canReleaseRole = computed(() => hasPermission('sales.cancel_order.release'))

function fill(c: CancelDetail | null) {
  if (c) {
    order.value = c.order
    reasons.value = c.reasons
    Object.assign(form, {
      orderId: c.order.id ?? '', docDate: c.docDate, reason: c.reason, askedBy: c.askedBy ?? '', customerRef: c.customerRef ?? '', note: c.note ?? '',
      qty: Object.fromEntries(c.order.lines.map((l) => [l.soLineId, plain(c.lines.find((x) => x.soLineId === l.soLineId)?.cancelQty ?? '0')])),
    })
  }
  saved.value = JSON.stringify(form)
  errors.value = {}
}

async function pickOrder(orderId: string) {
  form.orderId = orderId
  order.value = orderId ? await salesCancelOrdersApi.orderLines(orderId) : null
  form.qty = Object.fromEntries((order.value?.lines ?? []).map((l) => [l.soLineId, Number(l.balanceQty) > 0 ? plain(l.balanceQty) : '0']))
  if (order.value && !form.askedBy) form.askedBy = order.value.contactName ?? ''
}

onMounted(async () => {
  loading.value = true
  try {
    if (isNew.value) {
      const [open, meta] = await Promise.all([salesCancelOrdersApi.openOrders(), salesCancelOrdersApi.list({ pageSize: 1 })])
      openOrders.value = open.items
      reasons.value = meta.reasons
      form.docDate = today.value
      form.reason = reasons.value[0] ?? ''
      const fromOrder = typeof route.query.order === 'string' ? route.query.order : ''
      if (fromOrder) await pickOrder(fromOrder)
      saved.value = ''
      setCrumb('New cancellation')
    } else {
      co.value = await salesCancelOrdersApi.get(id.value)
      fill(co.value)
      setCrumb(co.value.docNo)
    }
  } finally {
    loading.value = false
  }
})

// ── Preview ──────────────────────────────────────────────────────────────────
const lineRows = computed(() => {
  if (co.value && !editable.value) return co.value.lines.map((l) => ({ ...l, key: l.id, isBuyToOrder: false, purchaseOrderNo: l.linkedPo, unitPrice: '0', discountPct: '0', taxRate: '0' }))
  return (order.value?.lines ?? []).map((l) => ({ ...l, key: l.soLineId, cancelQty: form.qty[l.soLineId] ?? '0', linkedPo: l.isBuyToOrder ? l.purchaseOrderNo : null }))
})
const valueCancelled = computed(() => {
  if (co.value && !editable.value) return co.value.total
  return sumMoney(
    (order.value?.lines ?? []).map((l) => {
      const p = previewSaleLine(form.qty[l.soLineId] || '0', l.unitPrice, l.discountPct, l.taxRate)
      return p ? sumMoney([p.amount, p.taxAmount]) : '0'
    }),
  )
})
const totals = computed(() => {
  const rows = lineRows.value
  const ordered = rows.reduce((s, l) => s + Number(l.orderedQty), 0)
  const delivered = rows.reduce((s, l) => s + Number(l.deliveredQty), 0)
  const cancel = rows.reduce((s, l) => s + Number(l.cancelQty || 0), 0)
  const balance = rows.reduce((s, l) => s + Number(l.balanceQty), 0)
  return { ordered, delivered, cancel, balance, leftAfter: Math.max(0, balance - cancel) }
})
const uom = computed(() => [...new Set(lineRows.value.map((l) => l.uomCode))].join('/'))
const linkedPos = computed(() => lineRows.value.filter((l) => l.linkedPo && Number(l.cancelQty) > 0))

// ── Save, release ────────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.orderId) e.salesOrderId = 'Pick the sales order to cancel.'
  if (!form.reason) e.reason = 'Pick the reason for the cancellation.'
  ;(order.value?.lines ?? []).forEach((l, i) => {
    const v = form.qty[l.soLineId] ?? '0'
    if (!/^\d+(\.\d{1,4})?$/.test(v)) e[`lines[${i}].qty`] = 'Enter a quantity like 15.'
    else if (Number(v) > Number(l.balanceQty)) e[`lines[${i}].qty`] = `Cancel now cannot be more than the undelivered balance (${formatQty(l.balanceQty)}).`
  })
  if (!Object.keys(e).length && totals.value.cancel <= 0) e.lines = 'Enter a quantity to cancel on at least one line.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<CancelDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const lines = (order.value?.lines ?? []).map((l) => ({ soLineId: l.soLineId, qty: form.qty[l.soLineId] || '0' }))
    const fields = { reason: form.reason, docDate: form.docDate || undefined, askedBy: form.askedBy, customerRef: form.customerRef, note: form.note }
    const result = isNew.value
      ? await salesCancelOrdersApi.create({ ...fields, salesOrderId: form.orderId, lines })
      : await salesCancelOrdersApi.update(co.value!.id, { ...fields, version: co.value!.version, lines })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', detail: isNew.value ? 'A Sales Manager releases it.' : undefined, life: 3500 })
    if (isNew.value) await router.replace(`/sales/cancel-orders/${result.id}`)
    co.value = result
    fill(result)
    setCrumb(result.docNo)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
    return null
  } finally {
    saving.value = false
  }
}

async function release() {
  if (dirty.value && !(await save())) return
  const c = co.value!
  confirm.require({
    header: `Release ${c.docNo}?`,
    message: `${formatQty(String(totals.value.cancel))} ${uom.value} on ${c.order.no} are cancelled for good (${formatRm(c.total)}). Nothing is posted; the event is saved for Inventory${linkedPos.value.length ? ' and Purchase' : ''}.`,
    acceptLabel: 'Release cancellation',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      saving.value = true
      try {
        co.value = await salesCancelOrdersApi.release(c.id, c.version)
        fill(co.value)
        toast.add({ severity: 'success', summary: `${c.docNo} released`, detail: `${c.order.no} balance is cancelled.`, life: 4000 })
      } finally {
        saving.value = false
      }
    },
  })
}

function deleteDraft() {
  const c = co.value!
  confirm.require({
    header: `Delete ${c.docNo}?`,
    message: `The draft is removed and ${c.order.no} keeps its balance. ${c.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesCancelOrdersApi.remove(c.id, c.version)
      toast.add({ severity: 'success', summary: `${c.docNo} deleted`, life: 3000 })
      void router.push('/sales/cancel-orders')
    },
  })
}

const released = computed(() => co.value?.status === 'RELEASED')
const deliveredPct = computed(() => (totals.value.ordered ? (totals.value.delivered / totals.value.ordered) * 100 : 0))
const cancelPct = computed(() => (totals.value.ordered ? (Math.min(totals.value.cancel, totals.value.balance) / totals.value.ordered) * 100 : 0))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="isNew ? 'New cancellation' : `Cancel order balance ${co?.docNo ?? ''}`" subtitle="Closes the part of a sales order that will never be delivered" document>
      <template #chip>
        <StatusChip :status="co?.status ?? 'DRAFT'" :label="released ? 'Released' : 'Draft'" :group="released ? 'done' : 'draft'" />
      </template>
      <template #actions>
        <RouterLink to="/sales/cancel-orders" class="erp-btn erp-btn-secondary">Back</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || (!isNew && !dirty)" @click="save">Save draft</button>
        <button
          v-if="!released && !isNew"
          type="button"
          class="erp-btn erp-btn-danger"
          :disabled="saving || !can('release')"
          :title="canReleaseRole ? undefined : 'Only the Sales Manager releases cancellations (sales.cancel_order.release).'"
          @click="release"
        >
          Release cancellation
        </button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="released && co">
        <span class="inline-flex items-center gap-2"><Lock :size="14" aria-hidden="true" />Released. {{ co.order.no }}'s balance is cancelled and nothing was posted.</span>
      </NoticeBanner>
      <NoticeBanner v-else-if="co && !canReleaseRole" kind="warning">Saved as a draft. A Sales Manager releases it; until then {{ co.order.no }} keeps its open balance.</NoticeBanner>
      <NoticeBanner v-if="linkedPos.length && !released" kind="warning">
        <template v-for="l in linkedPos" :key="l.key">{{ l.itemCode }} is bought to order on {{ l.linkedPo }}. </template>
        Releasing tells Purchase (event <code>sales.order.balance_cancelled</code>) so they can cancel or keep the PO.
      </NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField label="Sales order to cancel" :error="errors.salesOrderId" for="co-order">
              <select v-if="isNew" id="co-order" class="erp-input" :value="form.orderId" @change="pickOrder(($event.target as HTMLSelectElement).value)">
                <option value="">Pick a sales order</option>
                <option v-for="o in openOrders" :key="o.id" :value="o.id">{{ o.docNo }} · {{ o.customerName }}</option>
                <option v-if="form.orderId && !openOrders.some((o) => o.id === form.orderId) && order" :value="form.orderId">{{ order.no }} · {{ order.customer.name }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ co?.order.no }} · {{ co?.order.customer.name }}</div>
            </FormField>
            <FormField :label="order ? `Customer · ${order.customer.code}` : 'Customer'"><div class="erp-input-ro truncate">{{ order?.customer.name ?? '—' }}</div></FormField>
            <FormField label="Cancel date" for="co-date">
              <DatePicker v-if="editable" input-id="co-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Reason" :error="errors.reason" for="co-reason">
              <select v-if="editable" id="co-reason" v-model="form.reason" class="erp-input">
                <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ form.reason }}</div>
            </FormField>
            <FormField label="Asked by (customer contact)" for="co-asked">
              <input v-if="editable" id="co-asked" v-model="form.askedBy" class="erp-input" maxlength="100" />
              <div v-else class="erp-input-ro">{{ form.askedBy || '—' }}</div>
            </FormField>
            <FormField label="Customer reference" for="co-ref">
              <input v-if="editable" id="co-ref" v-model="form.customerRef" class="erp-input" maxlength="50" />
              <div v-else class="erp-input-ro">{{ form.customerRef || '—' }}</div>
            </FormField>
            <FormField class="col-span-3" label="Note" for="co-note">
              <input v-if="editable" id="co-note" v-model="form.note" class="erp-input" maxlength="2000" />
              <div v-else class="erp-input-ro">{{ form.note || '—' }}</div>
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">What is being cancelled</h2>
            <table class="erp-table">
              <thead><tr><th>Item</th><th class="num">Ordered</th><th class="num">Delivered</th><th class="num">Invoiced</th><th class="num">Balance</th><th class="num">Cancel now</th><th class="num">Left after</th></tr></thead>
              <tbody>
                <tr v-if="!lineRows.length"><td colspan="7" class="text-center text-erp-muted">Pick a sales order to see its open lines.</td></tr>
                <tr v-for="(l, i) in lineRows" :key="l.key">
                  <td><div class="font-bold whitespace-nowrap">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                  <td class="num">{{ formatQty(l.orderedQty) }}</td>
                  <td class="num">{{ formatQty(l.deliveredQty) }}</td>
                  <td class="num">{{ formatQty(l.invoicedQty) }}</td>
                  <td class="num">{{ formatQty(l.balanceQty) }}</td>
                  <td class="num w-[110px]">
                    <input
                      v-if="editable && 'soLineId' in l && l.soLineId"
                      v-model="form.qty[l.soLineId]"
                      class="erp-cell min-w-[80px] border-2 border-note-error-border font-bold"
                      inputmode="decimal"
                      :disabled="Number(l.balanceQty) <= 0"
                      :aria-invalid="Boolean(errors[`lines[${i}].qty`])"
                      :aria-label="`Cancel now, ${l.itemCode}`"
                    />
                    <span v-else class="font-bold">{{ formatQty(l.cancelQty) }}</span>
                  </td>
                  <td class="num font-bold">{{ formatQty(String(Math.max(0, Number(l.balanceQty) - Number(l.cancelQty || 0)))) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-for="(msg, key) in errors" v-show="String(key).startsWith('lines')" :key="key" class="m-0 text-xs font-medium text-note-error-text">{{ msg }}</p>
            <div class="flex items-center gap-2 rounded-lg bg-erp-head px-3 py-2 text-xs text-erp-subtle">
              <Info :size="14" aria-hidden="true" />Only the undelivered balance can be cancelled. Goods already delivered go back through a sales return.
            </div>
          </section>

          <section v-if="co?.recent.length" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Recent cancellations</h2>
            <table class="erp-table">
              <thead><tr><th>CO no</th><th>Date</th><th>Sales order</th><th>Customer</th><th class="num">Qty cancelled</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="r in co.recent" :key="r.id">
                  <td><RouterLink :to="`/sales/cancel-orders/${r.id}`" class="erp-link font-semibold whitespace-nowrap">{{ r.docNo }}</RouterLink></td>
                  <td class="whitespace-nowrap">{{ formatDate(r.docDate) }}</td>
                  <td class="whitespace-nowrap">{{ r.salesOrderNo }}</td>
                  <td>{{ r.customerName }}</td>
                  <td class="num">{{ formatQty(r.qty) }}</td>
                  <td>{{ r.reason }}</td>
                  <td><StatusChip :status="r.status" :label="r.status === 'DRAFT' ? 'Draft' : 'Released'" :group="r.status === 'DRAFT' ? 'draft' : 'released'" /></td>
                </tr>
              </tbody>
            </table>
          </section>

          <ActivityList v-if="co" :items="co.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <NextSteps v-if="!released" title="When you release">
            <li>
              <span>
                {{ order?.no ?? 'The order' }}
                <template v-if="totals.leftAfter === 0">closes with status <strong>Balance cancelled</strong>. </template><template v-else>keeps {{ formatQty(String(totals.leftAfter)) }} open. </template>
                Its {{ formatQty(String(totals.cancel)) }} open {{ uom }} drop to {{ formatQty(String(totals.leftAfter)) }}.
              </span>
            </li>
            <li><span>Any stock reserved for those {{ formatQty(String(totals.cancel)) }} is freed. The event is saved for Inventory.</span></li>
            <li><span>Nothing is posted to accounts, because nothing was invoiced for the cancelled part.</span></li>
          </NextSteps>

          <SideCard v-if="order" :title="`${order.no} today`">
            <div class="flex h-2.5 overflow-hidden rounded bg-erp-track" aria-hidden="true">
              <div class="h-full bg-mod-primary" :style="{ width: `${deliveredPct}%` }" />
              <div class="h-full bg-[repeating-linear-gradient(45deg,var(--color-note-error-border)_0_6px,transparent_6px_12px)]" :style="{ width: `${cancelPct}%` }" />
            </div>
            <div class="flex justify-between text-xs text-erp-subtle">
              <span>{{ formatQty(String(totals.delivered)) }} delivered</span><span>{{ formatQty(String(totals.cancel)) }} to cancel</span>
            </div>
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between py-[3px]"><span class="text-erp-muted">Order total</span><span class="erp-num">{{ formatRm(order.total) }}</span></div>
              <div class="flex justify-between py-[3px]"><span class="text-erp-muted">Invoiced</span><span class="erp-num">{{ formatRm(order.invoiced) }}</span></div>
              <div class="flex justify-between py-[3px] font-bold"><span>Value cancelled</span><span class="erp-num">{{ formatRm(valueCancelled) }}</span></div>
            </div>
          </SideCard>

          <SideCard title="Who can do this">
            <p class="m-0 text-[13px] text-erp-subtle">Permission <code>sales.cancel_order.release</code>. Sales agents can draft; a Sales Manager releases.</p>
          </SideCard>

          <LinkedDocs v-if="co && co.links.length" :docs="co.links" :route-of="docRoute" />
        </aside>
      </div>
    </div>
  </template>
</template>
