<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import ChecksList from '@/components/erp/ChecksList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
import FormField from '@/components/erp/FormField.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatPrice, formatQty, formatRm, qtyWithUnit } from '@/utils/format'
import { compareQty, isPositiveDecimal, previewLine, sumMoney, sumQty } from '@/utils/money'
import { attachmentsApi, cashPurchasesApi, lookupsApi } from '../api/purchase'
import type { CashPurchaseAction, CashPurchaseDetail, ItemOption, PaymentMethodOption, SupplierOption } from '../types'

/** P19 · Cash purchase (CashPurchase.html, FlowP7 steps 3–4). `/purchase/cash-purchases/new` records one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today, user, state: session, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const row = ref<CashPurchaseDetail | null>(null)
const methods = ref<PaymentMethodOption[]>([])
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})
const LIMIT = '1000.00'

type LineItem = Pick<ItemOption, 'code' | 'name' | 'uomCode' | 'taxName' | 'taxRate'>
interface FormLine {
  key: number
  item: LineItem | null
  qty: string
  unitPrice: string
}
let nextKey = 1
const supplier = ref<SupplierOption | null>(null)
const form = reactive({ paymentMethodCode: '', docDate: '', receiptNo: '', remarks: '', lines: [] as FormLine[] })
const newFiles = ref<{ id: string; fileName: string; mimeType: string }[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify({ s: supplier.value?.code ?? null, ...form, lines: form.lines.map((l) => [l.item?.code ?? null, l.qty, l.unitPrice]), f: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

function show(r: CashPurchaseDetail) {
  row.value = r
  supplier.value = { code: r.supplier.code, name: r.supplier.name, shortName: null, email: null, paymentTermDays: 0, currency: r.currency, isWalkIn: false }
  Object.assign(form, { paymentMethodCode: r.paymentMethodCode, docDate: r.docDate, receiptNo: r.receiptNo ?? '', remarks: r.remarks ?? '' })
  form.lines = r.lines.map((l) => ({
    key: nextKey++,
    item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, taxName: l.taxName, taxRate: l.taxRate },
    qty: formatQty(l.qty).replace(/,/g, ''),
    unitPrice: l.unitPrice.replace(/0{1,2}$/, ''),
  }))
  newFiles.value = []
  saved.value = snapshot()
  setCrumb(r.docNo)
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    methods.value = (await cashPurchasesApi.paymentMethods()).items
    if (isNew.value) {
      row.value = null
      supplier.value = null
      const branch = session.me?.branchCode
      Object.assign(form, { paymentMethodCode: methods.value.find((m) => m.branchCode === branch)?.code ?? methods.value[0]?.code ?? '', docDate: today.value, receiptNo: '', remarks: '' })
      form.lines = [{ key: nextKey++, item: null, qty: '1', unitPrice: '' }]
      newFiles.value = []
      saved.value = snapshot()
      setCrumb('New cash purchase')
    } else {
      show(await cashPurchasesApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())

const can = (action: CashPurchaseAction) =>
  isNew.value ? action === 'edit' || (action === 'release' && hasPermission('purchase.cash_purchase.release')) : Boolean(row.value?.allowedActions.includes(action))
const editable = computed(() => isNew.value || can('edit'))
const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items
const searchItems = async (q: string) => (await lookupsApi.items(q)).items
const pickerValue = (l: FormLine) => l.item as ItemOption | null

// ── Totals and checks (preview; the server checks again on release) ──────────
const previews = computed(() => form.lines.map((l) => (l.item ? previewLine(l.qty || '0', l.unitPrice || '0', l.item.taxRate) : null)))
const subtotal = computed(() => sumMoney(previews.value.map((p) => p?.amount ?? '0')))
const taxLines = computed(() => {
  const map = new Map<string, string[]>()
  form.lines.forEach((l, i) => l.item && map.set(l.item.taxName, [...(map.get(l.item.taxName) ?? []), previews.value[i]?.taxAmount ?? '0']))
  return [...map].map(([name, amount]) => ({ name, amount: sumMoney(amount) }))
})
const total = computed(() => sumMoney([subtotal.value, ...taxLines.value.map((t) => t.amount)]))
const method = computed(() => methods.value.find((m) => m.code === form.paymentMethodCode) ?? null)
const files = computed(() => [...(row.value?.attachments ?? []), ...newFiles.value.map((f) => ({ ...f, downloadUrl: `/attachments/${f.id}/download` }))])
const checks = computed(() => {
  if (!editable.value && row.value) return row.value.checks
  const under = compareQty(total.value, LIMIT) <= 0
  const hasPhoto = files.value.some((f) => f.mimeType.startsWith('image/'))
  return [
    { ok: under, text: under ? `${formatRm(total.value)} is within the ${formatRm(LIMIT)} limit` : `${formatRm(total.value)} is over the ${formatRm(LIMIT)} limit. Raise a purchase order instead.` },
    { ok: hasPhoto, text: hasPhoto ? 'Receipt photo is attached' : 'Add a photo of the receipt' },
    { ok: Boolean(supplier.value), text: supplier.value ? 'Supplier is active in Master Data' : 'Pick the shop or supplier' },
    { ok: Boolean(method.value), text: method.value ? `${method.value.label} is allowed for ${method.value.holder ?? method.value.branchCode}` : 'Pick how it was paid' },
  ]
})
const stock = computed(() => row.value?.stock ?? null)

async function upload(file: File) {
  const uploaded = await attachmentsApi.upload(file, 'RECEIPT_PHOTO')
  newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName, mimeType: file.type })
}

// ── Save, release, delete ────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!supplier.value) e.supplierCode = 'Pick the shop or supplier.'
  if (!form.paymentMethodCode) e.paymentMethodCode = 'Pick how it was paid.'
  if (!form.lines.some((l) => l.item)) e.lines = 'Add at least one item.'
  form.lines.forEach((l, i) => {
    if (l.item && !isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (l.item && !isPositiveDecimal(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}
function body() {
  return {
    supplierCode: supplier.value!.code,
    paymentMethodCode: form.paymentMethodCode,
    docDate: form.docDate,
    receiptNo: form.receiptNo,
    remarks: form.remarks,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.filter((l) => l.item).map((l) => ({ itemCode: l.item!.code, qty: l.qty, unitPrice: l.unitPrice })),
  }
}
async function save(quiet = false): Promise<CashPurchaseDetail | null> {
  if (!validate()) return null
  busy.value = true
  try {
    const result = isNew.value ? await cashPurchasesApi.create(body()) : await cashPurchasesApi.update(row.value!.id, { ...body(), version: row.value!.version })
    if (!quiet) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/cash-purchases/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
    return null
  } finally {
    busy.value = false
  }
}
async function release() {
  const current = isNew.value || dirty.value ? await save(true) : row.value
  if (!current) return
  confirmDialog.require({
    header: `Release ${current.docNo}?`,
    message: `${formatRm(current.total)} is recorded as already paid by ${current.paidByLabel}, and the goods count as received.`,
    acceptLabel: 'Release',
    rejectLabel: 'Not yet',
    accept: async () => {
      busy.value = true
      try {
        show(await cashPurchasesApi.release(current.id, current.version))
        toast.add({ severity: 'success', summary: `${current.docNo} released`, life: 3000 })
      } finally {
        busy.value = false
      }
    },
  })
}
function deleteDraft() {
  const r = row.value
  if (!r) return
  confirmDialog.require({
    header: `Delete ${r.docNo}?`,
    message: `The draft is removed. Its number ${r.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await cashPurchasesApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/cash-purchases')
    },
  })
}

const goingIn = computed(() => {
  const ls = form.lines.filter((l) => l.item)
  return ls.length && new Set(ls.map((l) => l.item!.uomCode)).size === 1 ? qtyWithUnit(sumQty(ls.map((l) => l.qty)), ls[0]!.item!.uomCode) : `${ls.length} items`
})
const belowReorder = computed(() => Boolean(stock.value?.reorderLevel && compareQty(stock.value.after, stock.value.reorderLevel) < 0))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="row ? `Cash purchase ${row.docNo}` : 'New cash purchase'" document>
      <template #chip>
        <StatusChip v-if="row" :status="row.status" :group="row.status === 'RELEASED' ? 'done' : 'draft'" />
        <StatusChip v-else status="DRAFT" label="New" />
      </template>
      <template #subtitle>Bought over the counter<template v-if="supplier"> at {{ supplier.name }}</template> · no purchase order</template>
      <template #actions>
        <RouterLink to="/purchase/cash-purchases" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || (!isNew && !dirty)" @click="save()">Save draft</button>
          <button v-if="can('release')" type="button" class="erp-btn erp-btn-primary" :disabled="busy || checks.some((c) => !c.ok)" @click="release">Release</button>
        </template>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-4 gap-x-4 gap-y-3 px-5 py-4">
          <FormField :label="supplier ? `Supplier · ${supplier.code}` : 'Supplier'" :error="errors.supplierCode" for="cp-supplier">
            <MasterDataPicker v-if="editable" v-model="supplier" input-id="cp-supplier" :search="searchSuppliers" placeholder="Shop or supplier" />
            <div v-else class="erp-input-ro">{{ supplier?.name }}</div>
          </FormField>
          <FormField label="Purchase date" for="cp-date">
            <DatePicker v-if="editable" input-id="cp-date" :model-value="isoToDate(form.docDate)" :max-date="isoToDate(today) ?? undefined" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
            <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
          </FormField>
          <FormField label="Bought by">
            <div class="erp-input-ro">{{ row ? `${row.boughtBy.name}${row.boughtBy.title ? ` · ${row.boughtBy.title}` : ''}` : `${user?.name ?? ''}${session.me?.user.jobTitle ? ` · ${session.me.user.jobTitle}` : ''}` }}</div>
          </FormField>
          <FormField label="Branch">
            <div class="erp-input-ro">{{ row?.branch.name ?? method?.branchCode ?? '—' }}</div>
          </FormField>
          <FormField label="Paid by" :error="errors.paymentMethodCode" for="cp-paid">
            <select v-if="editable" id="cp-paid" v-model="form.paymentMethodCode" class="erp-input">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.label }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ row?.paidByLabel }}</div>
          </FormField>
          <FormField label="Their receipt no" for="cp-receipt">
            <input v-if="editable" id="cp-receipt" v-model="form.receiptNo" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ form.receiptNo || '—' }}</div>
          </FormField>
          <FormField label="Tax mode"><div class="erp-input-ro">Exclusive</div></FormField>
          <FormField label="Currency"><div class="erp-input-ro">MYR</div></FormField>
          <FormField label="Note" class="col-span-4" for="cp-note">
            <input v-if="editable" id="cp-note" v-model="form.remarks" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.remarks || '—' }}</div>
          </FormField>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Items</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
            <button v-else-if="editable" type="button" class="erp-btn erp-btn-secondary h-8" @click="form.lines.push({ key: nextKey++, item: null, qty: '1', unitPrice: '' })"><Plus :size="14" aria-hidden="true" />Add item</button>
          </div>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead>
                <tr><th>Item · from Master Data</th><th class="num">Qty</th><th>UOM</th><th class="num">Unit price</th><th>Tax</th><th class="num">Amount</th><th v-if="editable" aria-label="Remove" /></tr>
              </thead>
              <tbody>
                <tr v-for="(l, i) in form.lines" :key="l.key">
                  <td class="min-w-[220px]">
                    <MasterDataPicker v-if="editable" :model-value="pickerValue(l)" :search="searchItems" placeholder="Type an item code or name" @picked="l.item = $event" />
                    <template v-else><div class="font-semibold whitespace-nowrap">{{ l.item?.code }}</div><div class="text-xs text-erp-muted">{{ l.item?.name }}</div></template>
                  </td>
                  <td class="num w-[90px]">
                    <input v-if="editable" v-model="l.qty" class="erp-cell w-[64px]" inputmode="decimal" :aria-label="`Quantity, line ${i + 1}`" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" />
                    <template v-else>{{ formatQty(l.qty) }}</template>
                  </td>
                  <td>{{ l.item?.uomCode }}</td>
                  <td class="num w-[120px]">
                    <input v-if="editable" v-model="l.unitPrice" class="erp-cell w-[96px]" inputmode="decimal" :aria-label="`Unit price, line ${i + 1}`" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" />
                    <template v-else>{{ formatPrice(l.unitPrice) }}</template>
                  </td>
                  <td class="whitespace-nowrap">{{ l.item?.taxName ?? '—' }}</td>
                  <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
                  <td v-if="editable" class="w-8">
                    <button v-if="form.lines.length > 1" type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove line ${i + 1}`" @click="form.lines = form.lines.filter((x) => x.key !== l.key)">
                      <X :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="flex justify-end">
            <div class="flex w-[260px] flex-col text-[13px] erp-num">
              <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Subtotal</span><span>{{ formatMoney(subtotal) }}</span></div>
              <div v-for="t in taxLines" :key="t.name" class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>{{ t.name }}</span><span>{{ formatMoney(t.amount) }}</span></div>
              <div class="flex justify-between gap-3 py-[7px] font-bold"><span>Paid (MYR)</span><span>{{ formatMoney(total) }}</span></div>
            </div>
          </div>
        </section>

        <ActivityList v-if="row" :items="row.activity" />
      </div>

      <aside class="flex flex-col gap-3.5">
        <SideCard title="Receipt">
          <FileTiles :files="files" :editable="editable" :upload="upload" add-label="+ Add photo" accept="image/*" />
        </SideCard>
        <ChecksList :checks="checks" />
        <SideCard v-if="stock" :title="`${stock.itemCode} stock`">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>On hand now</span><span>{{ qtyWithUnit(stock.onHand, stock.uomCode) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>After this purchase</span><strong>{{ qtyWithUnit(stock.after, stock.uomCode) }}</strong></div>
            <div class="flex justify-between gap-3 py-[7px]"><span>Reorder level</span><span>{{ stock.reorderLevel ? qtyWithUnit(stock.reorderLevel, stock.uomCode) : '—' }}</span></div>
          </div>
          <p v-if="belowReorder" class="m-0 text-xs text-erp-muted">Still below reorder. Check the demand list for a request.</p>
        </SideCard>
        <NextSteps v-if="editable" title="When you release">
          <li><span>The purchase is recorded as already paid.</span></li>
          <li><span>{{ goingIn }} go into stock. The event is queued for Inventory.</span></li>
          <li><span>The {{ method?.kind === 'PETTY_CASH' ? 'petty cash' : 'card' }} spend is queued for Finance.</span></li>
        </NextSteps>
      </aside>
    </div>
  </template>
</template>
