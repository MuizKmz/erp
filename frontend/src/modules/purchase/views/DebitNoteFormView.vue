<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
import FormField from '@/components/erp/FormField.vue'
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
import { isPositiveDecimal, previewLine, sumMoney } from '@/utils/money'
import { attachmentsApi, debitNotesApi, lookupsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { DebitCheck, DebitNoteAction, DebitNoteDetail, ItemOption, SupplierOption } from '../types'

/** P21 · Supplier debit note (PurDebitNote.html, FlowP6 steps 9–12). `/purchase/debit-notes/new` records one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const row = ref<DebitNoteDetail | null>(null)
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})

// ── Form ─────────────────────────────────────────────────────────────────────
type LineItem = Pick<ItemOption, 'code' | 'name' | 'uomCode' | 'taxName' | 'taxRate'>
interface FormLine {
  key: number
  item: LineItem | null
  qty: string
  unitPrice: string
}
let nextKey = 1
const form = reactive({ invoiceId: '', theirNoteNo: '', docDate: '', reason: '', remarks: '', lines: [] as FormLine[] })
const supplier = ref<SupplierOption | null>(null)
const invoices = ref<{ id: string; docNo: string; supplierInvoiceNo: string; docDate: string; total: string; statusLabel: string }[]>([])
const newFiles = ref<{ id: string; fileName: string; mimeType: string }[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => ({ c: l.item?.code ?? null, q: l.qty, p: l.unitPrice })), files: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)
const REASONS = ['Charge not on the PO', 'Freight surcharge', 'Price increase agreed', 'Extra work agreed', 'Other']

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plusDays = (iso: string, days: number) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateToIso(d)
}

function show(r: DebitNoteDetail) {
  row.value = r
  form.invoiceId = r.invoice.id ?? ''
  form.theirNoteNo = r.theirNoteNo
  form.docDate = r.docDate
  form.reason = r.reason
  form.remarks = r.remarks ?? ''
  form.lines = r.lines.map((l) => ({
    key: nextKey++,
    item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, taxName: l.taxName, taxRate: l.taxRate },
    qty: formatQty(l.qty).replace(/,/g, ''),
    unitPrice: l.unitPrice.replace(/0{1,2}$/, ''),
  }))
  newFiles.value = []
  check.value = r.check
  saved.value = snapshot()
  setCrumb(r.docNo)
  errors.value = {}
}

async function load() {
  loading.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      row.value = null
      Object.assign(form, { invoiceId: '', theirNoteNo: '', docDate: today.value, reason: REASONS[0], remarks: '' })
      form.lines = [{ key: nextKey++, item: null, qty: '1', unitPrice: '' }]
      check.value = null
      setCrumb('Record debit note')
    } else {
      show(await debitNotesApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())

const can = (action: DebitNoteAction) => (isNew.value ? action === 'edit' : Boolean(row.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))
const reasons = computed(() => row.value?.reasons ?? REASONS)

async function pickSupplier(s: SupplierOption) {
  supplier.value = s
  form.invoiceId = ''
  invoices.value = (await debitNotesApi.invoices(s.code)).items
  if (invoices.value.length === 1) form.invoiceId = invoices.value[0]!.id
}
const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items.filter((s) => !s.isWalkIn)
const searchItems = async (q: string) => (await lookupsApi.items(q)).items
const pickerValue = (l: FormLine) => l.item as ItemOption | null

// ── Values and the live check against the PO ─────────────────────────────────
const previews = computed(() => form.lines.map((l) => (l.item ? previewLine(l.qty || '0', l.unitPrice || '0', l.item.taxRate) : null)))
const charges = computed(() => sumMoney(previews.value.map((p) => p?.amount ?? '0')))
const taxLines = computed(() => {
  const map = new Map<string, string[]>()
  form.lines.forEach((l, i) => l.item && map.set(l.item.taxName, [...(map.get(l.item.taxName) ?? []), previews.value[i]?.taxAmount ?? '0']))
  return [...map].map(([name, amounts]) => ({ name, amount: sumMoney(amounts) }))
})
const total = computed(() => (editable.value ? sumMoney([charges.value, ...taxLines.value.map((t) => t.amount)]) : (row.value?.total ?? '0')))

const check = ref<DebitCheck | null>(null)
let checkTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [form.invoiceId, form.lines.map((l) => l.item?.code ?? '').join(','), total.value] as const,
  () => {
    if (!editable.value) return
    clearTimeout(checkTimer)
    checkTimer = setTimeout(async () => {
      if (!form.invoiceId) {
        check.value = null
        return
      }
      try {
        check.value = await debitNotesApi.check(form.invoiceId, form.lines.filter((l) => l.item).map((l) => l.item!.code), total.value)
      } catch {
        /* keep the last check; the server checks again when the note is saved */
      }
    }, 300)
  },
)
const onPo = computed(() => (check.value ? check.value.onPo : Boolean(row.value?.chargeOnPo)))
const dueDate = computed(() => (editable.value && check.value ? plusDays(form.docDate, check.value.paymentTermDays) : (row.value?.dueDate ?? '')))

