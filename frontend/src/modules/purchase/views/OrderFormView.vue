<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Mail, Plus, Printer, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import QtyProgress from '@/components/erp/QtyProgress.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import TotalsBox from '@/components/erp/TotalsBox.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDayMonth, formatPrice, formatQty, formatTime, qtyWithUnit } from '@/utils/format'
import { isPositiveDecimal, previewLine, sumMoney } from '@/utils/money'
import { lookupsApi, ordersApi } from '../api/purchase'
import { docRoute } from '../routes'
import type { ItemOption, OrderAction, OrderDetail, SupplierOption, WarehouseOption } from '../types'
import SendForApprovalDialog from './SendForApprovalDialog.vue'

/** P10 · Purchase order (PoForm.html, PoApproval.html). New, draft, waiting, released, done. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user, state: session } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const order = ref<OrderDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const warehouses = ref<WarehouseOption[]>([])
const approvalOpen = ref(false)

// ── Form state ───────────────────────────────────────────────────────────────
type LineItem = Pick<ItemOption, 'code' | 'name' | 'uomCode' | 'taxCode' | 'taxName' | 'taxRate'>
interface EditLine {
  key: number
  item: LineItem | null
  qty: string
  unitPrice: string
  salesOrderNo: string | null
}
let nextKey = 1
const form = reactive({
  supplier: null as SupplierOption | null,
  warehouseCode: '',
  docDate: '',
  expectedDate: '' as string,
  supplierQuoteRef: '',
  noteToSupplier: '',
  lines: [] as EditLine[],
})
// Dates are YYYY-MM-DD strings in the form; the date picker works with Date objects.
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) =>
  value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : ''
function setDocDate(value: unknown) {
  form.docDate = dateToIso(value)
}
function setExpected(value: unknown) {
  form.expectedDate = dateToIso(value)
}

const saved = ref('')
const snapshot = () =>
  JSON.stringify({ ...form, lines: form.lines.map((l) => ({ item: l.item, qty: l.qty, unitPrice: l.unitPrice, salesOrderNo: l.salesOrderNo })) })
const dirty = computed(() => snapshot() !== saved.value)

// A new order can only be saved; everything else is offered by the server once it exists.
const can = (action: OrderAction) => (isNew.value ? action === 'edit' : Boolean(order.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))
const deliveryEditable = computed(() => !editable.value && can('updateDelivery'))

function fillForm(o: OrderDetail | null) {
  if (o) {
    form.supplier = { code: o.supplier.code, name: o.supplier.name, shortName: null, email: o.supplier.email, paymentTermDays: o.paymentTermDays, currency: o.currency, isWalkIn: false }
    form.warehouseCode = o.warehouse.code
    form.docDate = o.docDate
    form.expectedDate = o.expectedDate ?? ''
    form.supplierQuoteRef = o.supplierQuoteRef ?? ''
    form.noteToSupplier = o.noteToSupplier ?? ''
    form.lines = o.lines.map((l) => ({
      key: nextKey++,
      item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: l.taxName, taxRate: l.taxRate },
      qty: formatQty(l.orderedQty).replace(/,/g, ''),
      unitPrice: l.unitPrice.replace(/0{1,2}$/, ''),
      salesOrderNo: l.salesOrderNo,
    }))
  } else {
    form.supplier = null
    // The main warehouse of the branch the user works in (HQ-MAIN), not e.g. damaged goods.
    const branch = session.me?.branchCode
    form.warehouseCode =
      warehouses.value.find((w) => w.branchCode === branch && w.code.endsWith('-MAIN'))?.code ??
      warehouses.value.find((w) => w.branchCode === branch)?.code ??
      warehouses.value[0]?.code ??
      ''
    form.docDate = today.value
    form.expectedDate = ''
    form.supplierQuoteRef = ''
    form.noteToSupplier = ''
    form.lines = [{ key: nextKey++, item: null, qty: '', unitPrice: '', salesOrderNo: null }]
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    if (!warehouses.value.length) warehouses.value = (await lookupsApi.warehouses()).items
    order.value = isNew.value ? null : await ordersApi.get(id.value)
    fillForm(order.value)
    setCrumb(order.value?.docNo ?? 'New purchase order')
    if (route.query.approve === '1') {
      void router.replace({ query: {} })
      if (order.value?.allowedActions.includes('submit')) approvalOpen.value = true
    }
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

// ── Lines ────────────────────────────────────────────────────────────────────
function addLine() {
  form.lines.push({ key: nextKey++, item: null, qty: '', unitPrice: '', salesOrderNo: null })
}
function removeLine(key: number) {
  form.lines = form.lines.filter((l) => l.key !== key)
}
/** The picker works with full ItemOption values; a saved line only keeps the snapshot fields. */
const pickerValue = (line: EditLine) => line.item as ItemOption | null

