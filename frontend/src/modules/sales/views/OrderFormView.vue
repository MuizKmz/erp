<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import Menu from 'primevue/menu'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ChevronDown, Lock, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { roleLabel, useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatMoney, formatPrice, formatQty, formatRm } from '@/utils/format'
import { isPositiveDecimal, previewSaleLine, sumMoney } from '@/utils/money'
import { salesLookupsApi, salesOrdersApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import { docRoute } from '../routes'
import type { CustomerOption, OrderAction, OrderDetail, SaleItemOption } from '../types'

/** S11 · Sales order (SalesOrderForm.html) and S12 · Credit check failed (CreditApproval.html). */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const order = ref<OrderDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const pickerOpen = ref(false)
const reason = ref('')
const reasonError = ref('')
const transferMenu = ref<InstanceType<typeof Menu> | null>(null)

// ── Form state ───────────────────────────────────────────────────────────────
interface LineItem {
  code: string
  name: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  listPrice: string | null
}
interface EditLine {
  key: number
  item: LineItem
  qty: string
  unitPrice: string
  discountPct: string
}
let nextKey = 1
const form = reactive({
  customer: null as CustomerOption | null,
  contactName: '',
  docDate: '',
  deliveryWantedBy: '',
  customerPoRef: '',
  project: '',
  deliveryAddress: '',
  lines: [] as EditLine[],
})
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const trimPrice = (v: string) => v.replace(/(\.\d\d)00$/, '$1')

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => ({ code: l.item.code, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct })) })
const dirty = computed(() => snapshot() !== saved.value)

const can = (action: OrderAction) => (isNew.value ? action === 'edit' : Boolean(order.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))

