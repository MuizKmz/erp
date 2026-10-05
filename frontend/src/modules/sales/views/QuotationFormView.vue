<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import Menu from 'primevue/menu'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ChevronDown, Lock, Paperclip, Plus, X } from '@lucide/vue'
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
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatPrice, formatQty } from '@/utils/format'
import { isPositiveDecimal, previewSaleLine, sumMoney } from '@/utils/money'
import { salesLookupsApi, salesQuotationsApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import ReasonDialog from '../components/ReasonDialog.vue'
import { docRoute } from '../routes'
import type { CustomerOption, QuotationAction, QuotationDetail, SaleItemOption } from '../types'

/** S09 · Quotation (QuotationForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const quote = ref<QuotationDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const pickerOpen = ref(false)
const lostOpen = ref(false)
const tab = ref<'lines' | 'terms' | 'attachments' | 'history'>('lines')
const reason = ref('')
const reasonError = ref('')
const transferMenu = ref<InstanceType<typeof Menu> | null>(null)
const pickLinesOpen = ref(false)
const pickedLines = ref<number[]>([])

// ── Form state ───────────────────────────────────────────────────────────────
interface LineItem {
  code: string
  name: string
  uomCode: string
  taxCode: string
  taxName: string
  taxRate: string
  listPrice: string | null
  lastSold: { price: string; date: string; docNo: string } | null
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
  validUntil: '',
  customerNote: '',
  internalNote: '',
  lines: [] as EditLine[],
})
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateToIso(d)
}
const trimPrice = (v: string) => v.replace(/(\.\d\d)00$/, '$1')

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => ({ code: l.item.code, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct })) })
const dirty = computed(() => snapshot() !== saved.value)

const can = (action: QuotationAction) => (isNew.value ? action === 'edit' : Boolean(quote.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))

function fillForm(q: QuotationDetail | null) {
  if (q) {
    form.customer = { code: q.customer.code, name: q.customer.name, branchCode: q.branch.code, contactName: q.contactName, deliveryAddress: null, creditTermDays: q.creditTermDays, priceListCode: q.priceList.code, creditLimit: null, defaultAgentCode: null }
    form.contactName = q.contactName ?? ''
    form.docDate = q.docDate
    form.validUntil = q.validUntil ?? ''
    form.customerNote = q.customerNote ?? ''
    form.internalNote = q.internalNote ?? ''
    form.lines = q.lines.map((l) => ({
      key: nextKey++,
      item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: l.taxName, taxRate: l.taxRate, listPrice: l.listPrice, lastSold: l.lastSold },
      qty: formatQty(l.qty).replace(/,/g, ''),
      unitPrice: trimPrice(l.unitPrice),
      discountPct: Number(l.discountPct) ? l.discountPct.replace(/\.?0+$/, '') : '',
    }))
  } else {
    form.customer = null
    form.contactName = ''
    form.docDate = today.value
    form.validUntil = today.value ? addDays(today.value, 14) : ''
    form.customerNote = ''
    form.internalNote = ''
    form.lines = []
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    quote.value = isNew.value ? null : await salesQuotationsApi.get(id.value)
    fillForm(quote.value)
    setCrumb(quote.value?.docNo ?? 'New quotation')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(q: QuotationDetail) {
  quote.value = q
  fillForm(q)
  setCrumb(q.docNo)
}

const searchCustomers = async (q: string) => (await salesLookupsApi.customers(q)).items
function onCustomerPicked(c: CustomerOption) {
  form.customer = c
  if (!form.contactName) form.contactName = c.contactName ?? ''
}

// ── Lines ────────────────────────────────────────────────────────────────────
const onLines = computed(() => Object.fromEntries(form.lines.map((l, i) => [l.item.code, i + 1])))
function pushItem(item: SaleItemOption, qty: string) {
  form.lines.push({
    key: nextKey++,
    item: { code: item.code, name: item.name, uomCode: item.uomCode, taxCode: item.taxCode, taxName: item.taxName, taxRate: item.taxRate, listPrice: item.listPrice, lastSold: item.lastSold },
    qty,
    unitPrice: trimPrice(item.listPrice ?? item.lastSold?.price ?? ''),
    discountPct: '',
  })
}
function addItems(picked: { item: SaleItemOption; qty: string }[]) {
  for (const { item, qty } of picked) pushItem(item, qty)
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

/** Adds the enquiry's items that are not on the quotation yet, priced from the customer's price list. */
async function copyFromEnquiry() {
  const q = quote.value
  const missing = (q?.enquiryItems ?? []).filter((e) => !form.lines.some((l) => l.item.code === e.itemCode))
  if (!q || !missing.length) {
    toast.add({ severity: 'info', summary: 'Nothing to copy', detail: q?.enquiry ? `Every item from ${q.enquiry.no} is already on the quotation.` : 'This quotation has no enquiry.', life: 3500 })
    return
  }
  const skipped: string[] = []
  for (const e of missing) {
    const found = (await salesLookupsApi.items({ q: e.itemCode, customerCode: q.customer.code, branchCode: q.branch.code })).items.find((i) => i.code === e.itemCode)
    if (found && (found.state === 'ACTIVE' || found.state === 'OUT_OF_STOCK')) pushItem(found, formatQty(e.qty).replace(/,/g, ''))
    else skipped.push(`${e.itemCode}${found?.reason ? ` (${found.reason})` : ''}`)
  }
  toast.add({
    severity: skipped.length ? 'warn' : 'success',
    summary: `Copied from ${q.enquiry?.no}`,
    detail: skipped.length ? `Not copied: ${skipped.join(', ')}.` : 'Check the prices, then save.',
    life: 4500,
  })
}

const previews = computed(() => form.lines.map((l) => previewSaleLine(l.qty || '0', l.unitPrice || '0', l.discountPct || '0', l.item.taxRate)))
const previewTotals = computed(() => {
  const ok = previews.value.filter((p) => p !== null)
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
  return { subtotal: sumMoney(ok.map((p) => p!.grossAmount)), discountTotal: sumMoney(ok.map((p) => p!.discountAmount)), taxLines, rounding: '0.00', total: sumMoney([net, ...taxLines.map((t) => t.amount)]) }
})
const totals = computed(() => (editable.value && dirty.value ? previewTotals.value : (quote.value?.totals ?? previewTotals.value)))

// ── Save and actions ─────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.customer) e.customerCode = 'Pick the customer from Master Data.'
  if (!form.lines.length) e.lines = 'Add at least one item.'
  if (form.validUntil && form.docDate && form.validUntil < form.docDate) e.validUntil = 'Valid until cannot be before the quotation date.'
  form.lines.forEach((l, i) => {
    if (!isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (!/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
    if (l.discountPct && !/^\d{1,3}(\.\d{1,2})?$/.test(l.discountPct)) e[`lines[${i}].discountPct`] = 'Discount like 5 or 7.5.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<QuotationDetail | null> {
  if (!validate()) {
    tab.value = 'lines'
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const body = {
      customerCode: form.customer!.code,
      docDate: form.docDate || undefined,
      validUntil: form.validUntil || null,
      contactName: form.contactName,
      customerNote: form.customerNote,
      internalNote: form.internalNote,
      lines: form.lines.map((l) => ({ itemCode: l.item.code, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct || '0' })),
    }
    const result = isNew.value ? await salesQuotationsApi.create(body) : await salesQuotationsApi.update(id.value, { ...body, version: quote.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 3000 })
    if (isNew.value) await router.replace(`/sales/quotations/${result.id}`)
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
  const q = quote.value!
  if (!q.allowedActions.includes('release')) {
    if (q.discount.over) toast.add({ severity: 'warn', summary: 'Approval needed first', detail: `A discount above ${Number(q.discount.limitPct)}% needs the Sales Manager's approval before release.`, life: 5000 })
    return
  }
  confirm.require({
    header: `Release ${q.docNo}?`,
    message: `${q.docNo} is locked and can be sent to the customer. To change it later, revise it.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      try {
        const result = await salesQuotationsApi.release(q.id, q.version)
        show(result)
        toast.add({ severity: 'success', summary: `${result.docNo} released`, detail: 'Email it to the customer, or turn it into a sales order when they accept.', life: 4000 })
      } catch (error) {
        if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
      }
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
  const q = quote.value!
  saving.value = true
  try {
    show(await salesQuotationsApi.requestApproval(q.id, q.version, reason.value.trim()))
    reason.value = ''
    notifyApprovalsChanged()
    toast.add({ severity: 'success', summary: 'Approval requested', detail: `${q.docNo} is waiting for ${quote.value?.approval.waitingFor ?? 'the Sales Manager'}.`, life: 4000 })
  } finally {
    saving.value = false
  }
}

async function email() {
  const q = quote.value!
  const result = await salesQuotationsApi.email(q.id)
  toast.add({ severity: 'success', summary: 'Sent', detail: `${q.docNo} emailed to ${result.sentTo}.`, life: 4000 })
  show(await salesQuotationsApi.get(q.id))
}

function revise() {
  const q = quote.value!
  confirm.require({
    header: `Revise ${q.docNo}?`,
    message: `A new revision ${q.revision + 1} is created as a draft with the same lines. Revision ${q.revision} is kept for history.`,
    acceptLabel: 'Revise',
    rejectLabel: 'Cancel',
    accept: async () => {
      const result = await salesQuotationsApi.revise(q.id, q.version)
      toast.add({ severity: 'success', summary: `${result.docNo} revision ${result.revision} created`, life: 3500 })
      await router.replace(`/sales/quotations/${result.id}`)
      show(result)
    },
  })
}

async function markLost(why: string) {
  const q = quote.value!
  show(await salesQuotationsApi.lost(q.id, q.version, why))
  lostOpen.value = false
  toast.add({ severity: 'success', summary: `${q.docNo} marked as lost`, life: 3000 })
}

async function transfer(lineNos?: number[]) {
  if (dirty.value && !(await save())) return
  const q = quote.value!
  saving.value = true
  try {
    const result = await salesQuotationsApi.transfer(q.id, q.version, lineNos)
    toast.add({ severity: 'success', summary: `${result.orderNo} created from ${q.docNo}`, detail: 'Check the order and release it. The credit check runs on the order.', life: 4500 })
    void router.push(`/sales/orders/${result.orderId}`)
  } finally {
    saving.value = false
    pickLinesOpen.value = false
  }
}
const transferItems = computed(() => [
  { label: 'All lines', command: () => transfer() },
  {
    label: 'Choose lines…',
    command: () => {
      pickedLines.value = quote.value?.lines.map((l) => l.lineNo) ?? []
      pickLinesOpen.value = true
    },
  },
])

function deleteDraft() {
  const q = quote.value!
  confirm.require({
    header: `Delete ${q.docNo}${q.revision ? ` revision ${q.revision}` : ''}?`,
    message: q.revision ? `The draft revision is removed and revision ${q.revision - 1} becomes current again.` : `The draft is removed. Its number ${q.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesQuotationsApi.remove(q.id, q.version)
      toast.add({ severity: 'success', summary: `${q.docNo} deleted`, life: 3000 })
      notifyApprovalsChanged()
      const previous = q.revisions.find((r) => r.revision === q.revision - 1)
      void router.push(previous ? `/sales/quotations/${previous.id}` : '/sales/quotations')
      if (previous) {
        quote.value = await salesQuotationsApi.get(previous.id)
        fillForm(quote.value)
      }
    },
  })
}

function later(what: string) {
  toast.add({ severity: 'info', summary: what, detail: 'This comes with a later Sales step.', life: 3000 })
}

// ── Display ──────────────────────────────────────────────────────────────────
const title = computed(() => (isNew.value ? 'New quotation' : `Quotation ${quote.value?.docNo ?? ''}`))
const GROUP: Record<string, 'draft' | 'pending' | 'released' | 'done' | 'cancelled'> = { DRAFT: 'draft', PENDING_APPROVAL: 'pending', RELEASED: 'released', ORDERED: 'done', LOST: 'cancelled', SUPERSEDED: 'cancelled' }
const chip = computed(() => {
  const q = quote.value
  if (!q) return { status: 'DRAFT', label: 'New', group: 'draft' as const }
  if (q.approval.state === 'APPROVED' && q.status === 'DRAFT') return { status: 'APPROVED', label: 'Approved', group: 'done' as const }
  return { status: q.status, label: q.label, group: q.expired ? ('cancelled' as const) : GROUP[q.status] }
})
const locked = computed(() => Boolean(quote.value && !editable.value))
const discountTooHigh = computed(() => {
  const limit = Number(quote.value?.discount.limitPct ?? 15)
  return form.lines.some((l) => Number(l.discountPct || 0) > limit)
})
const showDiscountPanel = computed(() => Boolean(quote.value && quote.value.status === 'DRAFT' && quote.value.approval.state !== 'APPROVED' && (quote.value.discount.over || discountTooHigh.value)))
const lineHint = (l: EditLine) => {
  const parts = [l.item.listPrice ? `Price list ${quote.value?.priceList.name ?? ''}: RM ${formatPrice(l.item.listPrice)}`.replace('  ', ' ') : 'Not on the price list']
  if (l.item.lastSold) parts.push(`Last sold to this customer: RM ${formatPrice(l.item.lastSold.price)} on ${formatDate(l.item.lastSold.date)} (${l.item.lastSold.docNo})`)
  return parts.join(' · ')
}
const overLimit = (l: EditLine) => Number(l.discountPct || 0) > Number(quote.value?.discount.limitPct ?? 15)
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" document>
      <template #chip>
        <StatusChip :status="chip.status" :label="chip.label" :group="chip.group" />
        <span v-if="quote" class="text-[13px] font-semibold text-erp-subtle">Revision {{ quote.revision }}</span>
      </template>
      <template v-if="quote" #subtitle>
        {{ quote.customer.name }}
        <template v-if="quote.enquiry"> · from enquiry <RouterLink :to="docRoute('SAL_ENQUIRY', quote.enquiry.id)!" class="erp-link">{{ quote.enquiry.no }}</RouterLink></template>
      </template>
      <template v-else #subtitle>Pick the customer and add items. The QT number is given when you save.</template>

      <template #actions>
        <template v-if="isNew">
          <RouterLink to="/sales/quotations" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save draft</button>
        </template>
        <template v-else-if="quote">
          <button type="button" class="erp-btn erp-btn-secondary" @click="later('Print')">Print</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="!can('email')" :title="can('email') ? undefined : 'Release the quotation before emailing it.'" @click="email">Email</button>
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
          <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || !dirty" @click="save">Save draft</button>
          <button v-if="quote.status === 'DRAFT'" type="button" class="erp-btn erp-btn-primary" :disabled="saving || (!can('release') && !dirty)" @click="release">Release</button>
          <button v-if="can('markLost')" type="button" class="erp-btn erp-btn-danger" @click="lostOpen = true">Mark as lost</button>
          <button v-if="can('revise')" type="button" class="erp-btn erp-btn-secondary" @click="revise">Revise</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="!can('transfer') || saving" @click="transferMenu?.toggle($event)">Transfer to sales order <ChevronDown :size="14" aria-hidden="true" /></button>
          <Menu ref="transferMenu" :model="transferItems" popup />
        </template>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="quote?.status === 'RELEASED' && !quote.expired">
        <span class="inline-flex items-center gap-2">
          <Lock :size="14" aria-hidden="true" />
          Released{{ quote.releasedAt ? ` ${formatDateTime(quote.releasedAt)}` : '' }}<template v-if="quote.emailedAt"> · emailed {{ formatDateTime(quote.emailedAt) }}</template>. Prices and lines are locked. Revise it to change them.
        </span>
      </NoticeBanner>
      <NoticeBanner v-else-if="quote?.expired" kind="error">Expired on {{ formatDate(quote.validUntil ?? '') }}. Revise it with a new valid-until date before turning it into a sales order.</NoticeBanner>
      <NoticeBanner v-else-if="quote?.status === 'ORDERED' && quote.salesOrder">
        Turned into sales order
        <RouterLink v-if="quote.salesOrder.id" :to="`/sales/orders/${quote.salesOrder.id}`" class="erp-link font-semibold">{{ quote.salesOrder.no }}</RouterLink>
        <strong v-else>{{ quote.salesOrder.no }}</strong>. The quotation is closed.
      </NoticeBanner>
      <NoticeBanner v-else-if="quote?.status === 'LOST'" kind="error">Marked as lost<template v-if="quote.lostReason">: “{{ quote.lostReason }}”</template>.</NoticeBanner>
      <NoticeBanner v-else-if="quote?.status === 'SUPERSEDED'">Replaced by a newer revision. This revision is kept for history.</NoticeBanner>
      <NoticeBanner v-else-if="quote?.status === 'PENDING_APPROVAL'" kind="warning">
        Waiting for <strong>{{ quote.approval.waitingFor }}</strong> to approve: {{ quote.approval.reason }}. The quotation is locked until someone decides.
      </NoticeBanner>
      <NoticeBanner v-else-if="quote?.approval.state === 'REJECTED' && quote.status === 'DRAFT'" kind="error">
        Discount rejected by {{ quote.approval.decidedBy }}<template v-if="quote.approval.comment">: “{{ quote.approval.comment }}”</template>. Lower the discount or request approval again.
      </NoticeBanner>
      <NoticeBanner v-else-if="quote?.approval.state === 'APPROVED' && quote.status === 'DRAFT'">
        Discount approved by {{ quote.approval.decidedBy }}<template v-if="quote.approval.comment"> · “{{ quote.approval.comment }}”</template>. You can release the quotation.
      </NoticeBanner>

      <!-- Header fields (QuotationForm.html order) -->
      <section class="erp-card grid grid-cols-5 gap-x-4 gap-y-3 px-5 py-[18px]">
        <FormField label="Customer" :error="errors.customerCode" for="qt-customer">
          <MasterDataPicker
            v-if="isNew"
            v-model="form.customer"
            input-id="qt-customer"
            :search="searchCustomers"
            :invalid="Boolean(errors.customerCode)"
            :display="(c) => `${c.name} (${c.code})`"
            placeholder="Type a customer code or name"
            @picked="onCustomerPicked"
          />
          <div v-else class="erp-input-ro truncate">{{ form.customer?.name }} ({{ form.customer?.code }})</div>
        </FormField>
        <FormField label="Contact" for="qt-contact">
          <input v-if="editable" id="qt-contact" v-model="form.contactName" class="erp-input" maxlength="100" />
          <div v-else class="erp-input-ro">{{ form.contactName || '—' }}</div>
        </FormField>
        <FormField label="Quotation date" for="qt-date">
          <DatePicker v-if="editable" input-id="qt-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
          <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
        </FormField>
        <FormField label="Valid until" :error="errors.validUntil" for="qt-valid">
          <DatePicker
            v-if="editable"
            input-id="qt-valid"
            :model-value="isoToDate(form.validUntil)"
            :min-date="isoToDate(form.docDate) ?? undefined"
            date-format="d M yy"
            show-icon
            show-button-bar
            fluid
            class="erp-date"
            :invalid="Boolean(errors.validUntil)"
            @update:model-value="form.validUntil = dateToIso($event)"
          />
          <div v-else class="erp-input-ro" :class="quote?.expired ? 'font-semibold text-note-error-text' : ''">{{ formatDate(form.validUntil) || '—' }}</div>
        </FormField>
        <FormField label="Sales agent"><div class="erp-input-ro">{{ quote?.agent.name ?? user?.name }}</div></FormField>

        <FormField label="Branch"><div class="erp-input-ro">{{ quote?.branch.name ?? form.customer?.branchCode ?? '—' }}</div></FormField>
        <FormField label="Currency"><div class="erp-input-ro">{{ quote?.currency ?? 'MYR' }}</div></FormField>
        <FormField label="Tax mode"><div class="erp-input-ro">{{ quote?.taxMode === 'INCLUSIVE' ? 'Inclusive' : 'Exclusive' }}</div></FormField>
        <FormField label="Credit term"><div class="erp-input-ro">{{ form.customer ? `${quote?.creditTermDays ?? form.customer.creditTermDays} days` : '—' }}</div></FormField>
        <FormField label="Price list"><div class="erp-input-ro">{{ quote?.priceList.name ?? form.customer?.priceListCode ?? '—' }}</div></FormField>
      </section>

      <!-- Tabs: lines, terms, attachments, history -->
      <section id="qt-lines" class="erp-card flex flex-col gap-3 px-5 pt-3.5 pb-[18px]">
        <div class="flex gap-6 border-b border-erp-border" role="tablist">
          <button
            v-for="t in [
              { key: 'lines', label: `Lines · ${form.lines.length}` },
              { key: 'terms', label: 'Terms and notes' },
              { key: 'attachments', label: `Attachments · ${quote?.attachments.length ?? 0}` },
              { key: 'history', label: 'History' },
            ] as const"
            :key="t.key"
            type="button"
            role="tab"
            :aria-selected="tab === t.key"
            class="-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-0 pt-1 pb-2.5 text-[13px] font-semibold"
            :class="tab === t.key ? 'border-mod-primary text-mod-accent' : 'border-transparent text-erp-muted'"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <template v-if="tab === 'lines'">
          <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          <div class="overflow-x-auto">
            <table class="erp-table [&_td]:px-2.5 [&_th]:px-2.5">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item code</th>
                  <th>Description</th>
                  <th class="num">Qty</th>
                  <th>UOM</th>
                  <th class="num">Unit price</th>
                  <th class="num">Disc %</th>
                  <th>Tax</th>
                  <th class="num">Amount</th>
                  <th v-if="editable" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                <tr v-if="!form.lines.length">
                  <td :colspan="editable ? 10 : 9" class="text-center text-erp-muted">No items yet. Click Add line to pick from Master Data.</td>
                </tr>
                <template v-for="(l, i) in form.lines" :key="l.key">
                  <tr>
                    <td class="text-erp-muted">{{ i + 1 }}</td>
                    <td class="font-bold whitespace-nowrap">{{ l.item.code }}</td>
                    <td>{{ l.item.name }}</td>
                    <td class="num w-[90px] min-w-[76px]">
                      <input v-if="editable" v-model="l.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                      <template v-else>{{ formatQty(l.qty) }}</template>
                    </td>
                    <td>{{ l.item.uomCode }}</td>
                    <td class="num w-[110px] min-w-[96px]">
                      <input v-if="editable" v-model="l.unitPrice" class="erp-cell min-w-[80px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Unit price, line ${i + 1}`" />
                      <template v-else>{{ formatPrice(l.unitPrice) }}</template>
                    </td>
                    <td class="num w-[70px] min-w-[64px]">
                      <input
                        v-if="editable"
                        v-model="l.discountPct"
                        class="erp-cell min-w-[48px]"
                        :class="overLimit(l) ? 'border-attention text-attention' : ''"
                        inputmode="decimal"
                        placeholder="0"
                        :aria-invalid="Boolean(errors[`lines[${i}].discountPct`])"
                        :aria-label="`Discount %, line ${i + 1}`"
                      />
                      <span v-else :class="overLimit(l) ? 'font-semibold text-attention' : ''">{{ l.discountPct || '0' }}</span>
                    </td>
                    <td class="whitespace-nowrap">{{ l.item.taxName }}</td>
                    <td class="num"><MoneyText :value="editable ? (previews[i]?.amount ?? null) : (quote?.lines[i]?.amount ?? null)" /></td>
                    <td v-if="editable" class="w-8">
                      <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove line ${i + 1}`" @click="removeLine(l.key)">
                        <X :size="14" />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="editable || l.item.lastSold" class="bg-erp-head">
                    <td :colspan="editable ? 10 : 9" class="!py-1.5 text-xs text-erp-muted">
                      {{ lineHint(l) }} ·
                      <button type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-xs" @click="later('Price history')">Price history</button>
                      <span v-if="overLimit(l)" class="ml-2 font-semibold text-attention">Above the {{ Number(quote?.discount.limitPct ?? 15) }}% discount rule</span>
                      <span v-for="key in ['qty', 'unitPrice', 'discountPct']" :key="key" class="ml-2 text-note-error-text">{{ errors[`lines[${i}].${key}`] }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div v-if="editable" class="flex gap-2">
            <button type="button" class="erp-btn erp-btn-secondary" @click="openPicker"><Plus :size="14" aria-hidden="true" />Add line</button>
            <button type="button" class="erp-btn erp-btn-secondary" @click="later('Heading line')"><Plus :size="14" aria-hidden="true" />Heading line</button>
            <button v-if="quote?.enquiry" type="button" class="erp-btn erp-btn-secondary" @click="copyFromEnquiry">Copy from enquiry</button>
          </div>
        </template>

        <template v-else-if="tab === 'terms'">
          <div class="grid grid-cols-2 gap-4">
            <FormField label="Internal note (not printed)" for="qt-internal">
              <textarea v-if="editable" id="qt-internal" v-model="form.internalNote" rows="4" class="erp-input h-auto py-2" maxlength="2000" />
              <div v-else class="erp-input-ro h-auto min-h-9 py-2 whitespace-pre-line">{{ form.internalNote || '—' }}</div>
            </FormField>
            <div class="flex flex-col gap-1.5 text-[13px]">
              <span class="text-xs font-medium text-erp-muted">Terms printed on the quotation</span>
              <span>Payment: {{ quote?.creditTermDays ?? form.customer?.creditTermDays ?? 0 }} days from invoice.</span>
              <span>Prices in {{ quote?.currency ?? 'MYR' }}, tax {{ quote?.taxMode === 'INCLUSIVE' ? 'included' : 'added' }} as shown per line.</span>
              <span>Valid until {{ formatDate(form.validUntil) || '— (set before release)' }}.</span>
            </div>
          </div>
        </template>

        <template v-else-if="tab === 'attachments'">
          <ul v-if="quote?.attachments.length" class="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
            <li v-for="a in quote.attachments" :key="a.id" class="flex items-center gap-2">
              <Paperclip :size="14" class="text-erp-muted" aria-hidden="true" />
              <a :href="a.downloadUrl" target="_blank" rel="noopener" class="erp-link">{{ a.fileName }}</a>
            </li>
          </ul>
          <p v-else class="m-0 text-[13px] text-erp-muted">No files attached.</p>
        </template>

        <template v-else>
          <div class="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-4">
            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-erp-muted">Revisions</span>
              <RouterLink
                v-for="r in quote?.revisions ?? []"
                :key="r.id"
                :to="`/sales/quotations/${r.id}`"
                class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] no-underline"
                :class="r.id === quote?.id ? 'border-mod-primary bg-mod-light text-erp-text' : 'border-erp-border text-erp-text hover:bg-erp-head'"
              >
                <span>Rev {{ r.revision }} · {{ formatDate(r.docDate) }}</span>
                <MoneyText :value="r.total" />
              </RouterLink>
              <span v-if="!quote" class="text-[13px] text-erp-muted">Saved revisions show here.</span>
            </div>
            <ActivityList v-if="quote" :items="quote.activity" />
          </div>
        </template>
      </section>

      <!-- Discount approval (rule 3: discount over 15% needs Sales Manager) -->
      <section v-if="showDiscountPanel && quote" class="flex flex-col gap-3 rounded-xl border-2 border-note-warn-border bg-erp-card px-5 py-[18px]">
        <div>
          <h2 class="m-0 text-[15px] font-bold text-note-warn-text">Discount needs approval</h2>
          <p class="m-0 mt-0.5 text-xs text-erp-muted">
            A line discount above {{ Number(quote.discount.limitPct) }}% needs the Sales Manager's approval before the quotation can be released.
            <template v-if="quote.discount.over"> Highest discount now: {{ Number(quote.discount.highest) }}%.</template>
            <template v-else> Save the draft to check it.</template>
          </p>
        </div>
        <template v-if="can('requestApproval')">
          <FormField label="Reason for the approver" :error="reasonError" for="qt-reason">
            <textarea id="qt-reason" v-model="reason" rows="2" class="erp-input h-auto py-2" maxlength="1000" :aria-invalid="Boolean(reasonError)" />
          </FormField>
          <div class="flex justify-end">
            <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="requestApproval">Request approval</button>
          </div>
        </template>
      </section>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_340px]">
        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <NoticeBanner v-if="quote?.creditWarning" kind="warning">
            <strong>{{ quote.creditWarning.split('. ')[0] }}.</strong> {{ quote.creditWarning.split('. ').slice(1).join('. ') }}
          </NoticeBanner>
          <FormField label="Customer-facing note" for="qt-note">
            <textarea v-if="editable" id="qt-note" v-model="form.customerNote" rows="3" class="erp-input h-auto py-2" maxlength="2000" />
            <div v-else class="erp-input-ro h-auto min-h-16 py-2 whitespace-pre-line">{{ form.customerNote || '—' }}</div>
          </FormField>
        </section>

        <aside class="flex flex-col gap-4">
        <SideCard title="Totals (MYR)">
          <div v-if="totals" class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Subtotal</span><MoneyText :value="totals.subtotal" /></div>
            <div class="flex justify-between gap-3 py-[5px]">
              <span class="text-erp-muted">Discount</span><span class="erp-num">{{ Number(totals.discountTotal) ? '− ' : '' }}<MoneyText :value="totals.discountTotal" /></span>
            </div>
            <div v-for="t in totals.taxLines" :key="t.code" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax ({{ t.name }})</span><MoneyText :value="t.amount" /></div>
            <div v-if="!totals.taxLines.length" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax</span><MoneyText value="0.00" /></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[5px]"><span class="text-erp-muted">Rounding</span><MoneyText :value="totals.rounding" /></div>
            <div class="flex justify-between gap-3 pt-2 text-lg font-bold"><span>Total</span><MoneyText :value="totals.total" /></div>
            <span v-if="quote?.marginPct && !dirty" class="pt-1.5 text-xs text-erp-muted">Est. margin {{ quote.marginPct }}% · visible to Sales Manager</span>
          </div>
        </SideCard>
        <LinkedDocs v-if="quote && quote.links.length" :docs="quote.links" :route-of="docRoute" />
        </aside>
      </div>
      <p v-if="locked && quote?.status === 'DRAFT'" class="m-0 text-xs text-erp-muted">Only the sales team can change this draft.</p>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${quote?.docNo ?? 'New quotation'} · ${form.customer?.name ?? ''} · ${quote?.branch.name ?? form.customer?.branchCode ?? ''}${quote ? ` · price list ${quote.priceList.name}` : ''}`"
      :customer-code="form.customer?.code ?? null"
      :branch-code="quote?.branch.code ?? form.customer?.branchCode ?? null"
      :branch-name="quote?.branch.name ?? 'this branch'"
      :on-lines="onLines"
      @add="addItems"
    />
    <ReasonDialog
      v-model:visible="lostOpen"
      :title="`Mark ${quote?.docNo} as lost`"
      message="The quotation is closed and its enquiry is marked lost too."
      label="Why was it lost?"
      confirm-label="Mark as lost"
      danger
      @confirm="markLost"
    />
    <Dialog v-model:visible="pickLinesOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '520px' }" header="Choose lines for the sales order">
      <div class="flex flex-col gap-2 text-[13px]">
        <label v-for="l in quote?.lines ?? []" :key="l.lineNo" class="flex items-center gap-2">
          <input v-model="pickedLines" type="checkbox" :value="l.lineNo" />
          <span class="font-semibold">{{ l.itemCode }}</span> {{ l.itemName }} · {{ formatQty(l.qty) }} {{ l.uomCode }}
        </label>
      </div>
      <template #footer>
        <button type="button" class="erp-btn erp-btn-secondary" @click="pickLinesOpen = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="!pickedLines.length || saving" @click="transfer(pickedLines)">Create sales order</button>
      </template>
    </Dialog>
  </template>
</template>
