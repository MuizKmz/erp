<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Check, Lock, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
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
import { previewSaleLine, subMoney, sumMoney } from '@/utils/money'
import { salesFilesApi, salesReturnsApi } from '../api/sales'
import { docRoute } from '../routes'
import type { ReturnAction, ReturnDetail, ReturnInvoiceView } from '../types'

/** S28 · Sales return (SalesReturn.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const sr = ref<ReturnDetail | null>(null)
const invoice = ref<ReturnInvoiceView | null>(null)
const reasons = ref<string[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const form = reactive({ docDate: '', reason: '', location: '', creditMethod: 'CREDIT_NOTE' as 'CREDIT_NOTE' | 'REFUND', customerRef: '', note: '', qty: {} as Record<string, string> })

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plain = (v: string) => formatQty(v).replace(/,/g, '')
const CREDIT_METHODS = [
  { value: 'CREDIT_NOTE', label: 'Credit note to customer account' },
  { value: 'REFUND', label: 'Refund through Finance' },
]

const saved = ref('')
const dirty = computed(() => JSON.stringify(form) !== saved.value)
const can = (a: ReturnAction) => (isNew.value ? a === 'edit' : Boolean(sr.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))

function fill(r: ReturnDetail) {
  sr.value = r
  invoice.value = r.invoice
  reasons.value = r.reasons
  Object.assign(form, {
    docDate: r.docDate, reason: r.reason, location: r.location ?? '', creditMethod: r.creditMethod, customerRef: r.customerRef ?? '', note: r.note ?? '',
    qty: Object.fromEntries(r.invoice.lines.map((l) => [l.invoiceLineId, plain(r.lines.find((x) => x.invoiceLineId === l.invoiceLineId)?.qty ?? '0')])),
  })
  saved.value = JSON.stringify(form)
  errors.value = {}
  setCrumb(r.docNo)
}

onMounted(async () => {
  loading.value = true
  try {
    if (isNew.value) {
      const invoiceId = typeof route.query.invoice === 'string' ? route.query.invoice : ''
      const [view, meta] = await Promise.all([invoiceId ? salesReturnsApi.invoiceLines(invoiceId) : Promise.resolve(null), salesReturnsApi.list({ pageSize: 1 })])
      invoice.value = view
      reasons.value = meta.reasons
      form.docDate = today.value
      form.location = view?.locations[0]?.key ?? ''
      form.qty = Object.fromEntries((view?.lines ?? []).map((l) => [l.invoiceLineId, '0']))
      setCrumb('New return')
    } else {
      fill(await salesReturnsApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
})

// ── Preview and checks ───────────────────────────────────────────────────────
const lineRows = computed(() => {
  if (sr.value && !editable.value) return sr.value.lines.map((l) => ({ key: l.id, itemCode: l.itemCode, itemName: l.itemName, invoicedQty: l.invoicedQty, returnedQty: l.returnedBeforeQty, maxQty: l.maxQty, qty: l.qty, unitPrice: l.unitPrice, credit: l.amount, lineId: null as string | null }))
  return (invoice.value?.lines ?? []).map((l) => {
    const qty = form.qty[l.invoiceLineId] || '0'
    const p = previewSaleLine(qty, l.grossPrice, l.discountPct, l.taxRate)
    return { key: l.invoiceLineId, itemCode: l.itemCode, itemName: l.itemName, invoicedQty: l.invoicedQty, returnedQty: l.returnedQty, maxQty: l.maxQty, qty, unitPrice: l.unitPrice, credit: p?.amount ?? '0.00', lineId: l.invoiceLineId }
  })
})
const credit = computed(() => {
  if (sr.value && !editable.value) return sr.value.totals
  const parts = (invoice.value?.lines ?? []).map((l) => previewSaleLine(form.qty[l.invoiceLineId] || '0', l.grossPrice, l.discountPct, l.taxRate))
  const subtotal = sumMoney(parts.map((p) => p?.amount ?? '0'))
  const tax = sumMoney(parts.map((p) => p?.taxAmount ?? '0'))
  return { subtotal, tax, total: sumMoney([subtotal, tax]) }
})
const totalQty = computed(() => lineRows.value.reduce((s, l) => s + Number(l.qty || 0), 0))
const totalMax = computed(() => lineRows.value.reduce((s, l) => s + Number(l.maxQty), 0))
const location = computed(() => invoice.value?.locations.find((l) => l.key === form.location) ?? null)
const checks = computed(() => {
  if (sr.value && !editable.value) return sr.value.checks
  const qtyOk = totalQty.value > 0 && lineRows.value.every((l) => Number(l.qty || 0) <= Number(l.maxQty))
  return [
    { key: 'qty', ok: qtyOk, text: `Return qty ${formatQty(String(totalQty.value))} is within ${formatQty(String(totalMax.value))} invoiced` },
    { key: 'customer', ok: Boolean(invoice.value?.customer.active), text: invoice.value?.customer.active ? 'Customer is active in Master Data' : 'Customer is not active in Master Data' },
    { key: 'location', ok: Boolean(location.value), text: location.value ? `Return location exists at ${location.value.placeName}` : 'Pick where the goods go back to' },
    { key: 'reason', ok: Boolean(form.reason.trim()), text: form.reason.trim() ? 'A reason is given' : 'Give a reason' },
  ]
})
const allOk = computed(() => checks.value.every((c) => c.ok))
const afterReturn = computed(() => (invoice.value ? subMoney(invoice.value.balance, credit.value.total) : '0.00'))

// ── Save, release ────────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  ;(invoice.value?.lines ?? []).forEach((l, i) => {
    const v = form.qty[l.invoiceLineId] ?? '0'
    if (!/^\d+(\.\d{1,4})?$/.test(v)) e[`lines[${i}].qty`] = 'Enter a quantity like 5.'
    else if (Number(v) > Number(l.maxQty)) e[`lines[${i}].qty`] = `Return now cannot be more than invoiced minus earlier returns (${formatQty(l.maxQty)}).`
  })
  if (!Object.keys(e).length && totalQty.value <= 0) e.lines = 'Enter a quantity to return on at least one line.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<ReturnDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const lines = (invoice.value?.lines ?? []).map((l) => ({ invoiceLineId: l.invoiceLineId, qty: form.qty[l.invoiceLineId] || '0' }))
    const fields = { reason: form.reason, docDate: form.docDate || undefined, location: form.location || undefined, creditMethod: form.creditMethod, customerRef: form.customerRef, note: form.note }
    const result = isNew.value
      ? await salesReturnsApi.create({ ...fields, invoiceId: invoice.value!.id!, lines })
      : await salesReturnsApi.update(sr.value!.id, { ...fields, version: sr.value!.version, lines })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 3000 })
    if (isNew.value) await router.replace(`/sales/returns/${result.id}`)
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
  const r = sr.value!
  confirm.require({
    header: `Release ${r.docNo}?`,
    message: `${formatQty(String(totalQty.value))} back to ${location.value?.label ?? 'the return location'}. ${r.invoice.no} is credited ${formatRm(r.totals.total)} and a credit note is queued for Finance and LHDN.`,
    acceptLabel: 'Release return',
    rejectLabel: 'Cancel',
    accept: async () => {
      saving.value = true
      try {
        fill(await salesReturnsApi.release(r.id, r.version))
        toast.add({ severity: 'success', summary: `${r.docNo} released`, detail: `${r.invoice.no} balance drops by ${formatRm(r.totals.total)}.`, life: 4000 })
      } finally {
        saving.value = false
      }
    },
  })
}

function deleteDraft() {
  const r = sr.value!
  confirm.require({
    header: `Delete ${r.docNo}?`,
    message: `The draft is removed. Its number ${r.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesReturnsApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      void router.push('/sales/returns')
    },
  })
}

async function upload(file: File) {
  const r = sr.value!
  const f = await salesFilesApi.upload(file, 'RETURN_PHOTO', 'SAL_RETURN', r.id)
  r.attachments = [...r.attachments, { id: f.id, fileName: f.fileName, mimeType: f.mimeType, downloadUrl: f.downloadUrl }]
}

const released = computed(() => sr.value?.status === 'RELEASED')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <div v-else-if="isNew && !invoice" class="erp-card flex flex-col items-start gap-3 px-6 py-8 text-[13px]">
    <strong>Pick the invoice first</strong>
    <span class="text-erp-subtle">A return always comes from one released invoice. Open Sales Return and click New return, or use Transfer to › Sales return on the invoice.</span>
    <RouterLink to="/sales/returns" class="erp-btn erp-btn-secondary">Go to Sales Return</RouterLink>
  </div>

  <template v-else-if="invoice">
    <PageHeader :title="isNew ? 'New sales return' : `Sales return ${sr?.docNo ?? ''}`" document>
      <template #chip><StatusChip :status="sr?.status ?? 'DRAFT'" :label="released ? 'Released' : 'Draft'" :group="released ? 'done' : 'draft'" /></template>
      <template #subtitle>
        From invoice
        <RouterLink v-if="invoice.id && !invoice.isMigrated" :to="`/sales/invoices/${invoice.id}`" class="erp-link">{{ invoice.no }}</RouterLink>
        <template v-else>{{ invoice.no }}</template>
        · {{ invoice.customer.name }}
      </template>
      <template #actions>
        <RouterLink to="/sales/returns" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || (!isNew && !dirty)" @click="save">Save draft</button>
        <button
          v-if="!released && !isNew"
          type="button"
          class="erp-btn erp-btn-primary"
          :disabled="saving || !can('release') || !allOk"
          :title="hasPermission('sales.return.receive') ? undefined : 'The store team confirms that the goods came back (sales.return.receive).'"
          @click="release"
        >
          Release return
        </button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="released && sr">
        <span class="inline-flex items-center gap-2"><Lock :size="14" aria-hidden="true" />Released. {{ sr.invoice.no }} was credited {{ formatRm(sr.totals.total) }}; the credit note waits for Finance and LHDN.</span>
      </NoticeBanner>
      <NoticeBanner v-else-if="sr && !hasPermission('sales.return.receive')" kind="warning">Saved as a draft. The store team releases it once the goods are back.</NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField :label="`Customer · ${invoice.customer.code}`"><div class="erp-input-ro truncate">{{ invoice.customer.name }}</div></FormField>
            <FormField label="Return date" for="sr-date">
              <DatePicker v-if="editable" input-id="sr-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Reason" for="sr-reason">
              <select v-if="editable" id="sr-reason" v-model="form.reason" class="erp-input">
                <option value="" disabled>Pick a reason</option>
                <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ form.reason }}</div>
            </FormField>
            <FormField label="Return goods to" :error="errors.location" for="sr-loc">
              <select v-if="editable" id="sr-loc" v-model="form.location" class="erp-input">
                <option value="" disabled>Pick a location</option>
                <option v-for="l in invoice.locations" :key="l.key" :value="l.key">{{ l.label }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ sr?.locationLabel }}</div>
            </FormField>
            <FormField label="Credit method" for="sr-method">
              <select v-if="editable" id="sr-method" v-model="form.creditMethod" class="erp-input">
                <option v-for="m in CREDIT_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
              <div v-else class="erp-input-ro truncate">{{ CREDIT_METHODS.find((m) => m.value === form.creditMethod)?.label }}</div>
            </FormField>
            <FormField label="Customer reference" for="sr-ref">
              <input v-if="editable" id="sr-ref" v-model="form.customerRef" class="erp-input" maxlength="50" />
              <div v-else class="erp-input-ro">{{ form.customerRef || '—' }}</div>
            </FormField>
            <FormField class="col-span-3" label="Note" for="sr-note">
              <input v-if="editable" id="sr-note" v-model="form.note" class="erp-input" maxlength="2000" />
              <div v-else class="erp-input-ro">{{ form.note || '—' }}</div>
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">What is coming back</h2>
            <table class="erp-table">
              <thead><tr><th>Item</th><th class="num">Invoiced</th><th class="num">Returned before</th><th class="num">Max return</th><th class="num">Return now</th><th class="num">Unit price</th><th class="num">Credit</th></tr></thead>
              <tbody>
                <tr v-for="(l, i) in lineRows" :key="l.key">
                  <td><div class="font-bold whitespace-nowrap">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                  <td class="num">{{ formatQty(l.invoicedQty) }}</td>
                  <td class="num">{{ formatQty(l.returnedQty) }}</td>
                  <td class="num">{{ formatQty(l.maxQty) }}</td>
                  <td class="num w-[110px]">
                    <input
                      v-if="editable && l.lineId"
                      v-model="form.qty[l.lineId]"
                      class="erp-cell min-w-[80px] border-2 border-mod-primary font-bold"
                      inputmode="decimal"
                      :disabled="Number(l.maxQty) <= 0"
                      :aria-invalid="Boolean(errors[`lines[${i}].qty`])"
                      :aria-label="`Return now, ${l.itemCode}`"
                    />
                    <span v-else class="font-bold">{{ formatQty(l.qty) }}</span>
                  </td>
                  <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                  <td class="num"><MoneyText :value="l.credit" /></td>
                </tr>
              </tbody>
            </table>
            <p v-for="(msg, key) in errors" v-show="String(key).startsWith('lines')" :key="key" class="m-0 text-xs font-medium text-note-error-text">{{ msg }}</p>
            <p class="m-0 text-xs text-erp-muted">You can never return more than was invoiced, minus earlier returns.</p>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Photos and documents</h2>
            <FileTiles v-if="sr" :files="sr.attachments" :editable="can('attach')" :upload="upload" add-label="+ Add" />
            <p v-else class="m-0 text-[13px] text-erp-muted">Save the draft first, then add photos of the returned goods.</p>
          </section>

          <section v-if="!released" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Checks before release</h2>
            <div class="grid grid-cols-2 gap-3">
              <div
                v-for="c in checks"
                :key="c.key"
                class="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px]"
                :class="c.ok ? 'bg-chip-done-bg text-chip-done-text' : 'bg-note-error-bg text-note-error-text'"
              >
                <Check v-if="c.ok" :size="15" :stroke-width="2.5" aria-label="Met" /><X v-else :size="15" :stroke-width="2.5" aria-label="Not met" />{{ c.text }}
              </div>
            </div>
          </section>

          <ActivityList v-if="sr" :items="sr.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <SideCard title="Credit (MYR)">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Goods</span><MoneyText :value="credit.subtotal" /></div>
              <div class="flex justify-between py-[5px]"><span class="text-erp-muted">Tax</span><MoneyText :value="credit.tax" /></div>
              <div class="flex justify-between border-t border-erp-row pt-2 text-lg font-bold"><span>Credit total</span><MoneyText :value="credit.total" /></div>
            </div>
          </SideCard>

          <NextSteps v-if="!released" title="When you release">
            <li><span>{{ invoice.no }} balance due drops by {{ formatRm(credit.total) }}.</span></li>
            <li><span>{{ formatQty(String(totalQty)) }} {{ totalQty === 1 ? 'unit goes' : 'units go' }} into {{ location?.goodsTo === 'STOCK' ? 'sellable stock' : 'Damaged goods' }}. The event is saved for Inventory.</span></li>
            <li><span>A credit note is queued for Finance and for LHDN e-Invoice, referencing {{ invoice.no }}.</span></li>
          </NextSteps>

          <SideCard :title="`Original invoice ${invoice.no}`">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">Invoice date</span><span>{{ formatDate(invoice.docDate ?? '') || '—' }}</span></div>
              <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">Invoice total</span><span class="erp-num">{{ formatRm(invoice.total) }}</span></div>
              <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">Paid so far</span><span class="erp-num">{{ formatRm(invoice.paid) }}</span></div>
              <div class="flex justify-between border-b border-erp-row py-[6px]"><span class="text-erp-muted">Balance due now</span><span class="erp-num">{{ formatRm(invoice.balance) }}</span></div>
              <div v-if="!released" class="flex justify-between py-[6px] font-bold"><span>After this return</span><span class="erp-num">{{ formatRm(afterReturn) }}</span></div>
            </div>
            <RouterLink v-if="invoice.id && !invoice.isMigrated" :to="`/sales/invoices/${invoice.id}`" class="erp-link text-[13px] font-semibold">Open invoice →</RouterLink>
          </SideCard>

          <LinkedDocs v-if="sr && sr.links.length" :docs="sr.links" :route-of="docRoute" />
        </aside>
      </div>
    </div>
  </template>
</template>
