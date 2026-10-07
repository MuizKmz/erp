<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatPrice, formatQty, formatRm } from '@/utils/format'
import { isPositiveDecimal, previewInclusiveLine, priceWithTax, subMoney, sumMoney } from '@/utils/money'
import { salesCashSalesApi, salesLookupsApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import type { CashSaleAction, CashSaleDetail, PaymentMethod, SaleItemOption } from '../types'

/** S24 · Cash sale (CashSale.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const cs = ref<CashSaleDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const pickerOpen = ref(false)
const scan = ref('')
const errors = ref<Record<string, string>>({})

interface Line {
  key: number
  itemCode: string
  itemName: string
  taxName: string
  taxRate: string
  qty: string
  unitPrice: string
}
let nextKey = 1
const form = reactive({
  docDate: '',
  buyerName: '',
  buyerPhone: '',
  buyerTin: '',
  ownEInvoice: false,
  paymentMethod: 'CASH' as PaymentMethod,
  paymentRef: '',
  amountReceived: '',
  lines: [] as Line[],
})
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')
const trimPrice = (v: string) => v.replace(/(\.\d\d)00$/, '$1')
const METHODS: { value: PaymentMethod; label: string; ref: string | null }[] = [
  { value: 'CASH', label: 'Cash', ref: null },
  { value: 'CARD', label: 'Card', ref: 'Card terminal reference' },
  { value: 'DUITNOW', label: 'DuitNow QR', ref: 'DuitNow reference' },
  { value: 'TRANSFER', label: 'Bank transfer', ref: 'Transfer reference' },
]

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => [l.itemCode, l.qty, l.unitPrice]) })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: CashSaleAction) => (isNew.value ? a === 'edit' : Boolean(cs.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))

function fill(c: CashSaleDetail) {
  cs.value = c
  Object.assign(form, {
    docDate: c.docDate, buyerName: c.buyerName ?? '', buyerPhone: c.buyerPhone ?? '', buyerTin: c.buyerTin ?? '', ownEInvoice: c.ownEInvoice,
    paymentMethod: c.paymentMethod, paymentRef: c.paymentRef ?? '', amountReceived: Number(c.amountReceived) ? c.amountReceived : '',
    lines: c.lines.map((l) => ({ key: nextKey++, itemCode: l.itemCode, itemName: l.itemName, taxName: l.taxName, taxRate: l.taxRate, qty: plain(l.qty), unitPrice: trimPrice(l.unitPrice) })),
  })
  saved.value = snapshot()
  errors.value = {}
  setCrumb(c.docNo)
}

onMounted(async () => {
  loading.value = true
  try {
    if (isNew.value) {
      form.docDate = today.value
      saved.value = snapshot()
      setCrumb('New cash sale')
    } else {
      fill(await salesCashSalesApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
})

// ── Items: scan a barcode or code, or search ─────────────────────────────────
function addItem(item: SaleItemOption, qty = '1') {
  const existing = form.lines.find((l) => l.itemCode === item.code)
  if (existing) {
    existing.qty = String(Number(existing.qty || 0) + Number(qty))
    return
  }
  const price = item.listPrice ? priceWithTax(item.listPrice, item.taxRate) : ''
  form.lines.push({ key: nextKey++, itemCode: item.code, itemName: item.name, taxName: item.taxName, taxRate: item.taxRate, qty, unitPrice: trimPrice(price ?? '') })
}
async function onScan() {
  const q = scan.value.trim()
  if (!q) return
  const found = await salesLookupsApi.items({ q, customerCode: 'C-CASH', branchCode: user.value?.branchCodes[0] })
  const item = found.items.find((i) => i.code.toLowerCase() === q.toLowerCase()) ?? (found.items.length === 1 ? found.items[0] : undefined)
  if (!item) {
    toast.add({ severity: 'warn', summary: `No single item matches “${q}”`, detail: 'Use Search items to pick it from the list.', life: 3500 })
    return
  }
  if (item.state === 'EXCLUDED' || item.state === 'NOT_FOR_SALE') {
    toast.add({ severity: 'warn', summary: `${item.code} cannot be sold`, detail: item.reason ?? undefined, life: 4000 })
    return
  }
  addItem(item)
  scan.value = ''
}

// ── Preview: prices include tax ──────────────────────────────────────────────
const previews = computed(() => form.lines.map((l) => previewInclusiveLine(l.qty || '0', l.unitPrice || '0', l.taxRate)))
const totals = computed(() => {
  if (cs.value && !editable.value) return cs.value.totals
  const ok = previews.value.filter((p) => p !== null)
  const total = sumMoney(ok.map((p) => p!.amount))
  const tax = sumMoney(ok.map((p) => p!.taxAmount))
  return { beforeTax: subMoney(total, tax), tax, taxName: [...new Set(form.lines.map((l) => l.taxName))].join(', ') || 'SST', rounding: '0.00', total }
})
const received = computed(() => (/^\d+(\.\d{1,2})?$/.test(form.amountReceived) ? form.amountReceived : '0.00'))
const change = computed(() => {
  if (form.paymentMethod !== 'CASH') return '0.00'
  const c = subMoney(received.value, totals.value.total)
  return c.startsWith('-') ? '0.00' : c
})
const balance = computed(() => {
  const b = subMoney(totals.value.total, received.value)
  return b.startsWith('-') ? '0.00' : b
})
const method = computed(() => METHODS.find((m) => m.value === form.paymentMethod)!)
function pickMethod(m: PaymentMethod) {
  form.paymentMethod = m
  if (m !== 'CASH') form.amountReceived = totals.value.total
}

// ── Save, release ────────────────────────────────────────────────────────────
function validate(forRelease: boolean): boolean {
  const e: Record<string, string> = {}
  form.lines.forEach((l, i) => {
    if (!isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    if (!/^\d+(\.\d{1,4})?$/.test(l.unitPrice)) e[`lines[${i}].unitPrice`] = 'Enter the price including tax.'
  })
  if (form.amountReceived && !/^\d+(\.\d{1,2})?$/.test(form.amountReceived)) e.amountReceived = 'Amount received must look like 550.00.'
  if (forRelease) {
    if (!form.lines.length) e.lines = 'Add at least one item.'
    if (Number(balance.value) > 0) e.amountReceived = `Amount received must cover the amount to pay (${totals.value.total}).`
    if (form.ownEInvoice && !form.buyerName.trim()) e.buyerName = 'An own e-Invoice needs the buyer’s name.'
    if (form.ownEInvoice && !form.buyerTin.trim()) e.buyerTin = 'An own e-Invoice needs the buyer’s TIN.'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(forRelease = false): Promise<CashSaleDetail | null> {
  if (!validate(forRelease)) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const body = {
      docDate: form.docDate || undefined, buyerName: form.buyerName, buyerPhone: form.buyerPhone, buyerTin: form.buyerTin, ownEInvoice: form.ownEInvoice,
      paymentMethod: form.paymentMethod, paymentRef: form.paymentRef, amountReceived: form.amountReceived || '0',
      lines: form.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty, unitPrice: l.unitPrice })),
    }
    const result = isNew.value ? await salesCashSalesApi.create(body) : await salesCashSalesApi.update(cs.value!.id, { ...body, version: cs.value!.version })
    if (isNew.value) await router.replace(`/sales/cash-sales/${result.id}`)
    fill(result)
    if (!forRelease) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
    return null
  } finally {
    saving.value = false
  }
}

async function takePayment() {
  if ((dirty.value || isNew.value) && !(await save(true))) return
  if (!validate(true)) return
  const c = cs.value!
  confirm.require({
    header: `Take ${formatRm(c.totals.total)} and release ${c.docNo}?`,
    message: `${method.value.label}${Number(change.value) ? `, change ${formatRm(change.value)}` : ''}. The sale, the payment and the stock going out are recorded at once.`,
    acceptLabel: 'Take payment and release',
    rejectLabel: 'Cancel',
    accept: async () => {
      saving.value = true
      try {
        fill(await salesCashSalesApi.release(c.id, c.version))
        toast.add({ severity: 'success', summary: `${c.docNo} released`, detail: Number(cs.value!.change) ? `Give change ${formatRm(cs.value!.change)}.` : 'Paid in full.', life: 4500 })
      } catch (error) {
        if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
      } finally {
        saving.value = false
      }
    },
  })
}

function deleteDraft() {
  const c = cs.value!
  confirm.require({
    header: `Delete ${c.docNo}?`,
    message: `The draft is removed. Its number ${c.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesCashSalesApi.remove(c.id, c.version)
      toast.add({ severity: 'success', summary: `${c.docNo} deleted`, life: 3000 })
      void router.push('/sales/cash-sales')
    },
  })
}

const released = computed(() => cs.value?.status === 'RELEASED')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="isNew ? 'New cash sale' : `Cash sale ${cs?.docNo ?? ''}`" document>
      <template #chip><StatusChip :status="cs?.status ?? 'DRAFT'" :label="released ? 'Released' : 'Draft'" :group="released ? 'done' : 'draft'" /></template>
      <template #subtitle>Walk-in customer · {{ cs?.counterName ?? 'showroom counter' }}</template>
      <template #actions>
        <RouterLink v-if="!editable" to="/sales/cash-sales" class="erp-btn erp-btn-secondary">Back</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || (!isNew && !dirty)" @click="save(false)">Save draft</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || (!isNew && !can('release'))" @click="takePayment">Take payment and release</button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="released && cs">
        <span class="inline-flex items-center gap-2">
          <Lock :size="14" aria-hidden="true" />Released. Paid {{ formatRm(cs.amountReceived) }}<template v-if="Number(cs.change)">, change {{ formatRm(cs.change) }}</template>.
          {{ cs.ownEInvoice ? 'Own e-Invoice is queued for LHDN.' : `In the consolidated e-Invoice due ${formatDate(cs.consolidatedDue ?? '')}.` }}
        </span>
      </NoticeBanner>
      <NoticeBanner v-if="cs?.stockWarning && !released" kind="warning">Stock now: {{ cs.stockWarning }}. Short stock only warns at the counter; Inventory is not connected yet.</NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField label="Customer · C-CASH"><div class="erp-input-ro">Cash customer (walk-in)</div></FormField>
            <FormField label="Sale date" for="cs-date">
              <DatePicker v-if="editable" input-id="cs-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Tax mode"><div class="erp-input-ro">Inclusive</div></FormField>
            <FormField label="Served by"><div class="erp-input-ro">{{ cs?.servedBy.name ?? user?.name }}</div></FormField>
            <FormField label="Buyer name (optional)" :error="errors.buyerName" for="cs-buyer">
              <input v-if="editable" id="cs-buyer" v-model="form.buyerName" class="erp-input" maxlength="100" />
              <div v-else class="erp-input-ro">{{ form.buyerName || 'Walk-in' }}</div>
            </FormField>
            <FormField label="Buyer phone (optional)" for="cs-phone">
              <input v-if="editable" id="cs-phone" v-model="form.buyerPhone" class="erp-input" maxlength="30" />
              <div v-else class="erp-input-ro">{{ form.buyerPhone || '—' }}</div>
            </FormField>
            <FormField class="col-span-2" label="Buyer wants own e-Invoice?" for="cs-own">
              <select v-if="editable" id="cs-own" v-model="form.ownEInvoice" class="erp-input">
                <option :value="false">No, include in the monthly consolidated e-Invoice</option>
                <option :value="true">Yes, issue an own e-Invoice (name and TIN needed)</option>
              </select>
              <div v-else class="erp-input-ro">{{ cs?.eInvoice }}</div>
            </FormField>
            <FormField v-if="form.ownEInvoice" label="Buyer TIN" :error="errors.buyerTin" for="cs-tin">
              <input v-if="editable" id="cs-tin" v-model="form.buyerTin" class="erp-input" maxlength="30" />
              <div v-else class="erp-input-ro">{{ form.buyerTin || '—' }}</div>
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <div class="flex items-center justify-between gap-3">
              <h2 class="m-0 text-[15px] font-bold">Items</h2>
              <div v-if="editable" class="flex gap-2">
                <input v-model="scan" class="erp-input w-[280px]" placeholder="Scan barcode or type item code" aria-label="Scan barcode or type item code" @keydown.enter.prevent="onScan" />
                <button type="button" class="erp-btn erp-btn-secondary" @click="pickerOpen = true">Search items</button>
              </div>
            </div>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
            <table class="erp-table">
              <thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Price incl. tax</th><th>Tax</th><th class="num">Amount</th><th v-if="editable" aria-label="Remove" /></tr></thead>
              <tbody>
                <tr v-if="!form.lines.length"><td :colspan="editable ? 7 : 6" class="text-center text-erp-muted">Scan an item or click Search items.</td></tr>
                <tr v-for="(l, i) in form.lines" :key="l.key">
                  <td class="font-bold whitespace-nowrap">{{ l.itemCode }}</td>
                  <td>{{ l.itemName }}</td>
                  <td class="num w-[90px]">
                    <input v-if="editable" v-model="l.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, ${l.itemCode}`" />
                    <template v-else>{{ formatQty(l.qty) }}</template>
                  </td>
                  <td class="num w-[120px]">
                    <input v-if="editable" v-model="l.unitPrice" class="erp-cell min-w-[80px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])" :aria-label="`Price incl. tax, ${l.itemCode}`" />
                    <template v-else>{{ formatPrice(l.unitPrice) }}</template>
                  </td>
                  <td class="whitespace-nowrap">{{ l.taxName }} incl.</td>
                  <td class="num"><MoneyText :value="editable ? (previews[i]?.amount ?? null) : (cs?.lines[i]?.amount ?? null)" /></td>
                  <td v-if="editable" class="w-8">
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove ${l.itemCode}`" @click="form.lines.splice(i, 1)"><X :size="14" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Payment</h2>
            <div class="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Payment method">
              <button
                v-for="m in METHODS"
                :key="m.value"
                type="button"
                role="radio"
                :aria-checked="form.paymentMethod === m.value"
                :disabled="!editable"
                class="cursor-pointer rounded-[10px] border px-3 py-3 text-[13px] font-bold"
                :class="form.paymentMethod === m.value ? 'border-2 border-mod-primary bg-mod-light text-mod-accent' : 'border-erp-border bg-erp-card text-erp-text'"
                @click="pickMethod(m.value)"
              >
                {{ m.label }}
              </button>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <FormField label="Amount received (RM)" :error="errors.amountReceived" for="cs-received">
                <input v-if="editable" id="cs-received" v-model="form.amountReceived" class="erp-input text-right font-bold" inputmode="decimal" :placeholder="totals.total" :aria-invalid="Boolean(errors.amountReceived)" />
                <div v-else class="erp-input-ro text-right font-bold">{{ formatPrice(form.amountReceived || '0') }}</div>
              </FormField>
              <FormField v-if="method.ref" :label="method.ref" for="cs-ref">
                <input v-if="editable" id="cs-ref" v-model="form.paymentRef" class="erp-input" maxlength="60" />
                <div v-else class="erp-input-ro">{{ form.paymentRef || '—' }}</div>
              </FormField>
              <div v-else />
              <FormField label="Change (RM)"><div class="erp-input-ro text-right">{{ released ? formatPrice(cs?.change ?? '0') : formatPrice(change) }}</div></FormField>
            </div>
          </section>

          <ActivityList v-if="cs" :items="cs.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <SideCard title="Totals (MYR)">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Before tax</span><MoneyText :value="totals.beforeTax" /></div>
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Tax included ({{ totals.taxName }})</span><MoneyText :value="totals.tax" /></div>
              <div v-if="Number(totals.rounding)" class="flex justify-between py-[5px]"><span class="text-erp-muted">Rounding</span><MoneyText :value="totals.rounding" /></div>
              <div class="flex justify-between border-t border-erp-row pt-2 text-lg font-bold"><span>To pay</span><MoneyText :value="totals.total" /></div>
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Paid by {{ method.label.toLowerCase() }}</span><MoneyText :value="released ? (cs?.amountReceived ?? '0.00') : received" /></div>
              <div class="flex justify-between py-[5px] font-bold" :class="Number(released ? cs?.balance : balance) > 0 ? 'text-note-error-text' : 'text-chip-done-text'">
                <span>Balance</span><MoneyText :value="released ? (cs?.balance ?? '0.00') : balance" />
              </div>
            </div>
          </SideCard>

          <NextSteps title="One document, three results">
            <li><span>Records the sale, with tax included in the price.</span></li>
            <li><span>Records the payment, so nothing is owed.</span></li>
            <li><span>Stock goes out at once. The event is saved for Inventory.</span></li>
            <template #footer><p class="m-0 text-xs text-erp-muted">No credit check: the customer pays on the spot. Receipt prints on release.</p></template>
          </NextSteps>
        </aside>
      </div>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${cs?.docNo ?? 'New cash sale'} · walk-in customer · prices shown before tax`"
      customer-code="C-CASH"
      :branch-code="cs?.branchCode ?? user?.branchCodes[0] ?? null"
      branch-name="the showroom"
      :on-lines="Object.fromEntries(form.lines.map((l, n) => [l.itemCode, n + 1]))"
      @add="(picked) => picked.forEach((p) => addItem(p.item, p.qty))"
    />
  </template>
</template>
