<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import Menu from 'primevue/menu'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ChevronDown, Clock, Lock, Plus, X } from '@lucide/vue'
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
import { formatDate, formatMoney, formatPrice, formatQty, formatRm } from '@/utils/format'
import { isPositiveDecimal, previewSaleLine, sumMoney } from '@/utils/money'
import { salesInvoicesApi, salesLookupsApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import { docRoute } from '../routes'
import type { CustomerOption, InvoiceAction, InvoiceDetail, SaleItemOption } from '../types'

/** S19 · Invoice (InvoiceForm.html): a draft to review and release, or a released invoice. "blank" = a new direct invoice. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'blank')
const inv = ref<InvoiceDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const reason = ref('')
const reasonError = ref('')
const pickerOpen = ref(false)
const transferMenu = ref<InstanceType<typeof Menu> | null>(null)

interface EditLine {
  key: number
  lineNo: number
  itemCode: string
  itemName: string
  uomCode: string
  taxName: string
  taxRate: string
  listPrice: string | null
  qty: string
  unitPrice: string
  discountPct: string
  canInvoiceQty: string | null
}
let nextKey = 1
const form = reactive({ customer: null as CustomerOption | null, docDate: '', customerPoRef: '', note: '', lines: [] as EditLine[] })
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')
const trimPrice = (v: string) => v.replace(/(\.\d\d)00$/, '$1')

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => [l.itemCode, l.qty, l.unitPrice, l.discountPct]) })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: InvoiceAction) => (isNew.value ? a === 'edit' : Boolean(inv.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))
const direct = computed(() => isNew.value || inv.value?.kind === 'DIRECT')

function fill(i: InvoiceDetail | null) {
  if (i) {
    form.customer = { code: i.customer.code, name: i.customer.name, branchCode: i.branch.code, contactName: i.contactName, deliveryAddress: null, creditTermDays: i.creditTermDays, priceListCode: '', creditLimit: null, defaultAgentCode: null }
    form.docDate = i.docDate
    form.customerPoRef = i.customerPoRef ?? ''
    form.note = i.note ?? ''
    form.lines = i.lines.map((l) => ({
      key: nextKey++, lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxName: l.taxName, taxRate: l.taxRate, listPrice: l.listPrice,
      qty: plain(l.qty), unitPrice: trimPrice(l.unitPrice), discountPct: Number(l.discountPct) ? l.discountPct.replace(/\.?0+$/, '') : '', canInvoiceQty: l.canInvoiceQty,
    }))
  } else {
    Object.assign(form, { customer: null, docDate: today.value, customerPoRef: '', note: '', lines: [] })
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    inv.value = isNew.value ? null : await salesInvoicesApi.get(id.value)
    fill(inv.value)
    setCrumb(inv.value?.docNo ?? 'Blank invoice')
  } finally {
    loading.value = false
  }
}
onMounted(load)
function show(i: InvoiceDetail) {
  inv.value = i
  fill(i)
  setCrumb(i.docNo)
}

const searchCustomers = async (q: string) => (await salesLookupsApi.customers(q)).items
function addItems(picked: { item: SaleItemOption; qty: string }[]) {
  for (const { item, qty } of picked) {
    form.lines.push({
      key: nextKey++, lineNo: 0, itemCode: item.code, itemName: item.name, uomCode: item.uomCode, taxName: item.taxName, taxRate: item.taxRate, listPrice: item.listPrice,
      qty, unitPrice: trimPrice(item.listPrice ?? item.lastSold?.price ?? ''), discountPct: '', canInvoiceQty: null,
    })
  }
}
function openPicker() {
  if (!form.customer) {
    errors.value = { ...errors.value, customerCode: 'Pick the customer first, so the right price list is used.' }
    return
  }
  pickerOpen.value = true
}

// ── Preview while editing; the server's totals are the truth ─────────────────
const previews = computed(() => form.lines.map((l) => previewSaleLine(l.qty || '0', l.unitPrice || '0', l.discountPct || '0', l.taxRate)))
const previewTotals = computed(() => {
  const ok = previews.value.filter((p) => p !== null)
  const taxes = new Map<string, string[]>()
  form.lines.forEach((l, i) => {
    const p = previews.value[i]
    if (p) taxes.set(l.taxName, [...(taxes.get(l.taxName) ?? []), p.taxAmount])
  })
  const taxLines = [...taxes].map(([name, amounts]) => ({ code: name, name, amount: sumMoney(amounts) }))
  return {
    subtotal: sumMoney(ok.map((p) => p!.grossAmount)),
    discountTotal: sumMoney(ok.map((p) => p!.discountAmount)),
    taxLines,
    rounding: '0.00',
    total: sumMoney([sumMoney(ok.map((p) => p!.amount)), ...taxLines.map((t) => t.amount)]),
  }
})
const totals = computed(() => (editable.value && (dirty.value || isNew.value) ? previewTotals.value : (inv.value?.totals ?? previewTotals.value)))

// ── Save, approval, release ──────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (direct.value && !form.customer) e.customerCode = 'Pick the customer from Master Data.'
  if (!form.lines.length) e.lines = 'Add at least one item.'
  form.lines.forEach((l, i) => {
    if (!isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    else if (l.canInvoiceQty !== null && Number(l.qty) > Number(l.canInvoiceQty)) e[`lines[${i}].qty`] = `Invoice now cannot be more than delivered minus invoiced (${formatQty(l.canInvoiceQty)}).`
    if (direct.value && !/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<InvoiceDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const fields = { docDate: form.docDate || undefined, customerPoRef: form.customerPoRef, note: form.note }
    const directLines = form.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct || '0' }))
    const result = isNew.value
      ? await salesInvoicesApi.createDirect({ ...fields, customerCode: form.customer!.code, lines: directLines })
      : await salesInvoicesApi.update(inv.value!.id, {
          ...fields,
          version: inv.value!.version,
          ...(direct.value ? { lines: directLines } : { quantities: form.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })) }),
        })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 3000 })
    if (isNew.value) await router.replace(`/sales/invoices/${result.id}`)
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
  const i = inv.value!
  if (!i.allowedActions.includes('release')) {
    toast.add({ severity: 'warn', summary: 'Approval needed first', detail: 'Request approval below, then release once it is approved.', life: 5000 })
    return
  }
  confirm.require({
    header: `Release ${i.docNo}?`,
    message: `${i.docNo} for ${formatRm(i.totals.total)} is locked and queued for Finance and LHDN e-Invoice. Corrections then go through a debit note or a sales return.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      saving.value = true
      try {
        show(await salesInvoicesApi.release(i.id, i.version))
        toast.add({ severity: 'success', summary: `${i.docNo} released`, detail: 'Posting and e-Invoice queued.', life: 4000 })
      } finally {
        saving.value = false
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
  const i = inv.value!
  saving.value = true
  try {
    show(await salesInvoicesApi.requestApproval(i.id, i.version, reason.value.trim()))
    reason.value = ''
    notifyApprovalsChanged()
    toast.add({ severity: 'success', summary: 'Approval requested', detail: `${i.docNo} is waiting for ${inv.value?.approval.waitingFor ?? 'the approver'}.`, life: 4000 })
  } finally {
    saving.value = false
  }
}

async function email() {
  const i = inv.value!
  const result = await salesInvoicesApi.email(i.id)
  toast.add({ severity: 'success', summary: 'Sent', detail: `${i.docNo} emailed to ${result.sentTo}.`, life: 4000 })
  show(await salesInvoicesApi.get(i.id))
}

function deleteDraft() {
  const i = inv.value!
  confirm.require({
    header: `Delete ${i.docNo}?`,
    message: `The draft is removed. Its number ${i.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesInvoicesApi.remove(i.id, i.version)
      toast.add({ severity: 'success', summary: `${i.docNo} deleted`, life: 3000 })
      notifyApprovalsChanged()
      void router.push('/sales/invoices')
    },
  })
}

const transferItems = computed(() => [
  { label: 'Debit note', disabled: !can('debitNote'), command: () => router.push({ path: '/sales/debit-notes/new', query: { invoice: inv.value!.id } }) },
  { label: 'Sales return', disabled: !can('return'), command: () => router.push({ path: '/sales/returns/new', query: { invoice: inv.value!.id } }) },
])

// ── Display ──────────────────────────────────────────────────────────────────
const released = computed(() => inv.value?.status === 'RELEASED')
const statusChip = computed(() => {
  const i = inv.value
  if (!i) return { status: 'DRAFT', label: 'New', group: 'draft' as const }
  if (i.status === 'RELEASED') return { status: 'RELEASED', label: 'Released', group: 'released' as const }
  if (i.status === 'PENDING_APPROVAL') return { status: 'PENDING_APPROVAL', label: 'Pending approval', group: 'pending' as const }
  return i.approval.state === 'APPROVED' && !i.checks.needsApproval ? { status: 'APPROVED', label: 'Approved', group: 'done' as const } : { status: 'DRAFT', label: 'Draft', group: 'draft' as const }
})
const paymentChip = computed(() => {
  const i = inv.value
  if (!i || !released.value) return null
  if (i.payment.key === 'PAID') return { label: 'Paid', group: 'done' as const }
  if (i.payment.key === 'OVERDUE') return { label: i.payment.label, group: 'cancelled' as const }
  return { label: `Unpaid · due ${formatDate(i.dueDate ?? '')}`, group: 'cancelled' as const }
})
const dueText = computed(() => {
  if (!form.docDate || !inv.value) return '—'
  const d = new Date(`${form.docDate}T00:00:00`)
  d.setDate(d.getDate() + inv.value.creditTermDays)
  return `${inv.value.creditTermDays} days · ${formatDate(dateToIso(d))}`
})
const credit = computed(() => inv.value?.checks.credit?.snapshot ?? null)
const showApprovalPanel = computed(() => Boolean(inv.value && inv.value.status === 'DRAFT' && (inv.value.checks.needsApproval || inv.value.checks.creditBlocked)))
const belowList = (l: EditLine) => Boolean(l.listPrice && l.unitPrice && Number(l.unitPrice) < Number(l.listPrice))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="isNew ? 'Blank invoice' : `Invoice ${inv?.docNo ?? ''}`" document>
      <template #chip>
        <StatusChip :status="statusChip.status" :label="statusChip.label" :group="statusChip.group" />
        <StatusChip v-if="paymentChip" status="PAYMENT" :label="paymentChip.label" :group="paymentChip.group" />
      </template>
      <template v-if="inv" #subtitle>
        {{ inv.customer.name }}
        <template v-if="inv.order">
          · from
          <RouterLink v-if="inv.order.id" :to="`/sales/orders/${inv.order.id}`" class="erp-link">{{ inv.order.no }}</RouterLink>
          <template v-else>{{ inv.order.no }}</template>
          <template v-for="(d, n) in inv.deliveries" :key="d.no">
            {{ n === 0 ? ' and ' : ', ' }}<RouterLink v-if="d.id" :to="`/sales/deliveries/${d.id}`" class="erp-link">{{ d.no }}</RouterLink><template v-else>{{ d.no }}</template>
          </template>
        </template>
        <template v-else> · direct invoice</template>
      </template>
      <template v-else #subtitle>A direct invoice without a sales order. Items come from Master Data; the number is given when you save.</template>
      <template #actions>
        <template v-if="isNew">
          <RouterLink to="/sales/invoices" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save draft</button>
        </template>
        <template v-else-if="inv">
          <RouterLink v-if="!released" to="/sales/invoices" class="erp-btn erp-btn-secondary">Back</RouterLink>
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
          <RouterLink :to="`/sales/invoices/${inv.id}/print`" class="erp-btn erp-btn-secondary">Print</RouterLink>
          <button v-if="released" type="button" class="erp-btn erp-btn-secondary" :disabled="!can('email')" @click="email">Email to customer</button>
          <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || !dirty" @click="save">Save draft</button>
          <button v-if="inv.status === 'DRAFT'" type="button" class="erp-btn erp-btn-primary" :disabled="saving || (!can('release') && !dirty)" @click="release">Release</button>
          <template v-if="released">
            <button type="button" class="erp-btn erp-btn-primary" @click="transferMenu?.toggle($event)">Transfer to <ChevronDown :size="14" aria-hidden="true" /></button>
            <Menu ref="transferMenu" :model="transferItems" popup />
          </template>
        </template>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <div v-if="released && inv && !inv.isMigrated" class="grid grid-cols-2 gap-4">
        <div class="flex items-start gap-2.5 rounded-[10px] border border-note-warn-border bg-note-warn-bg px-3.5 py-2.5 text-[13px] text-note-warn-text">
          <Clock :size="16" class="mt-0.5 shrink-0 text-note-warn-strong" aria-hidden="true" />
          <span><strong class="block">Accounting posting: {{ inv.posting.accounts === 'POSTED' ? 'posted' : 'queued' }}</strong>Finance is not connected yet. The receivable is posted automatically once it is.</span>
        </div>
        <div class="flex items-start gap-2.5 rounded-[10px] border border-note-warn-border bg-note-warn-bg px-3.5 py-2.5 text-[13px] text-note-warn-text">
          <Clock :size="16" class="mt-0.5 shrink-0 text-note-warn-strong" aria-hidden="true" />
          <span><strong class="block">LHDN e-Invoice: pending</strong>Never skipped. It is submitted when the e-Invoice module is plugged in.</span>
        </div>
      </div>
      <NoticeBanner v-if="inv?.status === 'PENDING_APPROVAL'" kind="warning">
        Waiting for <strong>{{ inv.approval.waitingFor }}</strong> to approve: {{ inv.approval.reason }}. The invoice is locked until someone decides.
      </NoticeBanner>
      <NoticeBanner v-else-if="inv?.approval.state === 'REJECTED' && inv.status === 'DRAFT'" kind="error">
        Rejected by {{ inv.approval.decidedBy }}<template v-if="inv.approval.comment">: “{{ inv.approval.comment }}”</template>. Change the invoice and request approval again.
      </NoticeBanner>
      <NoticeBanner v-else-if="inv?.approval.state === 'APPROVED' && inv.status === 'DRAFT'">
        Approved by {{ inv.approval.decidedBy }}<template v-if="inv.approval.comment"> · “{{ inv.approval.comment }}”</template>.
        {{ inv.checks.needsApproval ? 'Another approval is still needed; see below.' : 'You can release the invoice.' }}
      </NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField :label="form.customer ? `Customer · ${form.customer.code}` : 'Customer · from Master Data'" :error="errors.customerCode" for="inv-customer">
              <MasterDataPicker v-if="isNew" v-model="form.customer" input-id="inv-customer" :search="searchCustomers" :display="(c) => c.name" placeholder="Type a customer code or name" />
              <div v-else class="erp-input-ro truncate">{{ form.customer?.name }}</div>
            </FormField>
            <FormField label="Invoice date" for="inv-date">
              <DatePicker v-if="editable" input-id="inv-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Credit term · due"><div class="erp-input-ro truncate">{{ inv ? dueText : form.customer ? `${form.customer.creditTermDays} days` : '—' }}</div></FormField>
            <FormField label="Currency · tax mode"><div class="erp-input-ro">{{ inv?.currency ?? 'MYR' }} · {{ inv?.taxMode === 'INCLUSIVE' ? 'Inclusive' : 'Exclusive' }}</div></FormField>
            <FormField class="col-span-2" label="Bill to"><div class="erp-input-ro truncate">{{ inv?.billTo ?? '—' }}</div></FormField>
            <FormField label="Customer TIN"><div class="erp-input-ro truncate">{{ inv ? (inv.customer.tin ? 'On file in Master Data' : 'Missing in Master Data') : '—' }}</div></FormField>
            <FormField label="Sales agent"><div class="erp-input-ro">{{ inv?.agent.name ?? user?.name }}</div></FormField>
            <FormField v-if="editable" class="col-span-2" label="Customer PO ref" for="inv-po">
              <input id="inv-po" v-model="form.customerPoRef" class="erp-input" maxlength="50" />
            </FormField>
            <FormField v-if="editable" class="col-span-2" label="Note printed on the invoice" for="inv-note">
              <input id="inv-note" v-model="form.note" class="erp-input" maxlength="2000" />
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <div class="flex items-baseline justify-between gap-3">
              <h2 class="m-0 text-[15px] font-bold">Lines</h2>
              <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
            </div>
            <div class="overflow-x-auto">
              <table class="erp-table [&_td]:px-2.5 [&_th]:px-2.5">
                <thead>
                  <tr>
                    <th>Item</th><th>Description</th><th class="num">Qty</th><th>UOM</th><th class="num">Unit price</th><th class="num">Disc</th><th>Tax</th>
                    <th class="num">Tax amount</th><th class="num">Amount</th><th v-if="editable && direct" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!form.lines.length"><td :colspan="10" class="text-center text-erp-muted">No items yet. Click Add item to pick from Master Data.</td></tr>
                  <template v-for="(l, i) in form.lines" :key="l.key">
                    <tr>
                      <td class="font-bold whitespace-nowrap">{{ l.itemCode }}</td>
                      <td>{{ l.itemName }}</td>
                      <td class="num w-[90px]">
                        <input v-if="editable" v-model="l.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                        <template v-else>{{ formatQty(l.qty) }}</template>
                      </td>
                      <td>{{ l.uomCode }}</td>
                      <td class="num w-[110px]">
                        <input v-if="editable && direct" v-model="l.unitPrice" class="erp-cell min-w-[80px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Unit price, line ${i + 1}`" />
                        <template v-else>{{ formatPrice(l.unitPrice) }}</template>
                      </td>
                      <td class="num w-[70px]">
                        <input v-if="editable && direct" v-model="l.discountPct" class="erp-cell min-w-[48px]" inputmode="decimal" placeholder="0" :aria-label="`Discount %, line ${i + 1}`" />
                        <template v-else>{{ (Number(l.discountPct) || 0).toFixed(2) }}</template>
                      </td>
                      <td class="whitespace-nowrap">{{ l.taxName }}</td>
                      <td class="num"><MoneyText :value="editable ? (previews[i]?.taxAmount ?? null) : (inv?.lines[i]?.taxAmount ?? null)" /></td>
                      <td class="num"><MoneyText :value="editable ? (previews[i]?.amount ?? null) : (inv?.lines[i]?.amount ?? null)" /></td>
                      <td v-if="editable && direct" class="w-8">
                        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove line ${i + 1}`" @click="form.lines.splice(i, 1)"><X :size="14" /></button>
                      </td>
                    </tr>
                    <tr v-if="(editable && (l.canInvoiceQty !== null || belowList(l))) || (!editable && belowList(l)) || errors[`lines[${i}].qty`]">
                      <td :colspan="10" class="!pt-0 text-xs" :class="belowList(l) ? 'text-attention' : 'text-erp-muted'">
                        <template v-if="belowList(l)">{{ Math.round((1 - Number(l.unitPrice) / Number(l.listPrice)) * 100) }}% below the price list (RM {{ formatPrice(l.listPrice!) }}) · needs Sales Manager approval. </template>
                        <template v-if="editable && l.canInvoiceQty !== null">Can invoice {{ formatQty(l.canInvoiceQty) }} (delivered minus invoiced). </template>
                        <span v-for="key in ['qty', 'unitPrice']" :key="key" class="ml-1 text-note-error-text">{{ errors[`lines[${i}].${key}`] }}</span>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div v-if="editable && direct"><button type="button" class="erp-btn erp-btn-secondary" @click="openPicker"><Plus :size="14" aria-hidden="true" />Add item</button></div>
          </section>

          <!-- Approval before release: price (Sales Manager) and/or credit (Finance Manager) -->
          <section v-if="showApprovalPanel && inv" class="flex flex-col gap-3 rounded-xl border-2 border-note-warn-border bg-erp-card px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold text-note-warn-text">Approval needed before release</h2>
            <ul class="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px]">
              <li v-if="inv.checks.needsPrice && inv.checks.priceBelowList">
                Unit price {{ inv.checks.priceBelowList.highestPct }}% below the price list on {{ inv.checks.priceBelowList.count }} {{ inv.checks.priceBelowList.count === 1 ? 'line' : 'lines' }} · <strong>Sales Manager</strong> decides.
              </li>
              <li v-if="(inv.checks.needsCredit || inv.checks.creditBlocked) && credit">
                Credit: owed {{ formatRm((Number(credit.owed) + Number(credit.otherOpen)).toFixed(2)) }} + this invoice {{ formatRm(credit.thisDocument) }} against
                {{ credit.creditLimit ? formatRm(credit.creditLimit) : 'no' }} limit<template v-if="Number(credit.overCredit) > 0"> (over by {{ formatRm(credit.overCredit) }})</template>; overdue
                {{ formatRm(credit.overdue) }}<template v-if="credit.overdueLimit"> of {{ formatRm(credit.overdueLimit) }} limit</template> ·
                <strong>{{ inv.checks.creditBlocked ? 'blocked by policy' : 'Finance Manager decides' }}</strong>.
              </li>
            </ul>
            <template v-if="can('requestApproval')">
              <FormField label="Reason for the approver" :error="reasonError" for="inv-reason">
                <textarea id="inv-reason" v-model="reason" rows="2" class="erp-input h-auto py-2" maxlength="1000" :aria-invalid="Boolean(reasonError)" />
              </FormField>
              <div class="flex justify-end">
                <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="requestApproval">Request approval</button>
              </div>
            </template>
          </section>

          <div v-if="released" class="erp-card flex items-center gap-3 px-5 py-3.5 text-[13px] text-erp-subtle">
            <Lock :size="15" aria-hidden="true" />A released invoice cannot be edited or deleted. Correct it with a debit note or a sales return.
          </div>

          <div v-if="inv" class="grid items-stretch gap-4 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
              <h2 class="m-0 text-[15px] font-bold">Payments received</h2>
              <div v-if="!inv.payments.length" class="flex grow flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-erp-input px-4 py-10 text-center text-[13px]">
                <strong>No payments yet</strong>
                <span class="text-erp-subtle">Receipts recorded in Finance appear here and reduce the balance due.</span>
              </div>
              <div v-else class="flex flex-col text-[13px]">
                <div v-for="p in inv.payments" :key="p.receiptNo" class="flex justify-between gap-3 border-b border-erp-row py-1.5">
                  <span>{{ p.receiptNo }} · {{ formatDate(p.date) }} · {{ p.method.toLowerCase() }}</span><MoneyText :value="p.amount" />
                </div>
              </div>
            </section>
            <ActivityList :items="inv.activity" />
          </div>
        </div>

        <aside class="flex flex-col gap-4">
          <SideCard title="Amounts (MYR)">
            <div v-if="totals" class="flex flex-col text-[13px]">
              <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Subtotal</span><MoneyText :value="totals.subtotal" /></div>
              <div v-if="Number(totals.discountTotal)" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Discount</span><span class="erp-num">− {{ formatMoney(totals.discountTotal) }}</span></div>
              <div v-for="t in totals.taxLines" :key="t.code" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax ({{ t.name }})</span><MoneyText :value="t.amount" /></div>
              <div v-if="Number(totals.rounding)" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Rounding</span><MoneyText :value="totals.rounding" /></div>
              <div class="flex justify-between gap-3 border-t border-erp-row pt-2 pb-[5px] font-bold"><span>Invoice total</span><MoneyText :value="totals.total" /></div>
              <div v-if="inv && !released && inv.amounts.pendingDeposit" class="mt-2 rounded-lg bg-mod-light px-3 py-2 text-xs text-mod-accent">
                On release, the paid deposit on {{ inv.amounts.pendingDeposit.proformaNo }} ({{ formatRm(inv.amounts.pendingDeposit.amount) }}) is knocked off this invoice.
              </div>
              <template v-if="inv && released">
                <div class="flex justify-between gap-3 py-[5px]">
                  <span class="text-erp-muted">Credited<template v-for="r in inv.amounts.creditedBy" :key="r.id"> · <RouterLink :to="`/sales/returns/${r.id}`" class="erp-link">{{ r.no }}</RouterLink></template></span>
                  <span class="erp-num">{{ Number(inv.amounts.credited) ? `− ${formatMoney(inv.amounts.credited)}` : '0.00' }}</span>
                </div>
                <div v-if="Number(inv.amounts.debited)" class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Debit notes</span><span class="erp-num">+ {{ formatMoney(inv.amounts.debited) }}</span></div>
                <div v-if="Number(inv.amounts.deposit)" class="flex justify-between gap-3 py-[5px]">
                  <span class="text-erp-muted">Deposit<template v-if="inv.amounts.proformaNo"> · {{ inv.amounts.proformaNo }}</template></span><span class="erp-num">− {{ formatMoney(inv.amounts.deposit) }}</span>
                </div>
                <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Paid</span><span class="erp-num">{{ Number(inv.amounts.paid) ? `− ${formatMoney(inv.amounts.paid)}` : '0.00' }}</span></div>
                <div class="flex justify-between gap-3 border-t border-erp-row pt-2 text-lg font-bold"><span>Balance due</span><MoneyText :value="inv.amounts.balance" /></div>
              </template>
            </div>
          </SideCard>
          <LinkedDocs v-if="inv && inv.links.length" :docs="inv.links" :route-of="docRoute" :flow-to="inv.order?.id ? `/sales/orders/${inv.order.id}/flow` : null" />
        </aside>
      </div>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${inv?.docNo ?? 'Blank invoice'} · ${form.customer?.name ?? ''}`"
      :customer-code="form.customer?.code ?? null"
      :branch-code="inv?.branch.code ?? form.customer?.branchCode ?? null"
      :branch-name="inv?.branch.name ?? 'this branch'"
      :on-lines="Object.fromEntries(form.lines.map((l, n) => [l.itemCode, n + 1]))"
      @add="addItems"
    />
  </template>
</template>
