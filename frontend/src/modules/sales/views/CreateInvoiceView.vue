<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useToast } from 'primevue/usetoast'
import { Check } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatPrice, formatQty } from '@/utils/format'
import { previewSaleLine, sumMoney } from '@/utils/money'
import { salesInvoicesApi, salesLookupsApi, salesOrdersApi } from '../api/sales'
import type { CustomerOption, InvoiceCandidates } from '../types'

/** S18 · Create invoice from sales orders (CreateInvoice.html). Step 3 "Review draft" is the invoice itself (S19). */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { today } = useSession()

const customer = ref<CustomerOption | null>(null)
const data = ref<InvoiceCandidates | null>(null)
const loading = ref(false)
const saving = ref(false)
const orderId = ref<string | null>(null)
const qty = reactive<Record<string, string>>({})
const errors = ref<Record<string, string>>({})
const form = reactive({ docDate: '', customerPoRef: '', note: '' })

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')

const searchCustomers = async (q: string) => (await salesLookupsApi.customers(q)).items

async function loadCandidates(code: string, preselect?: string) {
  loading.value = true
  try {
    data.value = await salesInvoicesApi.candidates(code)
    const first = data.value.orders.find((o) => o.id === preselect && Number(o.canInvoiceQty) > 0) ?? data.value.orders.find((o) => Number(o.canInvoiceQty) > 0)
    pick(first?.id ?? null)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  form.docDate = today.value
  const fromOrder = typeof route.query.order === 'string' ? route.query.order : null
  if (fromOrder) {
    const o = await salesOrdersApi.get(fromOrder)
    customer.value = { code: o.customer.code, name: o.customer.name, branchCode: o.branch.code, contactName: o.contactName, deliveryAddress: o.deliveryAddress, creditTermDays: o.creditTermDays, priceListCode: o.priceList.code, creditLimit: null, defaultAgentCode: null }
    await loadCandidates(o.customer.code, fromOrder)
  }
})

function onCustomerPicked(c: CustomerOption) {
  customer.value = c
  void loadCandidates(c.code)
}

const order = computed(() => data.value?.orders.find((o) => o.id === orderId.value) ?? null)
function pick(id: string | null) {
  orderId.value = id
  errors.value = {}
  for (const k of Object.keys(qty)) delete qty[k]
  const o = data.value?.orders.find((x) => x.id === id)
  if (!o) return
  for (const l of o.lines) qty[l.soLineId] = Number(l.canInvoiceQty) > 0 ? plain(l.canInvoiceQty) : ''
  form.customerPoRef = o.customerPoRef ?? ''
}
const invoiceable = computed(() => order.value?.lines.filter((l) => Number(l.canInvoiceQty) > 0) ?? [])

// ── Preview ──────────────────────────────────────────────────────────────────
const previews = computed(() => invoiceable.value.map((l) => previewSaleLine(qty[l.soLineId] || '0', l.unitPrice, l.discountPct, l.taxRate)))
const subtotal = computed(() => sumMoney(previews.value.map((p) => p?.amount ?? '0')))
const taxTotal = computed(() => sumMoney(previews.value.map((p) => p?.taxAmount ?? '0')))
const total = computed(() => sumMoney([subtotal.value, taxTotal.value]))
const taxLabel = computed(() => [...new Set(invoiceable.value.map((l) => l.taxName))].join(', ') || 'tax')
const dueDate = computed(() => {
  if (!form.docDate || !order.value) return ''
  const d = new Date(`${form.docDate}T00:00:00`)
  d.setDate(d.getDate() + order.value.creditTermDays)
  return dateToIso(d)
})
const step = computed(() => (order.value ? 2 : 1))

function validate(): boolean {
  const e: Record<string, string> = {}
  invoiceable.value.forEach((l, i) => {
    const v = qty[l.soLineId] ?? ''
    if (!v) return
    if (!/^\d+(\.\d{1,4})?$/.test(v)) e[`lines[${i}].qty`] = 'Enter a quantity like 60.'
    else if (Number(v) < 1 || Number(v) > Number(l.canInvoiceQty)) e[`lines[${i}].qty`] = `Invoice now must be between 1 and ${formatQty(l.canInvoiceQty)}.`
  })
  if (!invoiceable.value.some((l) => Number(qty[l.soLineId] || 0) > 0)) e.lines = 'Enter a quantity on at least one line.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function create() {
  if (!order.value || !validate()) return
  saving.value = true
  try {
    const result = await salesInvoicesApi.createFromOrder({
      salesOrderId: order.value.id,
      docDate: form.docDate || undefined,
      customerPoRef: form.customerPoRef,
      note: form.note,
      lines: invoiceable.value.filter((l) => Number(qty[l.soLineId] || 0) > 0).map((l) => ({ soLineId: l.soLineId, qty: qty[l.soLineId]! })),
    })
    toast.add({ severity: 'success', summary: `${result.docNo} saved as draft`, detail: 'Review it, then release.', life: 3500 })
    void router.push(`/sales/invoices/${result.id}`)
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
  } finally {
    saving.value = false
  }
}

