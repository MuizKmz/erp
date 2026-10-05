<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { formatDate, formatMoney, formatPrice, formatQty, formatRm } from '@/utils/format'
import { devFinanceApi, salesProformasApi } from '../api/sales'
import { docRoute } from '../routes'
import type { ProformaAction, ProformaDetail, ProformaRequestKind, ProformaStatus } from '../types'

/** S22 · Proforma invoice (ProformaForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()

const pf = ref<ProformaDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const form = reactive({ docDate: '', payBy: '', attention: '', requestKind: 'DEPOSIT_PCT' as ProformaRequestKind, depositPct: '', note: '' })

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

const saved = ref('')
const dirty = computed(() => JSON.stringify(form) !== saved.value)
const can = (a: ProformaAction) => Boolean(pf.value?.allowedActions.includes(a))
const editable = computed(() => can('edit'))

function show(p: ProformaDetail) {
  pf.value = p
  Object.assign(form, {
    docDate: p.docDate,
    payBy: p.payBy ?? '',
    attention: p.attention ?? '',
    requestKind: p.requestKind,
    depositPct: p.depositPct ?? '',
    note: p.note ?? '',
  })
  saved.value = JSON.stringify(form)
  errors.value = {}
  setCrumb(p.docNo)
}

onMounted(async () => {
  loading.value = true
  try {
    show(await salesProformasApi.get(String(route.params.id)))
  } finally {
    loading.value = false
  }
})

/** Preview of the deposit while editing; the server works out the amount on save. */
const depositPreview = computed(() => {
  const p = pf.value
  if (!p) return null
  if (form.requestKind === 'PAY_BEFORE_RELEASE') return { amount: p.orderValue.total, label: '(100%)' }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(form.depositPct)) return null
  const cents = Math.round(Number(p.orderValue.total) * 100 * Number(form.depositPct)) / 100
  return { amount: (Math.round(cents) / 100).toFixed(2), label: `(${Number(form.depositPct)}%)` }
})
const shownDeposit = computed(() => (editable.value && dirty.value ? depositPreview.value : pf.value ? { amount: pf.value.amount, label: pf.value.requestKind === 'PAY_BEFORE_RELEASE' ? '(100%)' : `(${Number(pf.value.depositPct)}%)` } : null))

async function save(): Promise<ProformaDetail | null> {
  const p = pf.value!
  const e: Record<string, string> = {}
  if (form.requestKind === 'DEPOSIT_PCT' && !depositPreview.value) e.depositPct = 'Deposit % must be a number like 30.'
  if (form.payBy && form.docDate && form.payBy < form.docDate) e.payBy = 'Pay by cannot be before the proforma date.'
  errors.value = e
  if (Object.keys(e).length) return null
  saving.value = true
  try {
    const result = await salesProformasApi.update(p.id, {
      version: p.version,
      docDate: form.docDate || undefined,
      payBy: form.payBy || undefined,
      attention: form.attention,
      requestKind: form.requestKind,
      depositPct: form.requestKind === 'DEPOSIT_PCT' ? form.depositPct : undefined,
      note: form.note,
    })
    show(result)
    toast.add({ severity: 'success', summary: 'Draft saved', life: 2500 })
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
  const p = pf.value!
  confirm.require({
    header: `Release ${p.docNo}?`,
    message: `The proforma asks ${p.customer.name} for ${formatRm(p.amount)} by ${formatDate(p.payBy ?? '')}. Delivery of ${p.order.no} waits until Finance records the payment.`,
    acceptLabel: 'Release',
    rejectLabel: 'Cancel',
    accept: async () => {
      show(await salesProformasApi.release(p.id, p.version))
      toast.add({ severity: 'success', summary: `${p.docNo} sent`, detail: 'Email it to the customer so they can pay.', life: 4000 })
    },
  })
}

async function email() {
  const p = pf.value!
  const result = await salesProformasApi.email(p.id)
  toast.add({ severity: 'success', summary: 'Sent', detail: `${p.docNo} emailed to ${result.sentTo}.`, life: 4000 })
  show(await salesProformasApi.get(p.id))
}

function cancelProforma() {
  const p = pf.value!
  confirm.require({
    header: `Cancel ${p.docNo}?`,
    message: `The deposit request is withdrawn and ${p.order.no} no longer waits for it. Make a new proforma if the customer still has to pay first.`,
    acceptLabel: 'Cancel proforma',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      show(await salesProformasApi.cancel(p.id, p.version))
      toast.add({ severity: 'success', summary: `${p.docNo} cancelled`, life: 3000 })
    },
  })
}