function fillForm(o: OrderDetail | null) {
  if (o) {
    form.customer = { code: o.customer.code, name: o.customer.name, branchCode: o.branch.code, contactName: o.contactName, deliveryAddress: o.deliveryAddress, creditTermDays: o.creditTermDays, priceListCode: o.priceList.code, creditLimit: null, defaultAgentCode: null }
    form.contactName = o.contactName ?? ''
    form.docDate = o.docDate
    form.deliveryWantedBy = o.deliveryWantedBy ?? ''
    form.customerPoRef = o.customerPoRef ?? ''
    form.project = o.project ?? ''
    form.deliveryAddress = o.deliveryAddress ?? ''
    form.lines = o.lines.map((l) => ({
      key: nextKey++,
      item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: l.taxName, taxRate: l.taxRate, listPrice: l.listPrice },
      qty: formatQty(l.orderedQty).replace(/,/g, ''),
      unitPrice: trimPrice(l.unitPrice),
      discountPct: Number(l.discountPct) ? l.discountPct.replace(/\.?0+$/, '') : '',
    }))
  } else {
    form.customer = null
    form.contactName = ''
    form.docDate = today.value
    form.deliveryWantedBy = ''
    form.customerPoRef = ''
    form.project = ''
    form.deliveryAddress = ''
    form.lines = []
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    order.value = isNew.value ? null : await salesOrdersApi.get(id.value)
    fillForm(order.value)
    setCrumb(order.value?.docNo ?? 'New sales order')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(o: OrderDetail) {
  order.value = o
  fillForm(o)
  setCrumb(o.docNo)
}

const searchCustomers = async (q: string) => (await salesLookupsApi.customers(q)).items
function onCustomerPicked(c: CustomerOption) {
  form.customer = c
  if (!form.contactName) form.contactName = c.contactName ?? ''
  if (!form.deliveryAddress) form.deliveryAddress = c.deliveryAddress ?? ''
}

// ── Lines ────────────────────────────────────────────────────────────────────
const onLines = computed(() => Object.fromEntries(form.lines.map((l, i) => [l.item.code, i + 1])))
function addItems(picked: { item: SaleItemOption; qty: string }[]) {
  for (const { item, qty } of picked) {
    form.lines.push({
      key: nextKey++,
      item: { code: item.code, name: item.name, uomCode: item.uomCode, taxCode: item.taxCode, taxName: item.taxName, taxRate: item.taxRate, listPrice: item.listPrice },
      qty,
      unitPrice: trimPrice(item.listPrice ?? item.lastSold?.price ?? ''),
      discountPct: '',
    })
  }
}
function removeLine(key: number) {
  form.lines = form.lines.filter((l) => l.key !== key)
}
function openPicker() {
  if (!form.customer) {
    errors.value = { ...errors.value, customerCode: 'Pick the customer first, so the right price list is used.' }
    return
  }
  pickerOpen.value = true
}

const previews = computed(() => form.lines.map((l) => previewSaleLine(l.qty || '0', l.unitPrice || '0', l.discountPct || '0', l.item.taxRate)))
const previewTotals = computed(() => {
  const ok = previews.value.filter((p) => p !== null)
  const gross = sumMoney(ok.map((p) => p!.grossAmount))
  const discount = sumMoney(ok.map((p) => p!.discountAmount))
  const taxes = new Map<string, { name: string; amounts: string[] }>()
  form.lines.forEach((l, i) => {
    const p = previews.value[i]
    if (!p) return
    const entry = taxes.get(l.item.taxCode) ?? { name: l.item.taxName, amounts: [] }
    entry.amounts.push(p.taxAmount)
    taxes.set(l.item.taxCode, entry)
  })
  const taxLines = [...taxes].map(([code, t]) => ({ code, name: t.name, amount: sumMoney(t.amounts) }))
  const net = sumMoney(ok.map((p) => p!.amount))
  // 5-sen rounding is applied by the server on save; the preview shows the total before it.
  return { subtotal: gross, discountTotal: discount, taxLines, rounding: '0.00', total: sumMoney([net, ...taxLines.map((t) => t.amount)]) }
})
const totals = computed(() => (editable.value ? previewTotals.value : order.value?.totals))

// ── Save, release, approval ──────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.customer) e.customerCode = 'Pick the customer from Master Data.'
  if (!form.lines.length) e.lines = 'Add at least one item.'
  form.lines.forEach((l, i) => {
    if (!isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (!/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
    if (l.discountPct && !/^\d{1,3}(\.\d{1,2})?$/.test(l.discountPct)) e[`lines[${i}].discountPct`] = 'Discount like 5 or 7.5.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<OrderDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const body = {
      customerCode: form.customer!.code,
      docDate: form.docDate || undefined,
      deliveryWantedBy: form.deliveryWantedBy || null,
      contactName: form.contactName,
      customerPoRef: form.customerPoRef,
      project: form.project,
      deliveryAddress: form.deliveryAddress,
      lines: form.lines.map((l) => ({ itemCode: l.item.code, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct || '0' })),
    }
    const result = isNew.value ? await salesOrdersApi.create(body) : await salesOrdersApi.update(id.value, { ...body, version: order.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', detail: result.activity.find((a) => a.action === 'credit_check')?.message, life: 3500 })
    if (isNew.value) await router.replace(`/sales/orders/${result.id}`)
    show(result)
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
  const o = order.value!
  if (!o.allowedActions.includes('release')) return
  confirm.require({
    header: `Release ${o.docNo}?`,
    message: `${o.docNo} is locked and shown in the delivery list. After release, change it by revision or cancel the undelivered balance.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      const result = await salesOrdersApi.release(o.id, o.version)
      show(result)
      toast.add({ severity: 'success', summary: `${result.docNo} released`, detail: 'Event sales.order.released saved.', life: 4000 })
    },
  })
}

async function requestApproval() {
  reasonError.value = ''
  if (!reason.value.trim()) {
    reasonError.value = 'Type a reason for the approver.'
    return
  }
  if (dirty.value && !(await save())) return
  const o = order.value!
  saving.value = true
  try {
    show(await salesOrdersApi.requestApproval(o.id, o.version, reason.value.trim()))
    reason.value = ''
    notifyApprovalsChanged()
    toast.add({ severity: 'success', summary: 'Approval requested', detail: `${o.docNo} is waiting for ${order.value?.approval.waitingFor ?? 'the approver'}.`, life: 4000 })
  } finally {
    saving.value = false
  }
}

function deleteDraft() {
  const o = order.value!
  confirm.require({
    header: `Delete ${o.docNo}?`,
    message: `The draft is removed. Its number ${o.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesOrdersApi.remove(o.id, o.version)
      toast.add({ severity: 'success', summary: `${o.docNo} deleted`, life: 3000 })
      notifyApprovalsChanged()
      void router.push('/sales/orders')
    },
  })
}

function keepAsDraft() {
  reason.value = ''
  toast.add({ severity: 'info', summary: 'Kept as draft', detail: 'The order stays a draft. Request approval when you are ready.', life: 3000 })
}
function backToEdit() {
  document.getElementById('so-lines')?.scrollIntoView({ behavior: 'smooth' })
}

function later(what: string) {
  toast.add({ severity: 'info', summary: what, detail: 'This comes with a later Sales step.', life: 3000 })
}
const transferItems = computed(() => {
  const o = order.value
  if (!o) return []
  return [
    { label: 'Delivery order', disabled: !can('deliver'), command: () => router.push({ path: '/sales/deliveries', query: { order: o.id } }) },
    { label: 'Invoice', disabled: !can('invoice'), command: () => router.push({ path: '/sales/invoices/new', query: { order: o.id } }) },
    { label: 'Proforma invoice', disabled: !can('proforma'), command: () => router.push({ path: '/sales/proformas/new', query: { order: o.id } }) },
    { label: 'Cancel balance', disabled: !can('cancelBalance'), command: () => router.push({ path: '/sales/cancel-orders/new', query: { order: o.id } }) },
  ]
})

// ── Display ──────────────────────────────────────────────────────────────────
const title = computed(() => (isNew.value ? 'New sales order' : `Sales order ${order.value?.docNo ?? ''}`))
const chip = computed(() => {
  const o = order.value
  if (!o) return null
  if (o.balanceCancelled) return { status: 'CANCELLED', label: 'Balance cancelled' }
  if (o.status === 'PARTIAL') return { status: 'RELEASED', label: 'Released' }
  return { status: o.approval.state === 'APPROVED' && o.status === 'DRAFT' ? 'APPROVED' : o.status, label: o.approval.state === 'APPROVED' && o.status === 'DRAFT' ? 'Approved' : o.statusLabel }
})
const partialChip = computed(() => {
  const o = order.value
  return o && o.status === 'PARTIAL' ? `Partial · ${formatQty(o.quantities.delivered)} of ${formatQty(o.quantities.ordered)} delivered` : null
})
const released = computed(() => Boolean(order.value && !['DRAFT', 'PENDING_APPROVAL'].includes(order.value.status)))
const credit = computed(() => order.value?.credit.snapshot ?? null)
const showCreditFailed = computed(() => Boolean(order.value && order.value.status === 'DRAFT' && (order.value.credit.needsApproval || order.value.credit.blocked)))
const creditChip = computed(() => {
  const r = order.value?.credit.result
  if (r === 'OVER_LIMIT' || r === 'BLOCKED') return { status: 'REJECTED', label: 'Over limit', group: 'cancelled' as const }
  if (r === 'WARNED') return { status: 'PENDING_APPROVAL', label: 'Warning', group: 'pending' as const }
  if (r === 'APPROVED') return { status: 'APPROVED', label: 'Approved', group: 'done' as const }
  return { status: 'DONE', label: 'Passed', group: 'done' as const }
})
/** Credit bar: owed before (grey) and this order (purple) against the limit. */
const bar = computed(() => {
  const c = credit.value
  if (!c?.creditLimit || Number(c.creditLimit) <= 0) return null
  const limit = Number(c.creditLimit)
  const before = Number(c.owed) + Number(c.otherOpen)
  return { before: Math.min(100, (before / limit) * 100), mine: Math.max(0, Math.min(100 - (before / limit) * 100, (Number(c.thisDocument) / limit) * 100)) }
})
const lineHint = (l: EditLine) =>
  l.item.listPrice ? `Price list${order.value ? ` ${order.value.priceList.name}` : ''}: RM ${formatPrice(l.item.listPrice)}` : 'Not on the price list'
const belowList = (l: EditLine) => Boolean(l.item.listPrice && l.unitPrice && Number(l.unitPrice) < Number(l.item.listPrice))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" document>
      <template #chip>
        <StatusChip v-if="chip" :status="chip.status" :label="chip.label" />
        <StatusChip v-else status="DRAFT" label="New" />
        <StatusChip v-if="partialChip" status="PARTIAL" :label="partialChip" />
      </template>
      <template v-if="order" #subtitle>
        {{ order.customer.name }}
        <template v-if="order.quotation">
          · from quotation <RouterLink :to="docRoute('SAL_QUOTATION', order.quotation.id)!" class="erp-link">{{ order.quotation.no }}</RouterLink>
        </template>
        <template v-else-if="order.enquiryNo"> · from enquiry {{ order.enquiryNo }}</template>
        · Revision {{ order.revision }}
      </template>
      <template v-else #subtitle>Pick the customer and add items. The SO number is given when you save.</template>

      <template #actions>
        <template v-if="editable">
          <RouterLink v-if="!isNew" to="/sales/orders" class="erp-btn erp-btn-secondary">Back</RouterLink>
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn" :class="isNew ? 'erp-btn-primary' : 'erp-btn-secondary'" :disabled="saving || (!isNew && !dirty)" @click="save">Save draft</button>
          <button v-if="!isNew && !showCreditFailed" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !can('release')" @click="release">Release</button>
        </template>
        <template v-else-if="order && released">
          <button type="button" class="erp-btn erp-btn-secondary" @click="later('Print')">Print</button>
          <button type="button" class="erp-btn erp-btn-secondary" @click="later('Email')">Email</button>
          <button type="button" class="erp-btn erp-btn-secondary" @click="later('Revise')">Revise</button>
          <RouterLink :to="`/sales/orders/${order.id}/flow`" class="erp-btn erp-btn-secondary">Document flow</RouterLink>
          <button type="button" class="erp-btn erp-btn-primary" @click="transferMenu?.toggle($event)">Transfer to <ChevronDown :size="14" aria-hidden="true" /></button>
          <Menu ref="transferMenu" :model="transferItems" popup />
        </template>
        <RouterLink v-else to="/sales/orders" class="erp-btn erp-btn-secondary">Back</RouterLink>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-4">
        <NoticeBanner v-if="released && order">
          <span class="inline-flex items-center gap-2">
            <Lock :size="14" aria-hidden="true" />
            Released {{ order.releasedAt ? formatDateTime(order.releasedAt) : '' }} by {{ order.releasedByName }}. Header and lines are locked. Change by revision, or cancel the undelivered balance.
          </span>
        </NoticeBanner>
        <NoticeBanner v-else-if="order?.status === 'PENDING_APPROVAL'" kind="warning">
          Waiting for <strong>{{ order.approval.waitingFor }}</strong> to approve: {{ order.approval.reason }}. The order is locked until someone decides.
        </NoticeBanner>
        <NoticeBanner v-else-if="order?.approval.state === 'REJECTED' && order.status === 'DRAFT'" kind="error">
          Rejected by {{ order.approval.decidedBy }}<template v-if="order.approval.comment">: “{{ order.approval.comment }}”</template>. Change the order and request approval again.
        </NoticeBanner>
        <NoticeBanner v-else-if="order?.approval.state === 'APPROVED' && order.status === 'DRAFT'">
          Credit approved by {{ order.approval.decidedBy }}<template v-if="order.approval.comment"> · “{{ order.approval.comment }}”</template>. You can release the order.
        </NoticeBanner>

        <!-- Header fields (SalesOrderForm.html order) -->
        <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
          <FormField :label="form.customer ? `Customer · ${form.customer.code}` : 'Customer · from Master Data'" :error="errors.customerCode" for="so-customer">
            <MasterDataPicker
              v-if="editable"
              v-model="form.customer"
              input-id="so-customer"
              :search="searchCustomers"
              :invalid="Boolean(errors.customerCode)"
              :display="(c) => c.name"
              placeholder="Type a customer code or name"
              @picked="onCustomerPicked"
            />
            <div v-else class="erp-input-ro">{{ form.customer?.name }}</div>
          </FormField>
          <FormField label="Contact" for="so-contact">
            <input v-if="editable" id="so-contact" v-model="form.contactName" class="erp-input" maxlength="100" />
            <div v-else class="erp-input-ro">{{ form.contactName || '—' }}</div>
          </FormField>
          <FormField label="Order date" for="so-date">
            <DatePicker v-if="editable" input-id="so-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
            <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
          </FormField>
          <FormField label="Delivery wanted by" for="so-wanted">
            <DatePicker
              v-if="editable"
              input-id="so-wanted"
              :model-value="isoToDate(form.deliveryWantedBy)"
              :min-date="isoToDate(form.docDate) ?? undefined"
              date-format="d M yy"
              show-icon
              show-button-bar
              fluid
              class="erp-date"
              @update:model-value="form.deliveryWantedBy = dateToIso($event)"
            />
            <div v-else class="erp-input-ro">{{ formatDate(form.deliveryWantedBy) || '—' }}</div>
          </FormField>

          <FormField label="Branch"><div class="erp-input-ro">{{ order?.branch.name ?? '—' }}</div></FormField>
          <FormField label="Sales agent"><div class="erp-input-ro">{{ order?.agent.name ?? user?.name }}</div></FormField>
          <FormField label="Currency · tax mode"><div class="erp-input-ro">{{ order?.currency ?? 'MYR' }} · Exclusive</div></FormField>
          <FormField label="Credit term"><div class="erp-input-ro">{{ form.customer ? `${order?.creditTermDays ?? form.customer.creditTermDays} days` : '—' }}</div></FormField>

          <FormField label="Customer PO ref" for="so-poref">
            <input v-if="editable" id="so-poref" v-model="form.customerPoRef" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ form.customerPoRef || '—' }}</div>
          </FormField>
          <FormField label="Project" for="so-project">
            <input v-if="editable" id="so-project" v-model="form.project" class="erp-input" maxlength="100" />
            <div v-else class="erp-input-ro">{{ form.project || '—' }}</div>
          </FormField>
          <FormField label="Delivery address" class="col-span-2" for="so-address">
            <input v-if="editable" id="so-address" v-model="form.deliveryAddress" class="erp-input" maxlength="300" />
            <div v-else class="erp-input-ro">{{ form.deliveryAddress || '—' }}</div>
          </FormField>
        </section>

        <!-- Lines -->
        <section id="so-lines" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Lines</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="erp-table [&_td]:px-2.5 [&_th]:px-2.5">
              <thead>
                <tr v-if="editable">
                  <th>#</th>
                  <th>Item</th>
                  <th class="num">Qty</th>
                  <th>UOM</th>
                  <th class="num">Unit price</th>
                  <th class="num">Disc %</th>
                  <th>Tax</th>
                  <th class="num">Amount</th>
                  <th aria-label="Remove" />
                </tr>
                <tr v-else>
                  <th>Item</th>
                  <th>Ordered</th>
                  <th class="num">Delivered</th>
                  <th class="num">Invoiced</th>
                  <th class="num">Balance</th>
                  <th class="num">Unit price</th>
                  <th>Tax</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <template v-if="editable">
                  <tr v-if="!form.lines.length">
                    <td colspan="9" class="text-center text-erp-muted">No items yet. Click Add item to pick from Master Data.</td>
                  </tr>
                  <template v-for="(l, i) in form.lines" :key="l.key">
                    <tr>
                      <td class="text-erp-muted">{{ i + 1 }}</td>
                      <td>
                        <div class="font-bold whitespace-nowrap">{{ l.item.code }}</div>
                        <div class="text-xs text-erp-muted">{{ l.item.name }}</div>
                      </td>
                      <td class="num w-[90px] min-w-[76px]">
                        <input v-model="l.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                      </td>
                      <td>{{ l.item.uomCode }}</td>
                      <td class="num w-[110px] min-w-[96px]">
                        <input v-model="l.unitPrice" class="erp-cell min-w-[80px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Unit price, line ${i + 1}`" />
                      </td>
                      <td class="num w-[70px] min-w-[64px]">
                        <input v-model="l.discountPct" class="erp-cell min-w-[48px]" inputmode="decimal" placeholder="0" :aria-invalid="Boolean(errors[`lines[${i}].discountPct`])" :aria-label="`Discount %, line ${i + 1}`" />
                      </td>
                      <td class="whitespace-nowrap">{{ l.item.taxName }}</td>
                      <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
                      <td class="w-8">
                        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove line ${i + 1}`" @click="removeLine(l.key)">
                          <X :size="14" />
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td />
                      <td colspan="8" class="!pt-0 text-xs" :class="belowList(l) ? 'text-attention' : 'text-erp-muted'">
                        {{ lineHint(l) }}<template v-if="belowList(l)"> · below the price list, invoices at this price need approval</template>
                        <span v-for="key in ['qty', 'unitPrice', 'discountPct']" :key="key" class="ml-2 text-note-error-text">{{ errors[`lines[${i}].${key}`] }}</span>
                      </td>
                    </tr>
                  </template>
                </template>

                <template v-else>
                  <tr v-for="l in order?.lines ?? []" :key="l.id">
                    <td>
                      <div class="font-bold whitespace-nowrap">{{ l.itemCode }}</div>
                      <div class="text-xs text-erp-muted">{{ l.itemName }}<template v-if="l.isBuyToOrder"> · buy to order<template v-if="l.purchaseOrderNo"> · {{ l.purchaseOrderNo }}</template></template></div>
                    </td>
                    <td class="erp-num">{{ formatQty(l.orderedQty) }} {{ l.uomCode }}</td>
                    <td class="num">{{ formatQty(l.deliveredQty) }}</td>
                    <td class="num">{{ formatQty(l.invoicedQty) }}</td>
                    <td class="num font-bold text-mod-accent">{{ formatQty(l.balanceQty) }}</td>
                    <td class="num">
                      {{ formatPrice(l.unitPrice) }}
                      <div v-if="Number(l.discountPct)" class="text-xs text-erp-muted">less {{ Number(l.discountPct) }}%</div>
                    </td>
                    <td class="whitespace-nowrap">{{ l.taxName }}</td>
                    <td class="num"><MoneyText :value="l.amount" /></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div v-if="editable" class="flex gap-2">
            <button type="button" class="erp-btn erp-btn-secondary" @click="openPicker"><Plus :size="14" aria-hidden="true" />Add item</button>
          </div>
          <NoticeBanner v-if="order?.stock.releaseNote" kind="warning">
            {{ order.stock.releaseNote }}
          </NoticeBanner>
          <NoticeBanner v-else-if="editable && order?.stock.draftWarning" kind="warning">
            Stock now: {{ order.stock.draftWarning }}. Short stock only warns; the order can still be released.
          </NoticeBanner>
        </section>

        <!-- S12 · Credit check failed -->
        <section v-if="showCreditFailed && order && credit" class="flex flex-col gap-4 rounded-xl border-2 border-note-error-border bg-erp-card px-5 py-[18px]">
          <div>
            <h2 class="m-0 text-[15px] font-bold text-note-error-text">Credit check did not pass</h2>
            <p class="m-0 mt-0.5 text-xs text-erp-muted">{{ order.customer.name }} ({{ order.customer.code }}) · {{ order.docNo }} · checked {{ credit.scope === 'BRANCH' ? 'per branch' : 'group-wide' }}</p>
          </div>
          <table class="erp-table">
            <thead>
              <tr><th>Check</th><th class="num">Limit</th><th class="num">Now</th><th class="num">This order</th><th class="num">After</th><th>Result</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-semibold">Credit limit</td>
                <td class="num">{{ credit.creditLimit ? formatMoney(credit.creditLimit) : 'No limit' }}</td>
                <td class="num">{{ formatMoney((Number(credit.owed) + Number(credit.otherOpen)).toFixed(2)) }}</td>
                <td class="num">{{ formatMoney(credit.thisDocument) }}</td>
                <td class="num">{{ formatMoney(credit.exposureAfter) }}</td>
                <td :class="Number(credit.overCredit) > 0 ? 'font-semibold text-note-error-text' : 'text-chip-done-text'">
                  {{ Number(credit.overCredit) > 0 ? `Over by ${formatMoney(credit.overCredit)}` : 'Within limit' }}
                </td>
              </tr>
              <tr>
                <td class="font-semibold">Overdue limit</td>
                <td class="num">{{ credit.overdueLimit ? formatMoney(credit.overdueLimit) : 'No limit' }}</td>
                <td class="num">{{ formatMoney(credit.overdue) }}</td>
                <td class="num">—</td>
                <td class="num">{{ formatMoney(credit.overdue) }}</td>
                <td :class="Number(credit.overOverdue) > 0 ? 'font-semibold text-note-error-text' : 'text-chip-done-text'">
                  {{ Number(credit.overOverdue) > 0 ? `Over by ${formatMoney(credit.overOverdue)}` : 'Within limit' }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="m-0 text-[13px]">
            <template v-if="order.credit.blocked">Policy for <strong>Sales Order</strong>: block. This order cannot be released; reduce it or ask Finance.</template>
            <template v-else>Policy for <strong>Sales Order</strong>: require approval. </template>
            <RouterLink to="/sales/settings/credit-control" class="erp-link">See credit control policy</RouterLink>
          </p>
          <template v-if="!order.credit.blocked && can('requestApproval')">
            <FormField label="Reason for the approver" :error="reasonError" for="so-reason">
              <textarea id="so-reason" v-model="reason" rows="3" class="erp-input h-auto py-2" maxlength="1000" :aria-invalid="Boolean(reasonError)" />
            </FormField>
            <p class="m-0 text-xs text-erp-muted">
              Send to {{ roleLabel(order.credit.approverRole ?? 'SALES_MANAGER') }}. Release stays blocked until it is approved. If the order is cancelled, the request is withdrawn automatically.
            </p>
            <div class="flex justify-end gap-2">
              <button type="button" class="erp-btn erp-btn-secondary" @click="backToEdit">Back to edit</button>
              <button type="button" class="erp-btn erp-btn-secondary" @click="keepAsDraft">Keep as draft</button>
              <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="requestApproval">Request approval</button>
            </div>
          </template>
        </section>

        <ActivityList v-if="order" :items="order.activity.filter((a) => a.action !== 'stock_warning')" />
      </div>

      <!-- Right panel -->
      <aside class="flex flex-col gap-4">
        <SideCard title="Totals (MYR)">
          <div v-if="totals" class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Subtotal</span><MoneyText :value="totals.subtotal" /></div>
            <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Discount</span><MoneyText :value="totals.discountTotal" /></div>
            <div v-for="t in totals.taxLines" :key="t.code" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax ({{ t.name }})</span><MoneyText :value="t.amount" /></div>
            <div v-if="!totals.taxLines.length" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax</span><MoneyText value="0.00" /></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[5px]"><span class="text-erp-muted">Rounding</span><MoneyText :value="totals.rounding" /></div>
            <div class="flex justify-between gap-3 pt-2 text-lg font-bold"><span>Total</span><MoneyText :value="totals.total" /></div>
          </div>
        </SideCard>

        <SideCard v-if="order && credit" :title="order.credit.live ? 'Credit now' : 'Credit at save'">
          <template #chip><StatusChip :status="creditChip.status" :label="creditChip.label" :group="creditChip.group" /></template>
          <div v-if="bar" class="flex h-2 overflow-hidden rounded bg-erp-track">
            <div class="h-full bg-erp-muted" :style="{ width: `${bar.before}%` }" />
            <div class="h-full bg-mod-primary" :style="{ width: `${bar.mine}%` }" />
          </div>
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3"><span>Owed before</span><span>{{ formatRm((Number(credit.owed) + Number(credit.otherOpen)).toFixed(2)) }}</span></div>
            <div class="flex justify-between gap-3"><span>This order</span><span>{{ formatRm(credit.thisDocument) }}</span></div>
            <div class="flex justify-between gap-3"><span>Limit</span><span>{{ credit.creditLimit ? formatRm(credit.creditLimit) : 'No limit' }}</span></div>
            <div v-if="credit.headroom !== null" class="flex justify-between gap-3 font-bold" :class="Number(credit.headroom) < 0 ? 'text-note-error-text' : 'text-chip-done-text'">
              <span>{{ Number(credit.headroom) < 0 ? 'Over by' : 'Headroom left' }}</span><span>{{ formatRm(Math.abs(Number(credit.headroom)).toFixed(2)) }}</span>
            </div>
          </div>
          <p class="m-0 text-xs text-erp-muted">
            Checked {{ credit.scope === 'BRANCH' ? 'per branch' : 'group-wide' }} · overdue {{ formatRm(credit.overdue) }}<template v-if="credit.overdueLimit"> of {{ formatRm(credit.overdueLimit) }} limit</template>
          </p>
        </SideCard>

        <LinkedDocs v-if="order && order.links.length" :docs="order.links" :route-of="docRoute" :flow-to="released ? `/sales/orders/${order.id}/flow` : null" />
      </aside>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${order?.docNo ?? 'New order'} · ${form.customer?.name ?? ''} · ${order?.branch.name ?? form.customer?.branchCode ?? ''}${order ? ` · price list ${order.priceList.name}` : ''}`"
      :customer-code="form.customer?.code ?? null"
      :branch-code="order?.branch.code ?? form.customer?.branchCode ?? null"
      :branch-name="order?.branch.name ?? 'this branch'"
      :on-lines="onLines"
      @add="addItems"
    />
  </template>
</template>