const STATUS_GROUP: Record<string, 'released' | 'partial' | 'done'> = { RELEASED: 'released', PARTIAL: 'partial', DONE: 'done' }
const STATUS_LABEL: Record<string, string> = { RELEASED: 'Released', PARTIAL: 'Partial', DONE: 'Done' }
</script>

<template>
  <div class="flex grow flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <h1 class="m-0 text-[22px] font-bold">Create invoice from sales orders</h1>
      <ol class="m-0 flex list-none items-center gap-3 p-0 text-[13px] font-semibold" aria-label="Steps">
        <li class="flex items-center gap-2" :class="step === 1 ? 'text-mod-accent' : 'text-erp-subtle'">
          <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs" :class="step > 1 ? 'bg-chip-done-bg text-chip-done-text' : 'bg-mod-primary text-white'">
            <Check v-if="step > 1" :size="13" aria-hidden="true" /><template v-else>1</template>
          </span>
          Choose orders
        </li>
        <li aria-hidden="true" class="h-px w-8 bg-erp-border" />
        <li class="flex items-center gap-2" :class="step === 2 ? 'text-mod-accent' : 'text-erp-subtle'">
          <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs" :class="step === 2 ? 'bg-mod-primary text-white' : 'bg-erp-head text-erp-subtle'">2</span>
          Choose quantities
        </li>
        <li aria-hidden="true" class="h-px w-8 bg-erp-border" />
        <li class="flex items-center gap-2 text-erp-subtle">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-erp-head text-xs">3</span>
          Review draft
        </li>
      </ol>
    </div>

    <div class="grid grow items-stretch gap-4 grid-cols-[340px_minmax(0,1fr)]">
      <!-- Step 1 · orders -->
      <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
        <h2 class="m-0 text-[15px] font-bold">Orders with something to invoice</h2>
        <FormField label="Customer" for="inv-customer">
          <MasterDataPicker v-model="customer" input-id="inv-customer" :search="searchCustomers" :display="(c) => `${c.name} (${c.code})`" placeholder="Type a customer code or name" @picked="onCustomerPicked" />
        </FormField>
        <p v-if="loading" class="m-0 text-[13px] text-erp-muted">Loading…</p>
        <p v-else-if="data && !data.orders.length" class="m-0 text-[13px] text-erp-muted">This customer has no released orders with something to invoice.</p>
        <label
          v-for="o in data?.orders ?? []"
          :key="o.id"
          class="flex items-start gap-3 rounded-[10px] border px-3.5 py-3"
          :class="[
            Number(o.canInvoiceQty) > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            o.id === orderId ? 'border-mod-primary bg-mod-light' : 'border-erp-border bg-erp-card',
          ]"
        >
          <input type="checkbox" class="mt-1" :checked="o.id === orderId" :disabled="Number(o.canInvoiceQty) <= 0" @change="pick(o.id === orderId ? null : o.id)" />
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="flex items-center justify-between gap-2">
              <span class="font-bold">{{ o.docNo }}</span>
              <StatusChip :status="o.status" :label="STATUS_LABEL[o.status] ?? o.status" :group="STATUS_GROUP[o.status]" />
            </span>
            <span class="text-[13px] text-erp-subtle">{{ o.summary }}</span>
            <span class="text-[13px] text-erp-subtle">{{ Number(o.canInvoiceQty) > 0 ? `Ordered ${formatDate(o.docDate)}` : o.detail }}</span>
          </span>
        </label>
        <p class="m-0 text-xs text-erp-muted">Only delivered quantities can be invoiced. This follows the policy “Invoice from delivered quantity”. One sales order per invoice.</p>

        <div v-if="data?.earlierInvoices.length" class="mt-auto flex flex-col gap-1 border-t border-erp-border pt-3 text-[13px]">
          <span class="text-xs font-semibold tracking-wide text-erp-muted uppercase">Earlier invoices · this customer</span>
          <div v-for="e in data.earlierInvoices" :key="e.docNo" class="flex justify-between gap-2">
            <span><strong>{{ e.docNo }}</strong> · {{ formatDate(e.docDate).split(' ').slice(0, 2).join(' ') }}</span>
            <span class="erp-num">RM {{ formatMoney(e.total) }} · {{ e.state }}</span>
          </div>
          <span v-if="data.earlierInvoices.some((e) => e.isMigrated)" class="text-xs text-erp-muted">“L” = migrated from the old system</span>
        </div>
      </section>

      <!-- Step 2 · quantities and details -->
      <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
        <h2 class="m-0 text-[15px] font-bold">Quantities to invoice</h2>
        <template v-if="order">
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead>
                <tr><th>Item · source</th><th class="num">Delivered</th><th class="num">Invoiced</th><th class="num">Can invoice</th><th class="num">Invoice now</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
              </thead>
              <tbody>
                <tr v-for="(l, i) in invoiceable" :key="l.soLineId">
                  <td>
                    <span class="font-bold">{{ l.itemCode }}</span> · from <RouterLink :to="`/sales/orders/${order.id}`" class="erp-link">{{ order.docNo }}</RouterLink>
                    <div class="text-xs text-erp-muted">{{ l.itemName }} · ordered {{ formatQty(l.orderedQty) }}</div>
                  </td>
                  <td class="num">{{ formatQty(l.deliveredQty) }}</td>
                  <td class="num">{{ formatQty(l.invoicedQty) }}</td>
                  <td class="num">{{ formatQty(l.canInvoiceQty) }}</td>
                  <td class="num w-[110px]">
                    <input
                      v-model="qty[l.soLineId]"
                      class="erp-cell min-w-[80px] border-2 border-mod-primary font-bold"
                      inputmode="decimal"
                      :aria-invalid="Boolean(errors[`lines[${i}].qty`])"
                      :aria-label="`Invoice now, ${l.itemCode}`"
                    />
                  </td>
                  <td class="num">{{ formatPrice(l.unitPrice) }}<div v-if="Number(l.discountPct)" class="text-xs text-erp-muted">less {{ Number(l.discountPct) }}%</div></td>
                  <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-for="(msg, key) in errors" :key="key" class="m-0 text-xs font-medium text-note-error-text">{{ msg }}</p>
          <p class="m-0 text-xs text-erp-muted">Invoice now must be between 1 and “Can invoice” (delivered minus already invoiced).</p>

          <h2 class="m-0 mt-2 text-[15px] font-bold">Invoice details</h2>
          <div class="grid grid-cols-3 gap-x-4 gap-y-3">
            <FormField label="Invoice date" for="inv-date">
              <DatePicker input-id="inv-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
            </FormField>
            <FormField label="Credit term · from Master Data"><div class="erp-input-ro">{{ order.creditTermDays }} days</div></FormField>
            <FormField label="Due date"><div class="erp-input-ro">{{ formatDate(dueDate) || '—' }}</div></FormField>
            <FormField label="Customer PO ref · copied from order" for="inv-po">
              <input id="inv-po" v-model="form.customerPoRef" class="erp-input" maxlength="50" />
            </FormField>
            <FormField label="Sales agent"><div class="erp-input-ro">{{ order.agentName }}</div></FormField>
            <FormField label="Delivery order"><div class="erp-input-ro">{{ order.deliveries.map((d) => d.no).join(', ') || '—' }}</div></FormField>
            <FormField class="col-span-3" label="Note printed on the invoice" for="inv-note">
              <input id="inv-note" v-model="form.note" class="erp-input" maxlength="2000" />
            </FormField>
          </div>
        </template>
        <p v-else class="m-0 text-[13px] text-erp-muted">{{ customer ? 'Tick an order on the left.' : 'Pick the customer, then tick an order with something delivered.' }}</p>

        <div class="mt-auto flex items-end justify-between gap-4 border-t border-erp-border pt-3">
          <div class="flex gap-10 text-[13px]">
            <div><div class="text-erp-muted">Subtotal</div><div class="font-bold"><MoneyText :value="subtotal" /></div></div>
            <div><div class="text-erp-muted">Tax ({{ taxLabel }})</div><div class="font-bold"><MoneyText :value="taxTotal" /></div></div>
            <div>
              <div class="text-erp-muted">Invoice total</div>
              <div class="text-lg font-bold">RM <MoneyText :value="total" /></div>
            </div>
          </div>
          <div class="flex gap-2">
            <RouterLink to="/sales/invoices" class="erp-btn erp-btn-secondary">Back</RouterLink>
            <button type="button" class="erp-btn erp-btn-add" :disabled="!order || saving" @click="create">Create invoice draft</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
