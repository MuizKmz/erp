<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatPrice, formatQty, formatRm } from '@/utils/format'
import { isPositiveDecimal, previewLine, sumMoney } from '@/utils/money'
import { salesDebitNotesApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import { docRoute } from '../routes'
import type { DebitDetail, DebitInvoiceView, DebitNoteAction, SaleItemOption } from '../types'

/** S26 · Debit note (DebitNote.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const dn = ref<DebitDetail | null>(null)
const invoice = ref<DebitInvoiceView | null>(null)
const reasons = ref<string[]>([])
const invoiceOptions = ref<{ id: string; docNo: string; customerName: string }[]>([])
const loading = ref(true)
const saving = ref(false)
const pickerOpen = ref(false)
const errors = ref<Record<string, string>>({})

interface Charge {
  key: number
  itemCode: string
  itemName: string
  uomCode: string
  taxName: string
  taxRate: string
  qty: string
  unitPrice: string
}
let nextKey = 1
const form = reactive({ docDate: '', reason: '', note: '', lines: [] as Charge[] })
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')
const trimPrice = (v: string) => v.replace(/(\.\d\d)00$/, '$1')

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => [l.itemCode, l.qty, l.unitPrice]), inv: invoice.value?.invoiceId })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: DebitNoteAction) => (isNew.value ? a === 'edit' : Boolean(dn.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))

function fill(d: DebitDetail) {
  dn.value = d
  invoice.value = d.invoice
  reasons.value = d.reasons
  form.docDate = d.docDate
  form.reason = d.reason
  form.note = d.note ?? ''
  form.lines = d.lines.map((l) => ({ key: nextKey++, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxName: l.taxName, taxRate: l.taxRate, qty: plain(l.qty), unitPrice: trimPrice(l.unitPrice) }))
  saved.value = snapshot()
  errors.value = {}
  setCrumb(d.docNo)
}

async function pickInvoice(invoiceId: string) {
  invoice.value = invoiceId ? await salesDebitNotesApi.invoice(invoiceId) : null
}

onMounted(async () => {
  loading.value = true
  try {
    if (isNew.value) {
      const invoiceId = typeof route.query.invoice === 'string' ? route.query.invoice : ''
      const [meta, options] = await Promise.all([salesDebitNotesApi.list({ pageSize: 1 }), salesDebitNotesApi.invoices('')])
      reasons.value = meta.reasons
      invoiceOptions.value = options.items
      form.docDate = today.value
      form.reason = reasons.value[0] ?? ''
      if (invoiceId) await pickInvoice(invoiceId)
      setCrumb('New debit note')
    } else {
      fill(await salesDebitNotesApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
})

function addItems(picked: { item: SaleItemOption; qty: string }[]) {
  for (const { item, qty } of picked) {
    form.lines.push({ key: nextKey++, itemCode: item.code, itemName: item.name, uomCode: item.uomCode, taxName: item.taxName, taxRate: item.taxRate, qty, unitPrice: trimPrice(item.listPrice ?? '') })
  }
}
function openPicker() {
  if (!invoice.value) {
    errors.value = { ...errors.value, invoiceId: 'Pick the invoice first, so the right customer and price list are used.' }
    return
  }
  pickerOpen.value = true
}

// ── Preview ──────────────────────────────────────────────────────────────────
const previews = computed(() => form.lines.map((l) => previewLine(l.qty || '0', l.unitPrice || '0', l.taxRate)))
const totals = computed(() => {
  if (dn.value && !editable.value) return dn.value.totals
  const ok = previews.value.filter((p) => p !== null)
  const taxes = new Map<string, string[]>()
  form.lines.forEach((l, i) => {
    const p = previews.value[i]
    if (p) taxes.set(l.taxName, [...(taxes.get(l.taxName) ?? []), p.taxAmount])
  })
  const subtotal = sumMoney(ok.map((p) => p!.amount))
  const tax = sumMoney(ok.map((p) => p!.taxAmount))
  return { subtotal, tax, total: sumMoney([subtotal, tax]), taxLines: [...taxes].map(([name, amounts]) => ({ code: name, name, amount: sumMoney(amounts) })) }
})
const dueAfter = computed(() => (invoice.value ? sumMoney([invoice.value.balance, totals.value.total]) : '0.00'))

// ── Save, release ────────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!invoice.value) e.invoiceId = 'Pick the released invoice the charge belongs to.'
  if (!form.lines.length) e.lines = 'Add at least one charge.'
  form.lines.forEach((l, i) => {
    if (!isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (!/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<DebitDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const lines = form.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty, unitPrice: l.unitPrice }))
    const fields = { reason: form.reason, docDate: form.docDate || undefined, note: form.note }
    const result = isNew.value
      ? await salesDebitNotesApi.create({ ...fields, invoiceId: invoice.value!.invoiceId!, lines })
      : await salesDebitNotesApi.update(dn.value!.id, { ...fields, version: dn.value!.version, invoiceId: invoice.value!.invoiceId ?? undefined, lines })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 3000 })
    if (isNew.value) await router.replace(`/sales/debit-notes/${result.id}`)
    fill(result)
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
  const d = dn.value!
  confirm.require({
    header: `Release ${d.docNo}?`,
    message: `${d.invoice.no} goes up by ${formatRm(d.totals.total)}. Posting and a debit-note e-Invoice are queued. A released debit note cannot be changed.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      saving.value = true
      try {
        fill(await salesDebitNotesApi.release(d.id, d.version))
        toast.add({ severity: 'success', summary: `${d.docNo} released`, detail: `${d.invoice.no} now owes ${formatRm(dn.value!.invoice.balance)}.`, life: 4000 })
      } finally {
        saving.value = false
      }
    },
  })
}

function deleteDraft() {
  const d = dn.value!
  confirm.require({
    header: `Delete ${d.docNo}?`,
    message: `The draft is removed. Its number ${d.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesDebitNotesApi.remove(d.id, d.version)
      toast.add({ severity: 'success', summary: `${d.docNo} deleted`, life: 3000 })
      void router.push('/sales/debit-notes')
    },
  })
}

const released = computed(() => dn.value?.status === 'RELEASED')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="isNew ? 'New debit note' : `Debit note ${dn?.docNo ?? ''}`" document>
      <template #chip><StatusChip :status="dn?.status ?? 'DRAFT'" :label="released ? 'Released' : 'Draft'" :group="released ? 'done' : 'draft'" /></template>
      <template #subtitle>
        <template v-if="invoice">
          {{ invoice.customer.name }} · extra charge on
          <RouterLink v-if="invoice.id" :to="`/sales/invoices/${invoice.id}`" class="erp-link">{{ invoice.no }}</RouterLink>
          <template v-else>{{ invoice.no }}</template>
        </template>
        <template v-else>Pick the released invoice the charge belongs to. The number is given when you save.</template>
      </template>
      <template #actions>
        <RouterLink to="/sales/debit-notes" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || (!isNew && !dirty)" @click="save">Save draft</button>
        <button v-if="!released && !isNew" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !can('release')" @click="release">Release</button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="released && dn">
        <span class="inline-flex items-center gap-2"><Lock :size="14" aria-hidden="true" />Released. {{ formatRm(dn.totals.total) }} was added to {{ dn.invoice.no }}; posting and the debit-note e-Invoice are queued.</span>
      </NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField :label="invoice ? `Customer · ${invoice.customer.code}` : 'Customer'"><div class="erp-input-ro truncate">{{ invoice?.customer.name ?? '—' }}</div></FormField>
            <FormField label="Debit note date" for="dn-date">
              <DatePicker v-if="editable" input-id="dn-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Adds to invoice" :error="errors.invoiceId" for="dn-inv">
              <select v-if="isNew" id="dn-inv" class="erp-input" :value="invoice?.invoiceId ?? ''" @change="pickInvoice(($event.target as HTMLSelectElement).value)">
                <option value="">Pick an invoice</option>
                <option v-if="invoice && !invoiceOptions.some((o) => o.id === invoice?.invoiceId)" :value="invoice.invoiceId ?? ''">{{ invoice.no }}</option>
                <option v-for="o in invoiceOptions" :key="o.id" :value="o.id">{{ o.docNo }} · {{ o.customerName }}</option>
              </select>
              <div v-else class="erp-input-ro">{{ invoice?.no }}</div>
            </FormField>
            <FormField label="Due date"><div class="erp-input-ro">{{ formatDate(invoice?.dueDate ?? '') || '—' }}</div></FormField>
            <FormField label="Reason" for="dn-reason">
              <select v-if="editable" id="dn-reason" v-model="form.reason" class="erp-input">
                <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ form.reason }}</div>
            </FormField>
            <FormField class="col-span-3" label="Note printed on the debit note" for="dn-note">
              <input v-if="editable" id="dn-note" v-model="form.note" class="erp-input" maxlength="2000" />
              <div v-else class="erp-input-ro">{{ form.note || '—' }}</div>
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <div class="flex items-center justify-between gap-3">
              <h2 class="m-0 text-[15px] font-bold">Charges</h2>
              <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="openPicker"><Plus :size="14" aria-hidden="true" />Add charge</button>
            </div>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
            <table class="erp-table">
              <thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th>Tax</th><th class="num">Amount</th><th v-if="editable" aria-label="Remove" /></tr></thead>
              <tbody>
                <tr v-if="!form.lines.length"><td :colspan="editable ? 7 : 6" class="text-center text-erp-muted">No charges yet. Click Add charge to pick a service or item from Master Data.</td></tr>
                <tr v-for="(l, i) in form.lines" :key="l.key">
                  <td class="font-bold whitespace-nowrap">{{ l.itemCode }}</td>
                  <td>{{ l.itemName }}</td>
                  <td class="num w-[90px]">
                    <input v-if="editable" v-model="l.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                    <template v-else>{{ formatQty(l.qty) }}</template>
                  </td>
                  <td class="num w-[120px]">
                    <input v-if="editable" v-model="l.unitPrice" class="erp-cell min-w-[80px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Unit price, line ${i + 1}`" />
                    <template v-else>{{ formatPrice(l.unitPrice) }}</template>
                  </td>
                  <td class="whitespace-nowrap">{{ l.taxName }}</td>
                  <td class="num"><MoneyText :value="editable ? (previews[i]?.amount ?? null) : (dn?.lines[i]?.amount ?? null)" /></td>
                  <td v-if="editable" class="w-8">
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove line ${i + 1}`" @click="form.lines.splice(i, 1)"><X :size="14" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="m-0 text-xs text-erp-muted">Service items come from Master Data like goods. Their tax code decides the tax.</p>
          </section>

          <section v-if="invoice && invoice.debitNotes.length" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Debit notes on {{ invoice.no }}</h2>
            <table class="erp-table">
              <thead><tr><th>DN no</th><th>Date</th><th>Reason</th><th class="num">Amount (RM)</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="n in invoice.debitNotes" :key="n.id">
                  <td class="font-semibold whitespace-nowrap">
                    <RouterLink v-if="!n.isMigrated && n.id !== dn?.id" :to="`/sales/debit-notes/${n.id}`" class="erp-link">{{ n.docNo }}</RouterLink>
                    <template v-else>{{ n.docNo }}</template>
                  </td>
                  <td class="whitespace-nowrap">{{ formatDate(n.docDate) }}</td>
                  <td>{{ n.reason }}</td>
                  <td class="num"><MoneyText :value="n.total" /></td>
                  <td><StatusChip :status="n.status" :label="n.status === 'DRAFT' ? 'Draft' : 'Released'" :group="n.status === 'DRAFT' ? 'draft' : 'done'" /></td>
                </tr>
              </tbody>
            </table>
          </section>

          <ActivityList v-if="dn" :items="dn.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <SideCard title="Totals (MYR)">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Charges</span><MoneyText :value="totals.subtotal" /></div>
              <div v-for="t in totals.taxLines" :key="t.code" class="flex justify-between py-[5px]"><span class="text-erp-muted">Tax ({{ t.name }})</span><MoneyText :value="t.amount" /></div>
              <div v-if="!totals.taxLines.length" class="flex justify-between py-[5px]"><span class="text-erp-muted">Tax</span><MoneyText value="0.00" /></div>
              <div class="flex justify-between border-t border-erp-row pt-2 text-lg font-bold"><span>Debit total</span><MoneyText :value="totals.total" /></div>
            </div>
          </SideCard>

          <SideCard v-if="invoice" :title="`${invoice.no} balance`">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">Due now</span><span class="erp-num">{{ formatRm(invoice.balance) }}</span></div>
              <template v-if="!released">
                <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">This debit note</span><span class="erp-num">+ {{ formatRm(totals.total) }}</span></div>
                <div class="flex justify-between py-[6px] font-bold"><span>Due after release</span><span class="erp-num">{{ formatRm(dueAfter) }}</span></div>
              </template>
            </div>
          </SideCard>

          <NextSteps v-if="!released" title="When you release">
            <li><span>The customer owes more on {{ invoice?.no ?? 'the invoice' }}. Posting is queued for Finance.</span></li>
            <li><span>A debit note e-Invoice referencing {{ invoice?.no ?? 'the invoice' }} is queued for LHDN.</span></li>
            <li><span>No stock moves. Debit notes are for money only.</span></li>
          </NextSteps>

          <LinkedDocs v-if="dn && dn.links.length" :docs="dn.links" :route-of="docRoute" />
        </aside>
      </div>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${dn?.docNo ?? 'New debit note'} · ${invoice?.customer.name ?? ''} · charge on ${invoice?.no ?? ''}`"
      :customer-code="invoice?.customer.code ?? null"
      :branch-code="invoice?.branchCode ?? null"
      branch-name="this branch"
      :on-lines="Object.fromEntries(form.lines.map((l, n) => [l.itemCode, n + 1]))"
      @add="addItems"
    />
  </template>
</template>