function deleteDraft() {
  const p = pf.value!
  confirm.require({
    header: `Delete ${p.docNo}?`,
    message: `The draft is removed. Its number ${p.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesProformasApi.remove(p.id, p.version)
      toast.add({ severity: 'success', summary: `${p.docNo} deleted`, life: 3000 })
      void router.push('/sales/proformas')
    },
  })
}

/** Dev only: Finance is not connected, so this stands in for Finance recording the deposit. */
async function recordPayment() {
  const p = pf.value!
  const due = (Number(p.amount) - Number(p.received)).toFixed(2)
  const r = await devFinanceApi.recordReceipt({ appliesToType: 'PROFORMA', appliesToNo: p.docNo, customerCode: p.customer.code, amount: due })
  toast.add({ severity: 'success', summary: `Receipt ${r.receiptNo} recorded`, detail: `RM ${formatMoney(r.amount)} against ${p.docNo} (Finance stub).`, life: 4000 })
  show(await salesProformasApi.get(p.id))
}

function printLater() {
  toast.add({ severity: 'info', summary: 'Print', detail: 'The printed proforma comes with the print layouts in Document Types.', life: 3000 })
}

const GROUP: Record<ProformaStatus, 'draft' | 'released' | 'done' | 'partial' | 'cancelled'> = { DRAFT: 'draft', SENT: 'released', PAID: 'done', USED: 'partial', CANCELLED: 'cancelled' }
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="pf">
    <PageHeader :title="`Proforma invoice ${pf.docNo}`" document>
      <template #chip><StatusChip :status="pf.status" :label="pf.label" :group="GROUP[pf.status]" /></template>
      <template #subtitle>
        {{ pf.customer.name }} · from
        <RouterLink v-if="pf.order.id" :to="`/sales/orders/${pf.order.id}`" class="erp-link">{{ pf.order.no }}</RouterLink>
        <template v-else>{{ pf.order.no }}</template>
        · {{ pf.requestKind === 'PAY_BEFORE_RELEASE' ? 'pay before release' : 'deposit request' }}
      </template>
      <template #actions>
        <RouterLink v-if="!editable" to="/sales/proformas" class="erp-btn erp-btn-secondary">Back</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button v-if="can('cancel')" type="button" class="erp-btn erp-btn-danger" :disabled="saving" @click="cancelProforma">Cancel proforma</button>
        <button type="button" class="erp-btn erp-btn-secondary" @click="printLater">Print</button>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!can('email')" :title="can('email') ? undefined : 'Release the proforma before emailing it.'" @click="email">Email to customer</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || !dirty" @click="save">Save draft</button>
        <button v-if="pf.status === 'DRAFT'" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !can('release')" @click="release">Release</button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner>
        <strong>A proforma is only a payment request.</strong> It is not a tax invoice: nothing is posted to accounts, nothing goes to LHDN, and the order balance does not change.
      </NoticeBanner>
      <NoticeBanner v-if="pf.status === 'SENT'" kind="warning">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span>Waiting for {{ formatRm((Number(pf.amount) - Number(pf.received)).toFixed(2)) }} by {{ formatDate(pf.payBy ?? '') }}. Delivery of {{ pf.order.no }} is on hold until Finance records the payment.</span>
          <button type="button" class="erp-btn erp-btn-secondary" title="Dev only: stands in for Finance until it is connected" @click="recordPayment">Record payment (Finance stub)</button>
        </div>
      </NoticeBanner>
      <NoticeBanner v-else-if="pf.status === 'PAID'">Paid {{ formatRm(pf.received) }}. Delivery can go ahead; the deposit is knocked off the next invoice of {{ pf.order.no }}.</NoticeBanner>
      <NoticeBanner v-else-if="pf.status === 'USED'">The deposit of {{ formatRm(pf.amount) }} was knocked off {{ pf.usedOnInvoice }}<template v-if="pf.usedAt"> on {{ formatDate(pf.usedAt.slice(0, 10)) }}</template>.</NoticeBanner>
      <NoticeBanner v-else-if="pf.status === 'CANCELLED'" kind="error">Cancelled. {{ pf.order.no }} no longer waits for this deposit.</NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField :label="`Customer · ${pf.customer.code}`"><div class="erp-input-ro truncate">{{ pf.customer.name }}</div></FormField>
            <FormField label="Proforma date" for="pf-date">
              <DatePicker v-if="editable" input-id="pf-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Pay by" :error="errors.payBy" for="pf-payby">
              <DatePicker v-if="editable" input-id="pf-payby" :model-value="isoToDate(form.payBy)" :min-date="isoToDate(form.docDate) ?? undefined" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.payBy = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.payBy) || '—' }}</div>
            </FormField>
            <FormField label="Currency"><div class="erp-input-ro">{{ pf.currency }}</div></FormField>
            <FormField label="Attention" for="pf-attn">
              <input v-if="editable" id="pf-attn" v-model="form.attention" class="erp-input" maxlength="100" />
              <div v-else class="erp-input-ro">{{ form.attention || '—' }}</div>
            </FormField>
            <FormField label="Request" for="pf-kind">
              <select v-if="editable" id="pf-kind" v-model="form.requestKind" class="erp-input">
                <option value="DEPOSIT_PCT">Deposit, % of order</option>
                <option value="PAY_BEFORE_RELEASE">Pay before release</option>
              </select>
              <div v-else class="erp-input-ro">{{ pf.request }}</div>
            </FormField>
            <FormField label="Deposit %" :error="errors.depositPct" for="pf-pct">
              <input v-if="editable" id="pf-pct" v-model="form.depositPct" class="erp-input text-right" inputmode="decimal" :disabled="form.requestKind === 'PAY_BEFORE_RELEASE'" :aria-invalid="Boolean(errors.depositPct)" />
              <div v-else class="erp-input-ro text-right">{{ pf.depositPct ? Number(pf.depositPct) : '100' }}</div>
            </FormField>
            <FormField label="Sales agent"><div class="erp-input-ro">{{ pf.agent.name }}</div></FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Order lines · copied from {{ pf.order.no }}</h2>
            <div class="overflow-x-auto">
              <table class="erp-table">
                <thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th>Tax</th><th class="num">Amount</th></tr></thead>
                <tbody>
                  <tr v-for="l in pf.lines" :key="l.lineNo">
                    <td class="font-bold whitespace-nowrap">{{ l.itemCode }}</td>
                    <td>{{ l.itemName }}</td>
                    <td class="num whitespace-nowrap">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
                    <td class="num">{{ formatPrice(l.unitPrice) }}<div v-if="Number(l.discountPct)" class="text-xs text-erp-muted">less {{ Number(l.discountPct) }}%</div></td>
                    <td class="whitespace-nowrap">{{ l.taxName }}</td>
                    <td class="num"><MoneyText :value="l.amount" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="erp-card flex flex-col px-5 py-[18px]">
            <h2 class="m-0 mb-2 text-[15px] font-bold">Payment instructions printed on the proforma</h2>
            <div class="grid grid-cols-[160px_1fr] items-center border-b border-erp-row py-2.5 text-[13px]"><span class="text-erp-muted">Pay to</span><span>[Company name and bank account, from Master Data]</span></div>
            <div class="grid grid-cols-[160px_1fr] items-center border-b border-erp-row py-2.5 text-[13px]"><span class="text-erp-muted">Reference</span><span>{{ pf.docNo }} / {{ pf.order.no }}</span></div>
            <div class="grid grid-cols-[160px_1fr] items-center py-2.5 text-[13px]">
              <label class="text-erp-muted" for="pf-note">Note</label>
              <input v-if="editable" id="pf-note" v-model="form.note" class="erp-input" maxlength="2000" />
              <span v-else>{{ form.note || '—' }}</span>
            </div>
          </section>

          <ActivityList :items="pf.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <SideCard title="Order value (MYR)">
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Subtotal</span><MoneyText :value="pf.orderValue.subtotal" /></div>
              <div class="flex justify-between gap-3 py-[5px]"><span class="text-erp-muted">Tax ({{ pf.orderValue.taxName }})</span><MoneyText :value="pf.orderValue.tax" /></div>
              <div class="flex justify-between gap-3 border-t border-erp-row pt-2 font-bold"><span>Order total</span><MoneyText :value="pf.orderValue.total" /></div>
            </div>
            <div class="rounded-lg bg-mod-light px-3 py-2.5 text-[15px] font-bold text-mod-accent">
              Deposit requested <template v-if="shownDeposit">{{ formatMoney(shownDeposit.amount) }} {{ shownDeposit.label }}</template><template v-else>—</template>
            </div>
            <div v-if="Number(pf.received)" class="flex justify-between text-[13px]"><span class="text-erp-muted">Received</span><MoneyText :value="pf.received" /></div>
          </SideCard>

          <SideCard title="What happens with the deposit">
            <p class="m-0 text-[13px] text-erp-subtle">Finance records the receipt against this proforma. When the tax invoice is issued, the deposit is knocked off against it.</p>
          </SideCard>

          <SideCard title="Other proformas · this customer">
            <div v-if="!pf.otherProformas.length" class="flex justify-between text-[13px]"><span>None yet</span><span class="text-erp-muted">New customer</span></div>
            <div v-for="o in pf.otherProformas" :key="o.id" class="flex justify-between gap-2 text-[13px]">
              <RouterLink :to="`/sales/proformas/${o.id}`" class="erp-link">{{ o.docNo }}</RouterLink>
              <span class="erp-num">RM {{ formatMoney(o.amount) }} · {{ o.label }}</span>
            </div>
          </SideCard>

          <LinkedDocs v-if="pf.links.length" :docs="pf.links" :route-of="docRoute" />
        </aside>
      </div>
    </div>
  </template>
</template>