// ── Files ────────────────────────────────────────────────────────────────────
const files = computed(() => [...(row.value?.attachments ?? []), ...newFiles.value.map((f) => ({ ...f, downloadUrl: `/attachments/${f.id}/download` }))])
async function upload(file: File) {
  const uploaded = await attachmentsApi.upload(file, 'SUPPLIER_DOCUMENT')
  newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName, mimeType: file.type })
}

// ── Save, submit, release ────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (isNew.value && !form.invoiceId) e.invoiceId = 'Pick the supplier invoice this adds to.'
  if (!form.theirNoteNo.trim()) e.theirNoteNo = "Enter the supplier's debit note number."
  if (!form.lines.some((l) => l.item)) e.lines = 'Add at least one charge.'
  form.lines.forEach((l, i) => {
    if (l.item && !isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (l.item && !isPositiveDecimal(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}
function body() {
  return {
    theirNoteNo: form.theirNoteNo.trim(),
    reason: form.reason,
    docDate: form.docDate,
    remarks: form.remarks,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.filter((l) => l.item).map((l) => ({ itemCode: l.item!.code, qty: l.qty, unitPrice: l.unitPrice })),
  }
}
async function save(quiet = false): Promise<DebitNoteDetail | null> {
  if (!validate()) return null
  busy.value = true
  try {
    const result = isNew.value
      ? await debitNotesApi.create({ ...body(), invoiceId: form.invoiceId, theirNoteNo: form.theirNoteNo.trim(), reason: form.reason })
      : await debitNotesApi.update(row.value!.id, { ...body(), version: row.value!.version })
    if (!quiet) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/debit-notes/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
    return null
  } finally {
    busy.value = false
  }
}

async function goAhead() {
  const current = isNew.value || dirty.value ? await save(true) : row.value
  if (!current) return
  const approval = !current.chargeOnPo
  confirmDialog.require({
    header: approval ? `Send ${current.docNo} for approval?` : `Release ${current.docNo}?`,
    message: approval
      ? `${current.check?.goesTo ?? 'The Purchasing Manager'} decides on ${formatRm(current.total)} added to ${current.invoice.docNo}.`
      : `${formatRm(current.total)} is added to ${current.invoice.docNo} and queued for Finance. The note is locked.`,
    acceptLabel: approval ? 'Send for approval' : 'Release',
    rejectLabel: 'Not yet',
    accept: async () => {
      busy.value = true
      try {
        const result = approval ? await debitNotesApi.submit(current.id, current.version) : await debitNotesApi.release(current.id, current.version)
        show(result)
        if (approval) notifyApprovalsChanged()
        toast.add({ severity: 'success', summary: approval ? `${result.docNo} sent for approval` : `${result.docNo} released`, life: 3500 })
      } finally {
        busy.value = false
      }
    },
  })
}

function deleteNote() {
  const r = row.value
  if (!r) return
  confirmDialog.require({
    header: `Delete ${r.docNo}?`,
    message: `The debit note is removed. Its number ${r.docNo} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await debitNotesApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/debit-notes')
    },
  })
}

// ── Display ──────────────────────────────────────────────────────────────────
const title = computed(() => (row.value ? `Supplier debit note ${row.value.docNo}` : 'Record supplier debit note'))
const CHIP = {
  DRAFT: { group: 'draft', label: 'Draft' },
  PENDING_APPROVAL: { group: 'pending', label: 'Pending approval' },
  RELEASED: { group: 'done', label: 'Released' },
  REJECTED: { group: 'cancelled', label: 'Rejected' },
} as const
const linkTo = (type: string, docId: string | null | undefined, no: string | null | undefined) => (docId && no && !isLegacyNo(no) ? docRoute(type, docId) : null)
const primaryLabel = computed(() => (onPo.value ? 'Release' : 'Send for approval'))
const supplierName = computed(() => row.value?.supplier.name ?? supplier.value?.name ?? null)
const supplierCode = computed(() => row.value?.supplier.code ?? supplier.value?.code ?? null)
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" document>
      <template #chip>
        <StatusChip v-if="row" :status="row.status" :group="CHIP[row.status].group" :label="CHIP[row.status].label" />
        <StatusChip v-else status="DRAFT" label="New" />
      </template>
      <template #subtitle>
        <template v-if="row">
          {{ row.supplier.name }} · extra charge on
          <RouterLink v-if="linkTo('PUR_INVOICE', row.invoice.id, row.invoice.docNo)" :to="linkTo('PUR_INVOICE', row.invoice.id, row.invoice.docNo)!" class="erp-link">{{ row.invoice.docNo }}</RouterLink>
          <template v-else>{{ row.invoice.docNo }}</template>
          <template v-if="row.invoice.supplierInvoiceNo"> ({{ row.invoice.supplierInvoiceNo }})</template>
        </template>
        <template v-else>Pick the supplier and the invoice the charge adds to, then type the charges from their note.</template>
      </template>
      <template #actions>
        <RouterLink to="/purchase/debit-notes" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteNote">Delete</button>
        <template v-if="editable">
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || (!isNew && !dirty)" @click="save()">Save draft</button>
          <button v-if="isNew || can('submit') || can('release')" type="button" class="erp-btn erp-btn-primary" :disabled="busy" @click="goAhead">{{ primaryLabel }}</button>
        </template>
      </template>
    </PageHeader>

    <NoticeBanner v-if="row?.status === 'PENDING_APPROVAL'" kind="warning">
      Waiting for <strong>{{ row.waitingFor ?? 'the Purchasing Manager' }}</strong> to approve the charge.
    </NoticeBanner>
    <NoticeBanner v-else-if="row?.status === 'REJECTED'" kind="error">
      Rejected<template v-if="row.rejection?.byName"> by {{ row.rejection.byName }}</template><template v-if="row.rejection?.comment">: “{{ row.rejection.comment }}”</template>. Ask the supplier to withdraw it.
    </NoticeBanner>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4">
          <FormField :label="supplierCode ? `Supplier · ${supplierCode}` : 'Supplier'" for="pdn-supplier">
            <MasterDataPicker v-if="isNew" :model-value="supplier" input-id="pdn-supplier" :search="searchSuppliers" placeholder="Type a supplier code or name" @picked="pickSupplier" />
            <div v-else class="erp-input-ro">{{ supplierName }}</div>
          </FormField>
          <FormField label="Adds to invoice" :error="errors.invoiceId" for="pdn-invoice">
            <select v-if="isNew" id="pdn-invoice" v-model="form.invoiceId" class="erp-input" :disabled="!supplier">
              <option value="">{{ !supplier ? 'Pick the supplier first' : invoices.length ? 'Pick the invoice' : 'No invoice from this supplier' }}</option>
              <option v-for="i in invoices" :key="i.id" :value="i.id">{{ i.docNo }} · {{ i.supplierInvoiceNo }} · {{ i.statusLabel }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ row?.invoice.docNo }}<template v-if="row?.invoice.supplierInvoiceNo"> · {{ row.invoice.supplierInvoiceNo }}</template></div>
          </FormField>
          <FormField label="Their debit note no" :error="errors.theirNoteNo" for="pdn-their">
            <input v-if="editable" id="pdn-their" v-model="form.theirNoteNo" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ form.theirNoteNo }}</div>
          </FormField>
          <FormField label="Date" :error="errors.docDate" for="pdn-date">
            <DatePicker
              v-if="editable"
              input-id="pdn-date"
              :model-value="isoToDate(form.docDate)"
              :max-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              fluid
              class="erp-date"
              @update:model-value="form.docDate = dateToIso($event)"
            />
            <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
          </FormField>
          <FormField label="Reason" for="pdn-reason">
            <select v-if="editable" id="pdn-reason" v-model="form.reason" class="erp-input">
              <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ form.reason }}</div>
          </FormField>
          <FormField label="Due date">
            <div class="erp-input-ro">{{ formatDate(dueDate) || '—' }}</div>
          </FormField>
          <FormField label="Note" class="col-span-3" for="pdn-note">
            <input v-if="editable" id="pdn-note" v-model="form.remarks" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.remarks || '—' }}</div>
          </FormField>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Charges</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <div class="overflow-x-auto">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Item · from Master Data</th>
                <th class="num">Qty</th>
                <th>UOM</th>
                <th class="num">Unit price</th>
                <th>Tax</th>
                <th class="num">Amount</th>
                <th v-if="editable" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              <template v-if="editable">
                <tr v-for="(l, i) in form.lines" :key="l.key">
                  <td class="min-w-[220px]">
                    <MasterDataPicker :model-value="pickerValue(l)" :search="searchItems" placeholder="Type an item or service code" @picked="l.item = $event" />
                  </td>
                  <td class="num w-[90px]"><input v-model="l.qty" class="erp-cell w-[64px]" inputmode="decimal" :aria-label="`Quantity, charge ${i + 1}`" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" /></td>
                  <td>{{ l.item?.uomCode }}</td>
                  <td class="num w-[120px]"><input v-model="l.unitPrice" class="erp-cell w-[96px]" inputmode="decimal" :aria-label="`Unit price, charge ${i + 1}`" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" /></td>
                  <td class="whitespace-nowrap">{{ l.item?.taxName ?? '—' }}</td>
                  <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
                  <td class="w-8">
                    <button
                      v-if="form.lines.length > 1"
                      type="button"
                      class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head"
                      :aria-label="`Remove charge ${i + 1}`"
                      @click="form.lines = form.lines.filter((x) => x.key !== l.key)"
                    >
                      <X :size="14" />
                    </button>
                  </td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="l in row?.lines ?? []" :key="l.id">
                  <td><div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                  <td class="num">{{ formatQty(l.qty) }}</td>
                  <td>{{ l.uomCode }}</td>
                  <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                  <td class="whitespace-nowrap">{{ l.taxName }}</td>
                  <td class="num"><MoneyText :value="l.amount" /></td>
                </tr>
              </template>
            </tbody>
          </table>
          </div>
          <div class="flex items-start justify-between gap-4">
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="form.lines.push({ key: nextKey++, item: null, qty: '1', unitPrice: '' })">
              <Plus :size="14" aria-hidden="true" />Add charge
            </button>
            <span v-else />
            <div class="flex w-[260px] flex-col text-[13px] erp-num">
              <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Charges</span><span>{{ formatMoney(editable ? charges : (row?.subtotal ?? '0')) }}</span></div>
              <div v-for="t in editable ? taxLines : (row?.taxLines ?? [])" :key="t.name" class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>{{ t.name }}</span><span>{{ formatMoney(t.amount) }}</span></div>
              <div class="flex justify-between gap-3 py-[7px] font-bold"><span>Debit total (MYR)</span><span>{{ formatMoney(total) }}</span></div>
            </div>
          </div>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Attachments</h2>
          <FileTiles :files="files" :editable="editable" :upload="upload" />
        </section>

        <ActivityList v-if="row" :items="row.activity" />
      </div>

      <aside class="flex flex-col gap-3.5">
        <SideCard v-if="check" :title="`Checked against ${check.po.docNo}`">
          <NoticeBanner :kind="check.onPo ? 'info' : 'warning'">{{ check.message }}</NoticeBanner>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-erp-muted">{{ check.onPo ? 'Next' : 'Goes to' }}</span>
            <strong class="text-[13px]">{{ check.onPo ? 'Released without approval' : (check.goesTo ?? 'The Purchasing Manager') }}</strong>
          </div>
        </SideCard>
        <SideCard v-else title="Checked against the PO">
          <p class="m-0 text-[13px] text-erp-muted">Pick the invoice and the charges to check them against the purchase order.</p>
        </SideCard>

        <SideCard v-if="check" :title="`${check.invoice.docNo} after this note`">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Invoice</span><span>{{ formatMoney(check.invoice.total) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>This debit note</span><span>+ {{ formatMoney(total) }}</span></div>
            <div class="flex justify-between gap-3 py-[7px] font-bold"><span>{{ row?.status === 'RELEASED' ? 'We owe' : 'We would owe' }} (MYR)</span><span>{{ formatMoney(sumMoney([check.invoice.total, total])) }}</span></div>
          </div>
        </SideCard>

        <SideCard v-if="check" title="Linked documents">
          <div class="flex flex-col">
            <div class="flex items-center justify-between gap-2.5 border-b border-erp-row py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_ORDER', check.po.id, check.po.docNo)" :to="linkTo('PUR_ORDER', check.po.id, check.po.docNo)!" class="erp-link">{{ check.po.docNo }}</RouterLink>
              <span v-else>{{ check.po.docNo }}</span>
              <span class="truncate text-xs text-erp-muted">{{ check.po.what }}</span>
              <StatusChip :status="check.po.status" :label="check.po.statusLabel" />
            </div>
            <div v-for="g in row?.grns ?? []" :key="g.id" class="flex items-center justify-between gap-2.5 border-b border-erp-row py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_RECEIPT', g.id, g.docNo)" :to="linkTo('PUR_RECEIPT', g.id, g.docNo)!" class="erp-link">{{ g.docNo }}</RouterLink>
              <strong v-else>{{ g.docNo }}</strong>
              <span class="text-xs text-erp-muted">{{ formatDate(g.docDate) }}</span>
              <StatusChip status="CONFIRMED" label="Received" />
            </div>
            <div class="flex items-center justify-between gap-2.5 py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_INVOICE', check.invoice.id, check.invoice.docNo)" :to="linkTo('PUR_INVOICE', check.invoice.id, check.invoice.docNo)!" class="erp-link">{{ check.invoice.docNo }}</RouterLink>
              <span v-else>{{ check.invoice.docNo }}</span>
              <span class="text-xs text-erp-muted">invoice</span>
              <StatusChip status="PI" :group="check.invoice.group" :label="check.invoice.label" />
            </div>
          </div>
        </SideCard>
      </aside>
    </div>
  </template>
</template>