function onItemPicked(line: EditLine, item: ItemOption) {
  line.item = item
  // Contract price with this supplier first, else the last price paid.
  if (!line.unitPrice) line.unitPrice = (item.contractPrice ?? item.lastPrice ?? '').replace(/0{1,2}$/, '')
}
const searchItems = async (q: string) => (await lookupsApi.items(q, form.supplier?.code)).items
const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items

const previews = computed(() =>
  form.lines.map((l) => (l.item ? previewLine(l.qty || '0', l.unitPrice || '0', l.item.taxRate) : null)),
)
const previewTotals = computed(() => {
  const amounts = previews.value.filter((p) => p !== null).map((p) => p!.amount)
  const taxes = new Map<string, { name: string; amounts: string[] }>()
  form.lines.forEach((l, i) => {
    const p = previews.value[i]
    if (!l.item || !p) return
    const entry = taxes.get(l.item.taxCode) ?? { name: l.item.taxName, amounts: [] }
    entry.amounts.push(p.taxAmount)
    taxes.set(l.item.taxCode, entry)
  })
  const taxLines = [...taxes].map(([code, t]) => ({ code, name: t.name, amount: sumMoney(t.amounts) }))
  const subtotal = sumMoney(amounts)
  return { subtotal, taxLines, total: sumMoney([subtotal, ...taxLines.map((t) => t.amount)]) }
})
const totals = computed(() => (editable.value ? previewTotals.value : order.value?.totals))

