<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { FileText } from '@lucide/vue'
import { ApiError, openFile } from '@/api/http'
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
import { formatDate, formatDateTime, formatMoney, formatPrice, formatQty, formatRm, qtyWithUnit } from '@/utils/format'
import { compareQty, isQty, previewLine, subQty, sumMoney, sumQty } from '@/utils/money'
import { attachmentsApi, invoicesApi, lookupsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { BillableOrder, InvoiceAction, InvoiceChoice, InvoiceDetail, InvoiceTemplate, SupplierOption } from '../types'

/** P17 · Purchase invoice · three-way match (PiMatch.html, FlowP5). `/purchase/invoices/new` records one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const invoice = ref<InvoiceDetail | null>(null)
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plusDays = (iso: string, days: number) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateToIso(d)
}
const plain = (v: string) => formatQty(v).replace(/,/g, '')
const plainPrice = (v: string) => v.replace(/0{1,2}$/, '')

// ── Form (new and to-match invoices) ─────────────────────────────────────────
interface FormLine {
  poLineId: string
  itemCode: string
  itemName: string
  uomCode: string
  taxName: string
  taxRate: string
  billableQty: string
  orderedPrice: string
  billedQty: string
  billedUnitPrice: string
}
const form = reactive({ supplierInvoiceNo: '', invoiceDate: '', billedTax: '', supplierNote: '', lines: [] as FormLine[] })
const newFiles = ref<{ id: string; fileName: string }[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, files: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)

// New invoice: supplier → purchase order → lines
const supplier = ref<SupplierOption | null>(null)
const orders = ref<BillableOrder[]>([])
const poId = ref('')
const template = ref<InvoiceTemplate | null>(null)
const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items.filter((s) => !s.isWalkIn)

async function pickSupplier(s: SupplierOption | null) {
  supplier.value = s
  template.value = null
  poId.value = ''
  orders.value = s ? (await invoicesApi.billableOrders(s.code)).items : []
  if (orders.value.length === 1) poId.value = orders.value[0]!.id
}
watch(poId, async (value) => {
  if (!value) return
  template.value = await invoicesApi.template(value)
  const t = template.value
  form.supplierInvoiceNo = form.supplierInvoiceNo || ''
  form.invoiceDate = form.invoiceDate || t.invoiceDate
  form.lines = t.lines.map((l) => ({
    poLineId: l.poLineId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    uomCode: l.uomCode,
    taxName: l.taxName,
    taxRate: l.taxRate,
    billableQty: l.billableQty,
    orderedPrice: l.orderedPrice,
    billedQty: plain(l.billableQty),
    billedUnitPrice: plainPrice(l.orderedPrice),
  }))
})

function fillFromInvoice(i: InvoiceDetail) {
  form.supplierInvoiceNo = i.supplierInvoiceNo
  form.invoiceDate = i.invoiceDate
  form.billedTax = i.columns.billed.taxLines.length === 1 ? i.billedTax : ''
  form.supplierNote = i.supplierNote ?? ''
  form.lines = i.lines.map((l) => ({
    poLineId: l.poLineId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    uomCode: l.uomCode,
    taxName: l.taxName,
    taxRate: l.taxRate,
    billableQty: l.receivedQty,
    orderedPrice: l.orderedPrice,
    billedQty: plain(l.billedQty),
    billedUnitPrice: plainPrice(l.billedUnitPrice),
  }))
  newFiles.value = []
  saved.value = snapshot()
}

function show(i: InvoiceDetail) {
  invoice.value = i
  fillFromInvoice(i)
  setCrumb(i.docNo)
  errors.value = {}
  choice.value = i.decision === 'HOLD' ? 'hold' : i.decision === 'ACCEPT_AS_BILLED' ? 'acceptAsBilled' : 'record'
  message.value = i.messageToSupplier ?? (choice.value === 'hold' ? i.messages.hold : i.messages.record)
}

async function load() {
  loading.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      invoice.value = null
      form.supplierInvoiceNo = ''
      form.invoiceDate = today.value
      form.billedTax = ''
      form.supplierNote = ''
      form.lines = []
      setCrumb('Record supplier invoice')
      const po = typeof route.query.po === 'string' ? route.query.po : ''
      if (po) {
        const t = await invoicesApi.template(po)
        supplier.value = { code: t.supplier.code, name: t.supplier.name, shortName: t.supplier.shortName, email: null, paymentTermDays: t.po.paymentTermDays, currency: 'MYR', isWalkIn: false }
        orders.value = (await invoicesApi.billableOrders(t.supplier.code)).items
        poId.value = po
      }
    } else {
      show(await invoicesApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())

const can = (action: InvoiceAction) => (isNew.value ? action === 'edit' : Boolean(invoice.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))
const paymentTermDays = computed(() => invoice.value?.paymentTermDays ?? template.value?.po.paymentTermDays ?? supplier.value?.paymentTermDays ?? 0)
const dueDate = computed(() => plusDays(form.invoiceDate, paymentTermDays.value))

// Billed amounts preview while typing (the server's match is the truth once saved).
const previews = computed(() => form.lines.map((l) => previewLine(l.billedQty || '0', l.billedUnitPrice || '0', l.taxRate)))
const previewSubtotal = computed(() => sumMoney(previews.value.map((p) => p?.amount ?? '0')))
const previewTax = computed(() => sumMoney(previews.value.map((p) => p?.taxAmount ?? '0')))

// ── Files ────────────────────────────────────────────────────────────────────
const uploading = ref(false)
async function addFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const uploaded = await attachmentsApi.upload(file, 'SUPPLIER_INVOICE')
    newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName })
  } finally {
    uploading.value = false
  }
}
const files = computed(() => [
  ...(invoice.value?.attachments ?? []),
  ...newFiles.value.map((f) => ({ ...f, mimeType: 'application/pdf', downloadUrl: `/attachments/${f.id}/download` })),
])

// ── Save ─────────────────────────────────────────────────────────────────────
function body() {
  return {
    supplierInvoiceNo: form.supplierInvoiceNo.trim(),
    invoiceDate: form.invoiceDate,
    billedTax: form.billedTax.trim() ? form.billedTax.trim() : null,
    supplierNote: form.supplierNote,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.map((l) => ({ poLineId: l.poLineId, billedQty: l.billedQty || '0', billedUnitPrice: l.billedUnitPrice || '0' })),
  }
}

function validate(): boolean {
  const e: Record<string, string> = {}
  if (isNew.value && !poId.value) e.poId = 'Pick the purchase order this invoice is for.'
  if (!form.supplierInvoiceNo.trim()) e.supplierInvoiceNo = "Enter the supplier's invoice number."
  if (!form.invoiceDate) e.invoiceDate = 'Enter the invoice date.'
  form.lines.forEach((l, i) => {
    if (!isQty(l.billedQty)) e[`lines[${i}].billedQty`] = 'Enter a quantity.'
    if (!isQty(l.billedUnitPrice)) e[`lines[${i}].billedUnitPrice`] = 'Enter a price.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(quiet = false): Promise<InvoiceDetail | null> {
  if (!validate()) return null
  busy.value = true
  try {
    const result = isNew.value
      ? await invoicesApi.create({ ...body(), poId: poId.value, supplierInvoiceNo: form.supplierInvoiceNo.trim(), invoiceDate: form.invoiceDate })
      : await invoicesApi.update(invoice.value!.id, { ...body(), version: invoice.value!.version })
    if (!quiet) {
      toast.add({
        severity: 'success',
        summary: isNew.value ? `${result.docNo} recorded` : 'Saved',
        detail: result.match.matched ? 'All three agree.' : `Match: ${result.match.summary}.`,
        life: 3500,
      })
    }
    if (isNew.value) await router.replace(`/purchase/invoices/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
    return null
  } finally {
    busy.value = false
  }
}

// ── Decide ───────────────────────────────────────────────────────────────────
const choice = ref<InvoiceChoice>('record')
const message = ref('')
const approverNote = ref('')
watch(choice, (c) => {
  const i = invoice.value
  if (i && !i.messageToSupplier) message.value = c === 'hold' ? i.messages.hold : i.messages.record
})

const matched = computed(() => Boolean(invoice.value?.match.matched))
const weRecord = computed(() => {
  const i = invoice.value
  if (!i) return '0.00'
  if (i.status !== 'TO_MATCH') return i.totals.recorded
  if (matched.value || choice.value === 'acceptAsBilled') return i.totals.matched
  return i.totals.record
})
const primaryLabel = computed(() => {
  if (matched.value || choice.value === 'record') return `Record ${formatRm(weRecord.value)}`
  return choice.value === 'hold' ? 'Hold invoice' : 'Send for approval'
})

async function decide(action: InvoiceChoice) {
  const current = invoice.value
  if (!current) return
  if (dirty.value) {
    toast.add({ severity: 'info', summary: 'Save the changes first', detail: 'The match runs again on the corrected figures.', life: 3500 })
    return
  }
  busy.value = true
  try {
    const result = await invoicesApi.decide(current.id, {
      version: current.version,
      action,
      message: action === 'acceptAsBilled' ? undefined : message.value.trim() || undefined,
      note: action === 'acceptAsBilled' ? approverNote.value.trim() || undefined : undefined,
    })
    show(result)
    if (action === 'acceptAsBilled') notifyApprovalsChanged()
    toast.add({
      severity: 'success',
      summary: action === 'hold' ? `${result.docNo} on hold` : action === 'acceptAsBilled' ? `${result.docNo} sent for approval` : `${result.docNo} recorded`,
      detail:
        action === 'acceptAsBilled'
          ? `${result.waitingFor ?? 'The Purchasing Manager'} gets an email and an item in Approvals.`
          : action === 'hold'
            ? 'The supplier is asked for a corrected invoice or a credit note.'
            : `${formatRm(result.totals.recorded)} is queued for Finance as a payable.`,
      life: 4500,
    })
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    busy.value = false
  }
}
const primary = () => decide(matched.value ? 'record' : choice.value)

function deleteInvoice() {
  const i = invoice.value
  if (!i) return
  confirmDialog.require({
    header: `Delete ${i.docNo}?`,
    message: `The invoice is removed. Its number ${i.docNo} is not used again.`,
    acceptLabel: 'Delete invoice',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await invoicesApi.remove(i.id, i.version)
      toast.add({ severity: 'success', summary: `${i.docNo} deleted`, life: 3000 })
      await router.push('/purchase/invoices')
    },
  })
}

// ── Display helpers ──────────────────────────────────────────────────────────
const title = computed(() => (invoice.value ? `Purchase invoice ${invoice.value.docNo} · match` : 'Record supplier invoice'))
const linkTo = (type: string, docId: string | null, no: string) => (isLegacyNo(no) ? null : docRoute(type, docId))
const single = computed(() => (invoice.value?.lines.length === 1 ? invoice.value.lines[0]! : null))
type DetailLine = InvoiceDetail['lines'][number]
const qtyResult = (l: DetailLine) => {
  if (!l.match.qtyOk) return { text: `✗ ${formatQty(l.match.qtyOver)} billed, not received`, ok: false }
  return { text: compareQty(l.billedQty, l.receivedQty) === 0 ? '✓ Same' : '✓ Not more than received', ok: true }
}
const priceResult = (l: DetailLine) => {
  const pct = Number(l.match.pricePct)
  if (!l.match.priceOk) return { text: `✗ ${pct > 0 ? '+' : ''}${l.match.pricePct}%`, ok: false }
  return { text: pct === 0 ? '✓ Same' : `✓ ${pct > 0 ? '+' : ''}${l.match.pricePct}% within tolerance`, ok: true }
}
const totalResult = computed(() => {
  const i = invoice.value
  if (!i) return { text: '', tone: '' }
  const diff = subQty(i.columns.billed.total, i.columns.received.total)
  const c = compareQty(diff, '0')
  if (c > 0) return { text: `${formatRm(diff)} too much`, tone: 'text-note-error-text' }
  if (c < 0) return { text: `${formatRm(subQty('0', diff))} less than received`, tone: 'text-erp-muted' }
  return { text: '✓ Same', tone: 'text-chip-done-text' }
})
const billedBad = (field: 'subtotal' | 'total') => {
  const i = invoice.value
  return Boolean(i && compareQty(i.columns.billed[field], i.columns.received[field]) > 0)
}
const worstPrice = computed(() => {
  const lines = invoice.value?.lines ?? []
  return lines.reduce<DetailLine | null>((w, l) => (!w || Math.abs(Number(l.match.pricePct)) > Math.abs(Number(w.match.pricePct)) ? l : w), null)
})
const totalOver = computed(() => sumQty((invoice.value?.lines ?? []).map((l) => (compareQty(l.match.qtyOver, '0') > 0 ? l.match.qtyOver : '0'))))
const difference = computed(() => (invoice.value ? subQty(invoice.value.totals.billed, weRecord.value) : '0'))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <!-- ── Record a new supplier invoice ──────────────────────────────────── -->
  <template v-else-if="isNew">
    <PageHeader title="Record supplier invoice" document>
      <template #chip><StatusChip status="DRAFT" label="New" /></template>
      <template #subtitle>Pick the supplier and the purchase order, then type what their invoice says. The three-way match runs when you record it.</template>
      <template #actions>
        <RouterLink to="/purchase/invoices" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="busy || !template" @click="save()">Record invoice</button>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-4">
          <FormField :label="supplier ? `Supplier · ${supplier.code}` : 'Supplier'" for="inv-supplier">
            <MasterDataPicker :model-value="supplier" input-id="inv-supplier" :search="searchSuppliers" placeholder="Type a supplier code or name" @picked="pickSupplier" />
          </FormField>
          <FormField label="Their invoice no" :error="errors.supplierInvoiceNo" for="their-no">
            <input id="their-no" v-model="form.supplierInvoiceNo" class="erp-input" maxlength="50" :aria-invalid="Boolean(errors.supplierInvoiceNo)" />
          </FormField>
          <FormField label="Invoice date" :error="errors.invoiceDate" for="inv-date">
            <DatePicker
              input-id="inv-date"
              :model-value="isoToDate(form.invoiceDate)"
              :max-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              fluid
              class="erp-date"
              @update:model-value="form.invoiceDate = dateToIso($event)"
            />
          </FormField>
          <FormField :label="supplier ? `Due date · ${paymentTermDays} days` : 'Due date'">
            <div class="erp-input-ro">{{ supplier ? formatDate(dueDate) : '—' }}</div>
          </FormField>
          <FormField label="Purchase order" class="col-span-2" :error="errors.poId" for="inv-po">
            <select id="inv-po" v-model="poId" class="erp-input" :disabled="!supplier">
              <option value="">{{ !supplier ? 'Pick the supplier first' : orders.length ? 'Pick the purchase order' : 'Nothing received and not yet billed' }}</option>
              <option v-for="o in orders" :key="o.id" :value="o.id">{{ o.docNo }} · {{ formatDate(o.docDate) }} · {{ o.billableText }}</option>
            </select>
          </FormField>
          <FormField label="Supplier's note" class="col-span-2" for="inv-note">
            <input id="inv-note" v-model="form.supplierNote" class="erp-input" maxlength="500" placeholder="e.g. Freight to Shah Alam added" />
          </FormField>
        </section>

        <section v-if="template" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">What they billed</h2>
            <span class="text-xs text-erp-muted">Received and not yet billed on {{ template.po.docNo }}<template v-if="template.grns.length"> ({{ template.grns.map((g) => g.docNo).join(', ') }})</template></span>
          </div>
          <table class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="num">Received, not billed</th>
                <th class="num">PO price</th>
                <th class="num">Billed qty</th>
                <th class="num">Billed unit price</th>
                <th>Tax</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="l.poLineId">
                <td>
                  <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                  <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
                </td>
                <td class="num">{{ formatQty(l.billableQty) }} {{ l.uomCode }}</td>
                <td class="num">{{ formatPrice(l.orderedPrice) }}</td>
                <td class="num">
                  <input v-model="l.billedQty" class="erp-cell w-[80px]" inputmode="decimal" :aria-label="`Billed quantity ${l.itemCode}`" :aria-invalid="Boolean(errors[`lines[${i}].billedQty`])" />
                </td>
                <td class="num">
                  <input v-model="l.billedUnitPrice" class="erp-cell w-[96px]" inputmode="decimal" :aria-label="`Billed unit price ${l.itemCode}`" :aria-invalid="Boolean(errors[`lines[${i}].billedUnitPrice`])" />
                </td>
                <td class="whitespace-nowrap">{{ l.taxName }}</td>
                <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
              </tr>
            </tbody>
          </table>
          <div class="flex items-end justify-between gap-4">
            <FormField label="Tax on their invoice (RM)" class="w-[220px]" :error="errors.billedTax" for="their-tax">
              <input id="their-tax" v-model="form.billedTax" class="erp-input" inputmode="decimal" :placeholder="formatMoney(previewTax)" />
            </FormField>
            <div class="text-right text-[13px]">
              Billed before tax <strong class="erp-num">{{ formatRm(previewSubtotal) }}</strong>
              <div class="text-xs text-erp-muted">Leave the tax empty when it is {{ formatRm(previewTax) }}, as worked out from the tax rates.</div>
            </div>
          </div>
        </section>
      </div>

      <aside class="flex flex-col gap-3.5">
        <SideCard title="Their invoice">
          <div class="flex flex-col gap-2">
            <button v-for="f in files" :key="f.id" type="button" class="erp-link flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[13px] text-erp-link" @click="openFile(f.downloadUrl)">
              <FileText :size="16" aria-hidden="true" />{{ f.fileName }}
            </button>
            <label class="erp-btn erp-btn-secondary w-fit cursor-pointer">
              {{ uploading ? 'Uploading…' : '+ Attach PDF' }}
              <input type="file" accept="application/pdf,image/*" class="hidden" :disabled="uploading" @change="addFile" />
            </label>
          </div>
        </SideCard>
        <SideCard title="How it is matched">
          <p class="m-0 text-[13px] leading-normal">
            Billing is matched against what was <strong>received</strong>, never against what was ordered. Price ± 2%, quantity 0 over received and tax ± RM 1.00
            pass on their own.
          </p>
        </SideCard>
      </aside>
    </div>
  </template>

  <!-- ── Three-way match ─────────────────────────────────────────────────── -->
  <template v-else-if="invoice">
    <PageHeader :title="title" document>
      <template #chip><StatusChip :status="invoice.status" :group="invoice.statusGroup" :label="invoice.statusLabel" /></template>
      <template #subtitle>
        {{ invoice.supplier.name }} · their invoice {{ invoice.supplierInvoiceNo }} · against
        <RouterLink v-if="linkTo('PUR_ORDER', invoice.po.id, invoice.po.docNo)" :to="linkTo('PUR_ORDER', invoice.po.id, invoice.po.docNo)!" class="erp-link">{{ invoice.po.docNo }}</RouterLink>
        <template v-else>{{ invoice.po.docNo }}</template>
        <template v-for="(g, gi) in invoice.grns" :key="g.id">
          {{ gi === 0 ? ' and ' : ', ' }}
          <RouterLink v-if="linkTo('PUR_RECEIPT', g.id, g.docNo)" :to="linkTo('PUR_RECEIPT', g.id, g.docNo)!" class="erp-link">{{ g.docNo }}</RouterLink>
          <template v-else>{{ g.docNo }}</template>
        </template>
      </template>
      <template #actions>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteInvoice">Delete</button>
          <button v-if="can('hold') && choice !== 'hold'" type="button" class="erp-btn erp-btn-secondary" :disabled="busy || dirty" @click="decide('hold')">Hold invoice</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || !dirty" @click="save()">Save draft</button>
          <button v-if="can('record')" type="button" class="erp-btn erp-btn-primary" :disabled="busy || dirty" :title="dirty ? 'Save first so the match runs again' : ''" @click="primary">
            {{ primaryLabel }}
          </button>
        </template>
        <RouterLink v-else to="/purchase/invoices" class="erp-btn erp-btn-secondary">Back</RouterLink>
      </template>
    </PageHeader>

    <NoticeBanner v-if="invoice.status === 'PENDING_APPROVAL'" kind="warning">
      Waiting for <strong>{{ invoice.waitingFor ?? 'the Purchasing Manager' }}</strong> to approve recording it as billed ({{ formatRm(invoice.totals.recorded) }}).
    </NoticeBanner>
    <NoticeBanner v-else-if="invoice.status === 'REJECTED'" kind="error">
      Rejected<template v-if="invoice.rejectReason">: “{{ invoice.rejectReason }}”</template>. Record the supplier's corrected invoice when it arrives.
    </NoticeBanner>
    <NoticeBanner v-else-if="invoice.status === 'APPROVED' && !invoice.financeConnected" kind="warning">
      <strong>Finance is not connected yet.</strong> This invoice is kept as a payable and posted automatically when the Finance module is plugged in.
    </NoticeBanner>
    <NoticeBanner v-else-if="invoice.decision === 'HOLD' && invoice.status === 'TO_MATCH'" kind="warning">
      On hold: the supplier was asked for a corrected invoice or a credit note. Correct the billed figures when it arrives, then record it.
    </NoticeBanner>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-4">
          <FormField :label="`Supplier · ${invoice.supplier.code}`">
            <div class="erp-input-ro">{{ invoice.supplier.name }}</div>
          </FormField>
          <FormField label="Their invoice no" :error="errors.supplierInvoiceNo" for="their-no">
            <input v-if="editable" id="their-no" v-model="form.supplierInvoiceNo" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ invoice.supplierInvoiceNo }}</div>
          </FormField>
          <FormField label="Invoice date" :error="errors.invoiceDate" for="inv-date">
            <DatePicker
              v-if="editable"
              input-id="inv-date"
              :model-value="isoToDate(form.invoiceDate)"
              :max-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              fluid
              class="erp-date"
              @update:model-value="form.invoiceDate = dateToIso($event)"
            />
            <div v-else class="erp-input-ro">{{ formatDate(invoice.invoiceDate) }}</div>
          </FormField>
          <FormField :label="`Due date · ${invoice.paymentTermDays} days`">
            <div class="erp-input-ro">{{ formatDate(editable ? dueDate : invoice.dueDate) }}</div>
          </FormField>
        </section>

        <!-- Three-way match -->
        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Three-way match</h2>
            <span class="text-xs text-erp-muted">
              {{ dirty ? 'Save to run the match again' : `Filled in automatically from ${invoice.po.docNo}${invoice.grns.length ? ` and ${invoice.grns.map((g) => g.docNo).join(', ')}` : ''}` }}
            </span>
          </div>
          <div class="erp-match">
            <div class="h" />
            <div class="h">Ordered<br /><span class="font-medium normal-case">{{ invoice.po.docNo }}</span></div>
            <div class="h">Received<br /><span class="font-medium normal-case">{{ invoice.grns.map((g) => g.docNo).join(', ') || '—' }}</span></div>
            <div class="h">Billed<br /><span class="font-medium normal-case">{{ invoice.supplierInvoiceNo }}</span></div>
            <div class="h">Result</div>

            <template v-for="(l, i) in invoice.lines" :key="l.id">
              <div class="l">Quantity<template v-if="!single"> · {{ l.itemCode }}</template></div>
              <div>{{ qtyWithUnit(l.orderedQty, l.uomCode) }}</div>
              <div>{{ qtyWithUnit(l.receivedQty, l.uomCode) }}</div>
              <div :class="{ bad: !l.match.qtyOk }">
                <input v-if="editable" v-model="form.lines[i]!.billedQty" class="erp-cell w-[80px]" inputmode="decimal" :aria-label="`Billed quantity ${l.itemCode}`" />
                <strong v-else-if="!l.match.qtyOk" class="text-note-error-text">{{ qtyWithUnit(l.billedQty, l.uomCode) }}</strong>
                <template v-else>{{ qtyWithUnit(l.billedQty, l.uomCode) }}</template>
              </div>
              <div><span class="font-semibold whitespace-nowrap" :class="qtyResult(l).ok ? 'text-chip-done-text' : 'text-note-error-text'">{{ qtyResult(l).text }}</span></div>

              <div class="l">Unit price<template v-if="!single"> · {{ l.itemCode }}</template></div>
              <div>{{ formatPrice(l.orderedPrice) }}</div>
              <div class="text-erp-muted">—</div>
              <div :class="{ bad: !l.match.priceOk }">
                <input v-if="editable" v-model="form.lines[i]!.billedUnitPrice" class="erp-cell w-[96px]" inputmode="decimal" :aria-label="`Billed unit price ${l.itemCode}`" />
                <strong v-else-if="!l.match.priceOk" class="text-note-error-text">{{ formatPrice(l.billedUnitPrice) }}</strong>
                <template v-else>{{ formatPrice(l.billedUnitPrice) }}</template>
              </div>
              <div><span class="font-semibold whitespace-nowrap" :class="priceResult(l).ok ? 'text-chip-done-text' : 'text-note-error-text'">{{ priceResult(l).text }}</span></div>
            </template>

            <div class="l">Before tax</div>
            <div>{{ formatMoney(invoice.columns.ordered.subtotal) }}</div>
            <div>{{ formatMoney(invoice.columns.received.subtotal) }}</div>
            <div :class="{ bad: billedBad('subtotal') }">
              <strong v-if="billedBad('subtotal')" class="text-note-error-text">{{ formatMoney(invoice.columns.billed.subtotal) }}</strong>
              <template v-else>{{ formatMoney(invoice.columns.billed.subtotal) }}</template>
            </div>
            <div />

            <template v-for="(t, ti) in invoice.columns.ordered.taxLines" :key="t.code">
              <div class="l">{{ t.name }}</div>
              <div>{{ formatMoney(t.amount) }}</div>
              <div>{{ formatMoney(invoice.columns.received.taxLines[ti]?.amount ?? '0') }}</div>
              <div :class="{ bad: !invoice.match.taxOk }">
                <input
                  v-if="editable && invoice.columns.ordered.taxLines.length === 1"
                  v-model="form.billedTax"
                  class="erp-cell w-[96px]"
                  inputmode="decimal"
                  :aria-label="`Tax on their invoice`"
                />
                <template v-else>{{ formatMoney(invoice.columns.billed.taxLines[ti]?.amount ?? '0') }}</template>
              </div>
              <div>
                <span v-if="!invoice.match.taxOk" class="font-semibold whitespace-nowrap text-note-error-text">✗ {{ formatRm(invoice.match.taxDiff.replace('-', '')) }} off</span>
              </div>
            </template>

            <div class="l border-b-0">Total</div>
            <div class="border-b-0"><strong>{{ formatMoney(invoice.columns.ordered.total) }}</strong></div>
            <div class="border-b-0"><strong>{{ formatMoney(invoice.columns.received.total) }}</strong></div>
            <div class="border-b-0" :class="{ bad: billedBad('total') }">
              <strong :class="{ 'text-note-error-text': billedBad('total') }">{{ formatMoney(invoice.columns.billed.total) }}</strong>
            </div>
            <div class="border-b-0"><span class="font-semibold whitespace-nowrap" :class="totalResult.tone">{{ totalResult.text }}</span></div>
          </div>
          <p v-if="invoice.supplierNote" class="m-0 text-xs text-erp-muted">Supplier's note: “{{ invoice.supplierNote }}”</p>
        </section>

        <!-- Decision -->
        <NoticeBanner v-if="editable && matched" kind="info">
          <strong>All three agree.</strong> Recording it queues the payable for Finance; nothing needs approval.
        </NoticeBanner>
        <section v-else-if="editable" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">What should we record?</h2>
          <label class="erp-opt" :class="{ on: choice === 'record' }">
            <input v-model="choice" type="radio" value="record" />
            <span><strong>{{ invoice.options.record.label }}</strong><br /><span class="text-erp-muted">{{ invoice.options.record.description }}</span></span>
          </label>
          <label class="erp-opt" :class="{ on: choice === 'hold' }">
            <input v-model="choice" type="radio" value="hold" />
            <span><strong>Hold the invoice</strong><br /><span class="text-erp-muted">Ask the supplier for a corrected invoice or a credit note first.</span></span>
          </label>
          <label class="erp-opt" :class="{ on: choice === 'acceptAsBilled' }">
            <input v-model="choice" type="radio" value="acceptAsBilled" />
            <span>
              <strong>Accept as billed · {{ formatRm(invoice.totals.matched) }}</strong><br />
              <span class="text-erp-muted">Outside tolerance, so it goes to the Purchasing Manager for approval.</span>
            </span>
          </label>
        </section>

        <section v-if="editable && !matched && choice !== 'acceptAsBilled'" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Message to supplier</h2>
            <span class="text-xs text-erp-muted">Template: Invoice difference</span>
          </div>
          <textarea v-model="message" class="erp-input min-h-[70px] resize-none py-2.5 leading-normal" aria-label="Message to supplier" maxlength="2000" />
        </section>
        <section v-else-if="editable && !matched" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Note to the Purchasing Manager</h2>
          <p class="m-0 text-xs text-erp-muted">Why approval is needed: {{ invoice.options.approvalReason }}</p>
          <textarea v-model="approverNote" class="erp-input min-h-[70px] resize-none py-2.5 leading-normal" aria-label="Note to the Purchasing Manager" maxlength="1000" placeholder="Why we should pay as billed" />
        </section>

        <!-- Decided -->
        <section v-if="!editable && (invoice.messageToSupplier || invoice.decisionNote)" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <template v-if="invoice.messageToSupplier">
            <div class="flex items-center justify-between">
              <h2 class="m-0 text-[15px] font-bold">Message to supplier</h2>
              <span class="text-xs text-erp-muted">Sent · Template: Invoice difference</span>
            </div>
            <p class="m-0 text-[13px] leading-normal whitespace-pre-line">{{ invoice.messageToSupplier }}</p>
          </template>
          <template v-if="invoice.decisionNote">
            <h2 class="m-0 text-[15px] font-bold">Note to the approver</h2>
            <p class="m-0 text-[13px] leading-normal">{{ invoice.decisionNote }}</p>
          </template>
        </section>

        <ActivityList :items="invoice.activity" />
      </div>

      <!-- Right panel -->
      <aside class="flex flex-col gap-3.5">
        <SideCard title="Their invoice">
          <div class="flex h-[150px] flex-col gap-[7px] rounded-lg border border-erp-border bg-erp-head p-3.5" aria-hidden="true">
            <div class="flex justify-between"><div class="h-2.5 w-[90px] rounded-sm bg-erp-input" /><div class="h-2.5 w-[60px] rounded-sm bg-mod-line opacity-50" /></div>
            <div class="h-[7px] w-[70%] rounded-sm bg-erp-track" />
            <div class="h-[7px] w-[55%] rounded-sm bg-erp-track" />
            <div class="h-[7px] w-[80%] rounded-sm bg-erp-track" />
            <div class="h-[7px] w-[40%] rounded-sm bg-erp-track" />
            <div class="grow" />
            <div class="flex justify-end"><div class="h-2.5 w-[70px] rounded-sm bg-erp-text opacity-35" /></div>
          </div>
          <div class="flex flex-col gap-1.5 text-xs">
            <div v-for="f in files" :key="f.id" class="flex justify-between gap-2">
              <button type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-xs text-erp-link" @click="openFile(f.downloadUrl)">{{ f.fileName }}</button>
              <span v-if="invoice.eInvoiceStatus === 'VALIDATED'" class="text-erp-muted">LHDN e-Invoice · validated</span>
            </div>
            <p v-if="!files.length" class="m-0 text-erp-muted">No PDF attached.</p>
            <label v-if="editable" class="erp-link w-fit cursor-pointer text-erp-link">
              {{ uploading ? 'Uploading…' : '+ Attach their PDF' }}
              <input type="file" accept="application/pdf,image/*" class="hidden" :disabled="uploading" @change="addFile" />
            </label>
          </div>
        </SideCard>

        <SideCard title="Tolerance · from Approval Rules">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
              <span>Price ± {{ invoice.match.tolerance.pricePct }}%</span>
              <span v-if="worstPrice" class="font-semibold whitespace-nowrap" :class="worstPrice.match.priceOk ? 'text-chip-done-text' : 'text-note-error-text'">
                {{ worstPrice.match.priceOk ? '✓' : '✗' }} {{ Number(worstPrice.match.pricePct) > 0 ? '+' : '' }}{{ worstPrice.match.pricePct }}%
              </span>
            </div>
            <div class="flex justify-between gap-3 py-[7px]" :class="{ 'border-b border-erp-row': !invoice.match.taxOk || invoice.match.taxDiff !== '0.00' }">
              <span>Quantity · {{ invoice.match.tolerance.qtyOver }} over received</span>
              <span class="font-semibold whitespace-nowrap" :class="compareQty(totalOver, '0') > 0 ? 'text-note-error-text' : 'text-chip-done-text'">
                {{ compareQty(totalOver, '0') > 0 ? `✗ ${formatQty(totalOver)} over` : '✓ none over' }}
              </span>
            </div>
            <div v-if="!invoice.match.taxOk || invoice.match.taxDiff !== '0.00'" class="flex justify-between gap-3 py-[7px]">
              <span>Tax ± {{ formatRm(invoice.match.tolerance.taxAmount) }}</span>
              <span class="font-semibold whitespace-nowrap" :class="invoice.match.taxOk ? 'text-chip-done-text' : 'text-note-error-text'">
                {{ invoice.match.taxOk ? '✓' : '✗' }} {{ formatRm(invoice.match.taxDiff.replace('-', '')) }}
              </span>
            </div>
          </div>
        </SideCard>

        <SideCard title="What we record">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Supplier billed</span><span>{{ formatMoney(invoice.totals.billed) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>We record</span><strong>{{ formatMoney(weRecord) }}</strong></div>
            <div class="flex justify-between gap-3 py-[7px]">
              <span>Difference</span>
              <span :class="compareQty(difference, '0') !== 0 ? 'font-semibold text-note-error-text' : ''">{{ formatMoney(difference) }}</span>
            </div>
          </div>
          <p class="m-0 text-xs leading-normal text-erp-muted">
            <template v-if="invoice.status === 'APPROVED' || invoice.status === 'PAID'">
              Recorded<template v-if="invoice.approvedAt"> on {{ formatDateTime(invoice.approvedAt) }}</template><template v-if="invoice.approvedByName"> by {{ invoice.approvedByName }}</template>. The payable is
              {{ invoice.financeConnected ? 'with Finance' : 'queued for Finance' }}.
            </template>
            <template v-else-if="matched">The payable is queued for Finance as soon as you record it.</template>
            <template v-else>The payable is queued for Finance. Supplier is emailed about the difference.</template>
          </p>
        </SideCard>

        <LinkedDocs
          v-if="!editable && invoice.links.length"
          :docs="invoice.links"
          :route-of="(type, docId) => (invoice?.links.find((d) => d.id === docId && isLegacyNo(d.docNo)) ? null : docRoute(type, docId))"
        />
      </aside>
    </div>
  </template>
</template>