// ── Save ─────────────────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.supplier) e.supplierCode = 'Pick a supplier.'
  if (!form.warehouseCode) e.warehouseCode = 'Pick where the goods are delivered.'
  const lines = form.lines.filter((l) => l.item || l.qty || l.unitPrice)
  if (!lines.length) e.lines = 'Add at least one line.'
  form.lines.forEach((l, i) => {
    if (!l.item && (l.qty || l.unitPrice)) e[`lines[${i}].itemCode`] = 'Pick an item from Master Data.'
    if (l.item && !isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (l.item && !/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter a price.'
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
      supplierCode: form.supplier!.code,
      warehouseCode: form.warehouseCode,
      docDate: form.docDate || undefined,
      expectedDate: form.expectedDate || null,
      supplierQuoteRef: form.supplierQuoteRef,
      noteToSupplier: form.noteToSupplier,
      lines: form.lines.filter((l) => l.item).map((l) => ({ itemCode: l.item!.code, qty: l.qty, unitPrice: l.unitPrice })),
    }
    const result = isNew.value ? await ordersApi.create(body) : await ordersApi.update(id.value, { ...body, version: order.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/orders/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
    return null
  } finally {
    saving.value = false
  }
}

async function saveDelivery() {
  if (!order.value) return
  saving.value = true
  try {
    show(await ordersApi.update(order.value.id, { version: order.value.version, expectedDate: form.expectedDate || null }))
    toast.add({ severity: 'success', summary: 'Expected delivery updated', life: 2500 })
  } finally {
    saving.value = false
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function openApproval() {
  if (dirty.value && !(await save())) return
  approvalOpen.value = true
}

async function release() {
  if (dirty.value && !(await save())) return
  const o = order.value!
  confirm.require({
    header: `Release ${o.docNo}?`,
    message: `${o.docNo} is ${o.supplier.email ? `emailed to ${o.supplier.email}` : 'sent to the supplier'} and locked. Corrections then go through Cancel order, Purchase return or Supplier debit note.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      const result = await ordersApi.release(o.id, o.version)
      show(result)
      toast.add({ severity: 'success', summary: `${result.docNo} released`, detail: result.activity[0]?.message ?? '', life: 4000 })
    },
  })
}

async function email() {
  const result = await ordersApi.email(order.value!.id)
  toast.add({ severity: 'success', summary: 'Sent', detail: `${order.value!.docNo} emailed to ${result.sentTo}.`, life: 3000 })
  show(await ordersApi.get(order.value!.id))
}

function print() {
  window.print()
}

function onSent(o: OrderDetail) {
  show(o)
  notifyApprovalsChanged()
}

// ── Display helpers ──────────────────────────────────────────────────────────
const title = computed(() => (isNew.value ? 'New purchase order' : `Purchase order ${order.value?.docNo ?? ''}`))
const chip = computed(() => {
  const o = order.value
  if (!o) return null
  return { status: o.statusLabel === 'Approved' ? 'APPROVED' : o.status, label: o.statusLabel }
})
const showReceived = computed(() => Boolean(order.value && !['DRAFT', 'PENDING_APPROVAL'].includes(order.value.status)))

const approvalChip = computed(() => {
  const state = order.value?.approval.state
  return (
    {
      NOT_NEEDED: { status: 'DONE', label: 'Not needed' },
      NEEDED: { status: 'PENDING_APPROVAL', label: 'Needed' },
      PENDING: { status: 'PENDING_APPROVAL', label: 'Waiting' },
      APPROVED: { status: 'APPROVED', label: 'Approved' },
      REJECTED: { status: 'REJECTED', label: 'Rejected' },
    } as const
  )[state ?? 'NOT_NEEDED']
})

const whenText = (iso: string | null) => (iso ? `${formatDayMonth(iso.slice(0, 10))} at ${formatTime(iso)}` : '')
const openText = computed(() => {
  const o = order.value
  if (!o) return ''
  const open = qtyWithUnit(o.quantities.open, o.quantities.uomCode)
  const when = o.promisedDate
    ? `Supplier promised the last ${open} by ${formatDayMonth(o.promisedDate)}.`
    : o.expectedDate
      ? `Expected ${formatDate(o.expectedDate)}.`
      : 'No delivery date yet.'
  return `${when} Receive them when they arrive, or cancel the balance if they will not come.`
})
const showOpenCard = computed(() => Boolean(order.value && ['RELEASED', 'PARTIAL'].includes(order.value.status) && Number(order.value.quantities.open) > 0))
const warehouseName = computed(() => warehouses.value.find((w) => w.code === form.warehouseCode)?.name ?? order.value?.warehouse.name ?? '')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" document>
      <template #chip>
        <StatusChip v-if="chip" :status="chip.status" :label="chip.label" />
        <StatusChip v-else status="DRAFT" label="New" />
      </template>
      <template v-if="order" #subtitle>
        {{ order.supplier.name }}
        <template v-if="order.source.type === 'RFQ'">
          · awarded from
          <RouterLink v-if="order.source.id" :to="docRoute('PUR_RFQ', order.source.id)!" class="erp-link">{{ order.source.no }}</RouterLink>
        </template>
        <template v-else-if="order.source.type === 'REQUEST'">
          · from <RouterLink v-if="order.source.id" :to="docRoute('PUR_REQUEST', order.source.id)!" class="erp-link">{{ order.source.no }}</RouterLink>
        </template>
        <template v-else-if="order.source.type === 'SALES_ORDER'">
          · {{ order.draftedBySystem ? 'drafted automatically from' : 'for' }} {{ order.source.no }} (buy to order)
          <template v-if="order.draftedBySystem"> on {{ formatDayMonth(order.createdAt.slice(0, 10)) }}</template>
        </template>
        <template v-else-if="order.source.type === 'MIGRATED'"> · migrated from the old system</template>
        <template v-else> · raised by {{ order.buyer.name }}</template>
        <template v-if="order.supplierQuoteRef"> · their quote {{ order.supplierQuoteRef }}</template>
      </template>
      <template v-else #subtitle>Pick the supplier and add lines. The PO number is given when you save.</template>

      <template #actions>
        <template v-if="editable">
          <button
            type="button"
            class="erp-btn"
            :class="isNew ? 'erp-btn-primary' : 'erp-btn-secondary'"
            :disabled="saving || (!isNew && !dirty)"
            @click="save"
          >
            Save draft
          </button>
          <button v-if="can('submit')" type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="openApproval">Send for approval</button>
          <button v-if="!isNew && can('release')" type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="release">Release</button>
        </template>
        <template v-else-if="order">
          <button type="button" class="erp-btn erp-btn-secondary erp-no-print" @click="print"><Printer :size="15" aria-hidden="true" />Print</button>
          <button v-if="can('email')" type="button" class="erp-btn erp-btn-secondary" @click="email"><Mail :size="15" aria-hidden="true" />Email to supplier</button>
          <RouterLink v-if="can('cancelBalance')" :to="`/purchase/cancel-orders/new?po=${order.id}`" class="erp-btn erp-btn-danger">Cancel balance</RouterLink>
          <RouterLink v-if="can('receive')" :to="`/purchase/receipts/new?po=${order.id}`" class="erp-btn erp-btn-primary">Receive goods</RouterLink>
          <button v-if="can('release')" type="button" class="erp-btn erp-btn-primary" @click="release">Release</button>
        </template>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4" :class="order ? 'grid-cols-[minmax(0,1fr)_330px]' : 'grid-cols-1'">
      <div class="flex min-w-0 flex-col gap-4">
        <NoticeBanner v-if="order?.status === 'PENDING_APPROVAL'" kind="warning">
          Waiting for <strong>{{ order.approval.waitingFor }}</strong>. The order is locked until someone decides.
        </NoticeBanner>
        <NoticeBanner v-else-if="order?.approval.state === 'REJECTED' && order.status === 'DRAFT'" kind="error">
          Rejected by {{ order.approval.rejection?.byName }}<template v-if="order.approval.rejection?.comment">: “{{ order.approval.rejection.comment }}”</template>.
          Change the order and send it again.
        </NoticeBanner>

        <!-- Header fields (PoForm.html order) -->
        <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
          <FormField :label="form.supplier ? `Supplier · ${form.supplier.code}` : 'Supplier'" :error="errors.supplierCode" for="supplier">
            <MasterDataPicker
              v-if="editable"
              v-model="form.supplier"
              input-id="supplier"
              :search="searchSuppliers"
              :invalid="Boolean(errors.supplierCode)"
              placeholder="Type a supplier code or name"
            />
            <div v-else class="erp-input-ro">{{ form.supplier?.name }}</div>
          </FormField>
          <FormField label="PO date" for="po-date">
            <DatePicker
              v-if="editable"
              input-id="po-date"
              :model-value="isoToDate(form.docDate)"
              date-format="d M yy"
              show-icon
              fluid
              class="erp-date"
              @update:model-value="setDocDate"
            />
            <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
          </FormField>
          <FormField label="Expected delivery" :error="errors.expectedDate" for="expected">
            <div class="flex gap-1.5">
              <DatePicker
                v-if="editable || deliveryEditable"
                input-id="expected"
                :model-value="isoToDate(form.expectedDate)"
                :min-date="isoToDate(form.docDate) ?? undefined"
                date-format="d M yy"
                show-icon
                show-button-bar
                fluid
                class="erp-date"
                :invalid="Boolean(errors.expectedDate)"
                @update:model-value="setExpected"
              />
              <div v-else class="erp-input-ro w-full">{{ formatDate(form.expectedDate) || '—' }}</div>
              <button v-if="deliveryEditable && dirty" type="button" class="erp-btn erp-btn-primary px-3" :disabled="saving" @click="saveDelivery">Save</button>
            </div>
          </FormField>
          <FormField label="Buyer">
            <div class="erp-input-ro">{{ order?.buyer.name ?? user?.name }}</div>
          </FormField>

          <FormField label="Deliver to" :error="errors.warehouseCode" for="deliver-to">
            <select v-if="editable" id="deliver-to" v-model="form.warehouseCode" class="erp-input">
              <option v-for="w in warehouses" :key="w.code" :value="w.code">{{ w.name }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ warehouseName }}</div>
          </FormField>
          <FormField label="Payment term">
            <div class="erp-input-ro">{{ form.supplier ? `${order?.paymentTermDays ?? form.supplier.paymentTermDays} days` : '—' }}</div>
          </FormField>
          <FormField label="Currency · tax mode">
            <div class="erp-input-ro">{{ order?.currency ?? form.supplier?.currency ?? 'MYR' }} · Exclusive</div>
          </FormField>
          <FormField v-if="order?.salesOrder" label="Customer order">
            <div class="erp-input-ro" :title="`${order.salesOrder.no} · ${order.salesOrder.customerName ?? ''}`">
              {{ order.salesOrder.no }}<template v-if="order.salesOrder.customerName"> · {{ order.salesOrder.customerName }}</template>
            </div>
          </FormField>
          <FormField v-else label="Supplier quote ref" for="quote-ref">
            <input v-if="editable" id="quote-ref" v-model="form.supplierQuoteRef" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ form.supplierQuoteRef || '—' }}</div>
          </FormField>

          <FormField label="Note to supplier" class="col-span-4" for="note">
            <input v-if="editable" id="note" v-model="form.noteToSupplier" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.noteToSupplier || '—' }}</div>
          </FormField>
        </section>

        <!-- Lines -->
        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Lines</h2>
            <span v-if="showReceived" class="text-xs text-erp-muted">Received and billed come from goods receipts and supplier invoices. They are never typed here.</span>
            <span v-else-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Item · from Master Data</th>
                  <template v-if="showReceived">
                    <th>Ordered</th>
                    <th class="num">Received</th>
                    <th class="num">Billed</th>
                  </template>
                  <th v-else class="num">Qty</th>
                  <th class="num">Unit price</th>
                  <th>Tax</th>
                  <th class="num">Amount</th>
                  <th v-if="editable" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                <!-- Editable draft -->
                <template v-if="editable">
                  <tr v-for="(l, i) in form.lines" :key="l.key">
                    <td class="min-w-[280px]">
                      <MasterDataPicker
                        :model-value="pickerValue(l)"
                        :search="searchItems"
                        :invalid="Boolean(errors[`lines[${i}].itemCode`])"
                        placeholder="Type an item code or name"
                        @picked="onItemPicked(l, $event)"
                      >
                        <template #hint="{ item }">
                          <span class="text-xs text-erp-muted">
                            {{ item.uomCode }} · {{ item.taxName }}
                            <template v-if="item.contractPrice"> · contract {{ formatPrice(item.contractPrice) }}</template>
                            <template v-else-if="item.lastPrice"> · last price {{ formatPrice(item.lastPrice) }}</template>
                          </span>
                        </template>
                      </MasterDataPicker>
                      <div v-if="errors[`lines[${i}].itemCode`]" class="mt-1 text-xs text-note-error-text">{{ errors[`lines[${i}].itemCode`] }}</div>
                    </td>
                    <td class="num w-[130px]">
                      <div class="flex items-center gap-1.5">
                        <input v-model="l.qty" class="erp-cell" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                        <span class="w-9 text-left text-xs text-erp-muted">{{ l.item?.uomCode }}</span>
                      </div>
                      <div v-if="errors[`lines[${i}].qty`]" class="mt-1 text-left text-xs text-note-error-text">{{ errors[`lines[${i}].qty`] }}</div>
                    </td>
                    <td class="num w-[120px]">
                      <input v-model="l.unitPrice" class="erp-cell" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Unit price, line ${i + 1}`" />
                    </td>
                    <td class="whitespace-nowrap">{{ l.item?.taxName ?? '—' }}</td>
                    <td class="num"><MoneyText :value="previews[i]?.amount ?? null" /></td>
                    <td class="w-8">
                      <button
                        v-if="form.lines.length > 1"
                        type="button"
                        class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head"
                        :aria-label="`Remove line ${i + 1}`"
                        @click="removeLine(l.key)"
                      >
                        <X :size="14" />
                      </button>
                    </td>
                  </tr>
                </template>

                <!-- Read-only -->
                <template v-else>
                  <tr v-for="l in order?.lines ?? []" :key="l.id">
                    <td>
                      <div class="font-bold">{{ l.itemCode }}</div>
                      <div class="text-erp-muted">{{ l.itemName }}<template v-if="l.salesOrderNo"> · for {{ l.salesOrderNo }}</template></div>
                    </td>
                    <template v-if="showReceived">
                      <td class="erp-num">{{ formatQty(l.orderedQty) }} {{ l.uomCode }}</td>
                      <td class="num font-bold">{{ formatQty(l.receivedQty) }}</td>
                      <td class="num">{{ formatQty(l.billedQty) }}</td>
                    </template>
                    <td v-else class="num">{{ formatQty(l.orderedQty) }} {{ l.uomCode }}</td>
                    <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                    <td class="whitespace-nowrap">{{ l.taxName }}</td>
                    <td class="num"><MoneyText :value="l.amount" /></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div class="flex items-start justify-between gap-4">
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="addLine"><Plus :size="14" aria-hidden="true" />Add line</button>
            <span v-else />
            <TotalsBox v-if="totals" :subtotal="totals.subtotal" :tax-lines="totals.taxLines" :total="totals.total" />
          </div>
        </section>

        <ActivityList v-if="order" :items="order.activity" />
      </div>

      <!-- Right panel -->
      <aside v-if="order" class="flex flex-col gap-4">
        <SideCard v-if="order" title="Approval">
          <template #chip><StatusChip :status="approvalChip.status" :label="approvalChip.label" /></template>
          <p class="m-0 text-xs text-erp-muted">{{ order.approval.reason }}</p>
          <p v-if="order.approval.state === 'PENDING'" class="m-0 text-[13px] leading-normal">
            Waiting for {{ order.approval.waitingFor }}. The order is locked until someone decides.
          </p>
          <p v-else-if="order.approval.state === 'NEEDED'" class="m-0 text-[13px] leading-normal">Send it for approval before it can be released.</p>
          <template v-for="s in order.approval.steps.filter((s) => s.decidedAt)" :key="s.approverRole">
            <p class="m-0 text-[13px] leading-normal">
              {{ s.status === 'APPROVED' ? 'Approved' : 'Rejected' }} by {{ s.decidedByName }} on {{ whenText(s.decidedAt) }}.
              <span v-if="s.comment" class="text-erp-muted">“{{ s.comment }}”</span>
            </p>
          </template>
          <p v-if="order.approval.released" class="m-0 text-[13px] leading-normal">
            Released by {{ order.approval.released.byName }} on {{ whenText(order.approval.released.at) }}.
            The rule is kept in Operation Policies ›
            <RouterLink to="/purchase/settings/approval-rules" class="erp-link">Approval Rules</RouterLink>.
          </p>
          <p v-else-if="order.approval.state !== 'PENDING'" class="m-0 text-xs text-erp-muted">
            The rule is kept in Operation Policies › <RouterLink to="/purchase/settings/approval-rules" class="erp-link">Approval Rules</RouterLink>.
          </p>
        </SideCard>

        <SideCard v-if="order && showOpenCard" :title="`Still open · ${qtyWithUnit(order.quantities.open, order.quantities.uomCode)}`">
          <QtyProgress :done="order.quantities.received" :total="order.quantities.ordered" width="60px" class="text-base" />
          <p class="m-0 text-[13px] leading-normal">{{ openText }}</p>
        </SideCard>

        <LinkedDocs
          v-if="order && order.status !== 'DRAFT'"
          :docs="order.links"
          :route-of="docRoute"
          :flow-to="`/purchase/orders/${order.id}/flow`"
        />

      </aside>
    </div>

    <SendForApprovalDialog v-if="order" v-model:visible="approvalOpen" :order-id="order.id" :version="order.version" @sent="onSent" />
  </template>
</template>
