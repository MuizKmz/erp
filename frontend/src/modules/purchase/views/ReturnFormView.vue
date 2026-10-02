<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
import FormField from '@/components/erp/FormField.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatMoney, formatPrice, formatQty, formatRm, qtyWithUnit } from '@/utils/format'
import { compareQty, isQty, previewLine, subMoney, subQty, sumMoney, sumQty } from '@/utils/money'
import { attachmentsApi, returnsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ReturnAction, ReturnDetail, ReturnOriginals, ReturnTemplate, SettleBy } from '../types'

/** P23 · Purchase return (PurReturn.html, FlowP6 steps 5–8). `/purchase/returns/new?grn=` starts one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const row = ref<ReturnDetail | null>(null)
const template = ref<ReturnTemplate | null>(null)
const receipts = ref<{ id: string; docNo: string; docDate: string; poNo: string; supplierName: string; returnableText: string }[]>([])
const grnId = ref('')
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})

interface FormLine {
  grnLineId: string
  itemCode: string
  itemName: string
  uomCode: string
  taxCode: string
  taxRate: string
  receivedQty: string
  returnedBeforeQty: string
  unitPrice: string
  qty: string
}
const form = reactive({ docDate: '', reason: '', settleBy: 'CREDIT_NOTE' as SettleBy, rmaNo: '', collection: '', remarks: '', lines: [] as FormLine[] })
const newFiles = ref<{ id: string; fileName: string; mimeType: string }[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, files: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)
const plain = (v: string) => formatQty(v).replace(/,/g, '')

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

function fillFromTemplate(t: ReturnTemplate) {
  Object.assign(form, { docDate: t.docDate, reason: t.reasons[0] ?? '', settleBy: 'CREDIT_NOTE', rmaNo: '', collection: '', remarks: '' })
  form.lines = t.lines.map((l) => ({ ...l, grnLineId: l.grnLineId!, qty: '' }))
  newFiles.value = []
  saved.value = snapshot()
}

function show(r: ReturnDetail) {
  row.value = r
  template.value = null
  Object.assign(form, { docDate: r.docDate, reason: r.reason, settleBy: r.settleBy, rmaNo: r.rmaNo ?? '', collection: r.collection ?? '', remarks: r.remarks ?? '' })
  form.lines = r.lines.map((l) => ({ ...l, grnLineId: l.grnLineId ?? '', qty: plain(l.qty) }))
  newFiles.value = []
  saved.value = snapshot()
  setCrumb(r.docNo)
  errors.value = {}
}

async function loadTemplate(value: string) {
  try {
    template.value = await returnsApi.template(value)
    fillFromTemplate(template.value)
  } catch (error) {
    template.value = null
    if (!(error instanceof ApiError)) throw error
  }
}
async function load() {
  loading.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      row.value = null
      template.value = null
      setCrumb('New return')
      receipts.value = (await returnsApi.returnableReceipts()).items
      grnId.value = typeof route.query.grn === 'string' ? route.query.grn : ''
      if (grnId.value) await loadTemplate(grnId.value)
    } else {
      show(await returnsApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())
watch(grnId, (value) => value && isNew.value && value !== template.value?.grn.id && void loadTemplate(value))

const can = (action: ReturnAction) =>
  isNew.value ? action === 'edit' || (action === 'release' && hasPermission('purchase.return.release')) : Boolean(row.value?.allowedActions.includes(action))
const editable = computed(() => isNew.value || can('edit'))
const reasons = computed(() => row.value?.reasons ?? template.value?.reasons ?? [])
const supplier = computed(() => row.value?.supplier ?? template.value?.supplier ?? null)
const originals = computed<ReturnOriginals | null>(() => row.value?.originals ?? template.value?.originals ?? null)
const taxNames = computed(() => row.value?.taxNames ?? template.value?.taxNames ?? {})
const inventoryConnected = computed(() => row.value?.inventoryConnected ?? template.value?.inventoryConnected ?? true)

// ── Values ───────────────────────────────────────────────────────────────────
const returnableOf = (l: FormLine) => subQty(l.receivedQty, l.returnedBeforeQty)
const lineValue = (l: FormLine) => previewLine(isQty(l.qty) ? l.qty : '0', l.unitPrice, l.taxRate)
const goods = computed(() => (editable.value ? sumMoney(form.lines.map((l) => lineValue(l)?.amount ?? '0')) : (row.value?.subtotal ?? '0')))
const taxLines = computed(() => {
  const map = new Map<string, string[]>()
  for (const l of form.lines) map.set(l.taxCode, [...(map.get(l.taxCode) ?? []), editable.value ? (lineValue(l)?.taxAmount ?? '0') : (row.value?.lines.find((x) => x.grnLineId === l.grnLineId)?.taxAmount ?? '0')])
  return [...map].map(([code, amounts]) => ({ code, name: taxNames.value[code] ?? code, amount: sumMoney(amounts) }))
})
const creditTotal = computed(() => sumMoney([goods.value, ...taxLines.value.map((t) => t.amount)]))
const over = computed(() => form.lines.some((l) => (l.qty !== '' && !isQty(l.qty)) || compareQty(l.qty || '0', returnableOf(l)) > 0))
const going = computed(() => form.lines.filter((l) => compareQty(l.qty || '0', '0') > 0))
const goingText = computed(() =>
  going.value.length && new Set(going.value.map((l) => l.uomCode)).size === 1
    ? qtyWithUnit(sumQty(going.value.map((l) => l.qty)), going.value[0]!.uomCode)
    : `${going.value.length} items`,
)
const firstInvoice = computed(() => originals.value?.invoices.find((i) => i.label === 'Approved' || i.label === 'Paid') ?? null)

// ── Files ────────────────────────────────────────────────────────────────────
const files = computed(() => [...(row.value?.attachments ?? []), ...newFiles.value.map((f) => ({ ...f, downloadUrl: `/attachments/${f.id}/download` }))])
async function upload(file: File) {
  const uploaded = await attachmentsApi.upload(file, file.type.startsWith('image/') ? 'PHOTO' : 'RMA')
  newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName, mimeType: file.type })
}

// ── Save, release, delete ────────────────────────────────────────────────────
function body() {
  return {
    reason: form.reason,
    docDate: form.docDate,
    settleBy: form.settleBy,
    rmaNo: form.rmaNo,
    collection: form.collection,
    remarks: form.remarks,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.map((l) => ({ grnLineId: l.grnLineId, qty: l.qty || '0' })),
  }
}

async function save(quiet = false): Promise<ReturnDetail | null> {
  if (isNew.value && !template.value) {
    errors.value = { grnId: 'Pick the goods receipt the goods came in on.' }
    return null
  }
  if (over.value) {
    errors.value = { lines: 'You can never return more than was received, minus earlier returns.' }
    return null
  }
  busy.value = true
  try {
    const result = isNew.value
      ? await returnsApi.create({ ...body(), grnId: template.value!.grn.id, reason: form.reason })
      : await returnsApi.update(row.value!.id, { ...body(), version: row.value!.version })
    if (!quiet) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/returns/${result.id}`)
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
    message: `${current.summary ?? 'The goods'} leave stock and ${current.supplier.name} gets the return notice${current.rmaNo ? ` with RMA ${current.rmaNo}` : ''}. The return is locked.`,
    acceptLabel: 'Release return',
    rejectLabel: 'Not yet',
    accept: async () => {
      busy.value = true
      try {
        const result = await returnsApi.release(current.id, current.version)
        show(result)
        toast.add({ severity: 'success', summary: `${result.docNo} released`, detail: result.settleBy === 'CREDIT_NOTE' ? `${formatRm(result.total)} waits for their credit note.` : 'Waiting for the replacement.', life: 4000 })
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
      await returnsApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/returns')
    },
  })
}

async function remind() {
  const r = row.value
  if (!r) return
  show(await returnsApi.remind(r.id))
  toast.add({ severity: 'success', summary: 'Reminder sent', detail: `${r.supplier.name} gets the return notice again.`, life: 3500 })
}

// ── Settle ───────────────────────────────────────────────────────────────────
const settleOpen = ref(false)
const settleNo = ref('')
const settleError = ref('')
function openSettle() {
  settleNo.value = ''
  settleError.value = ''
  settleOpen.value = true
}
async function settle() {
  const r = row.value
  if (!r) return
  if (!settleNo.value.trim()) {
    settleError.value = r.settleBy === 'CREDIT_NOTE' ? "Enter the supplier's credit note number." : "Enter the supplier's delivery order number."
    return
  }
  busy.value = true
  try {
    const result = r.settleBy === 'CREDIT_NOTE' ? await returnsApi.creditNote(r.id, r.version, settleNo.value.trim()) : await returnsApi.replacement(r.id, r.version, settleNo.value.trim())
    show(result)
    settleOpen.value = false
    toast.add({ severity: 'success', summary: `${result.docNo} settled`, detail: result.settledBy, life: 4000 })
  } catch (error) {
    if (error instanceof ApiError) settleError.value = Object.values(error.fieldErrors)[0] ?? ''
  } finally {
    busy.value = false
  }
}

// ── Display ──────────────────────────────────────────────────────────────────
const title = computed(() => (row.value ? `Purchase return ${row.value.docNo}` : 'New purchase return'))
const CHIP = { DRAFT: { group: 'draft', label: 'Draft' }, RELEASED: { group: 'pending', label: 'Waiting for credit' }, SETTLED: { group: 'done', label: 'Settled' } } as const
const linkTo = (type: string, docId: string | null | undefined, no: string | null | undefined) => (no && !isLegacyNo(no) && docId ? docRoute(type, docId) : null)
const grnRef = computed(() => (row.value ? row.value.grn : template.value ? { id: template.value.grn.id, docNo: template.value.grn.docNo } : null))
const poRef = computed(() => (row.value ? row.value.po : template.value ? { id: template.value.grn.poId, docNo: template.value.grn.poNo } : null))
const lineError = (i: number) => errors.value[`lines[${i}].qty`]
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
        <template v-if="supplier && grnRef">
          Back to {{ supplier.name }} · from
          <RouterLink v-if="linkTo('PUR_RECEIPT', grnRef.id, grnRef.docNo)" :to="linkTo('PUR_RECEIPT', grnRef.id, grnRef.docNo)!" class="erp-link">{{ grnRef.docNo }}</RouterLink>
          <template v-else>{{ grnRef.docNo }}</template>
          <template v-if="poRef?.docNo">
            /
            <RouterLink v-if="linkTo('PUR_ORDER', poRef.id, poRef.docNo)" :to="linkTo('PUR_ORDER', poRef.id, poRef.docNo)!" class="erp-link">{{ poRef.docNo }}</RouterLink>
            <template v-else>{{ poRef.docNo }}</template>
          </template>
        </template>
        <template v-else>Pick the goods receipt the goods came in on. You can only return what was received.</template>
      </template>
      <template #actions>
        <RouterLink to="/purchase/returns" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || (!isNew && !dirty) || (isNew && !template)" @click="save()">Save draft</button>
          <button v-if="can('release')" type="button" class="erp-btn erp-btn-primary" :disabled="busy || (isNew && !template)" @click="release">Release return</button>
        </template>
        <template v-else-if="row">
          <button v-if="can('remind')" type="button" class="erp-btn erp-btn-secondary" :disabled="busy" @click="remind">Remind supplier</button>
          <button v-if="can('settle')" type="button" class="erp-btn erp-btn-primary" :disabled="busy" @click="openSettle">
            {{ row.settleBy === 'CREDIT_NOTE' ? 'Record credit note' : 'Record replacement' }}
          </button>
        </template>
      </template>
    </PageHeader>

    <NoticeBanner v-if="!inventoryConnected && row?.status !== 'SETTLED' && !row?.isMigrated && (row || template)" kind="warning">
      <strong>Inventory is not connected yet.</strong> The {{ going.length ? goingText : 'goods' }} leaving stock are saved as an event and posted when the Inventory module is
      plugged in.
    </NoticeBanner>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4">
          <FormField v-if="isNew" label="Goods receipt" class="col-span-3" :error="errors.grnId" for="prt-grn">
            <select id="prt-grn" v-model="grnId" class="erp-input">
              <option value="">{{ receipts.length ? 'Pick the goods receipt' : 'No receipt has goods left to return' }}</option>
              <option v-for="g in receipts" :key="g.id" :value="g.id">{{ g.docNo }} · {{ formatDate(g.docDate) }} · {{ g.poNo }} · {{ g.supplierName }} · {{ g.returnableText }} can go back</option>
            </select>
          </FormField>
          <FormField :label="supplier ? `Supplier · ${supplier.code}` : 'Supplier'">
            <div class="erp-input-ro">{{ supplier?.name ?? '—' }}</div>
          </FormField>
          <FormField label="Return date" :error="errors.docDate" for="prt-date">
            <DatePicker
              v-if="editable"
              input-id="prt-date"
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
          <FormField label="Reason" for="prt-reason">
            <select v-if="editable" id="prt-reason" v-model="form.reason" class="erp-input">
              <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ form.reason }}</div>
          </FormField>
          <FormField label="Settle by" for="prt-settle">
            <select v-if="editable" id="prt-settle" v-model="form.settleBy" class="erp-input">
              <option value="CREDIT_NOTE">Supplier credit note</option>
              <option value="REPLACEMENT">Replacement goods</option>
            </select>
            <div v-else class="erp-input-ro">{{ row?.settledBy }}</div>
          </FormField>
          <FormField label="Their return no (RMA)" for="prt-rma">
            <input v-if="editable" id="prt-rma" v-model="form.rmaNo" class="erp-input" maxlength="50" />
            <div v-else class="erp-input-ro">{{ form.rmaNo || '—' }}</div>
          </FormField>
          <FormField label="Collection" for="prt-collection">
            <input v-if="editable" id="prt-collection" v-model="form.collection" class="erp-input" maxlength="200" placeholder="e.g. Supplier lorry · 30 Sep" />
            <div v-else class="erp-input-ro">{{ form.collection || '—' }}</div>
          </FormField>
          <FormField label="Note" class="col-span-3" for="prt-note">
            <input v-if="editable" id="prt-note" v-model="form.remarks" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.remarks || '—' }}</div>
          </FormField>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">What is going back</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <p v-if="!form.lines.length" class="m-0 text-[13px] text-erp-muted">Pick the goods receipt to see what can go back.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="num">Received</th>
                <th class="num">Returned before</th>
                <th class="num">{{ editable ? 'Return now' : 'Returned' }}</th>
                <th class="num">Unit price</th>
                <th class="num">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="l.grnLineId">
                <td>
                  <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                  <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
                </td>
                <td class="num">{{ formatQty(l.receivedQty) }}</td>
                <td class="num">{{ formatQty(l.returnedBeforeQty) }}</td>
                <td class="num">
                  <template v-if="editable">
                    <input
                      v-model="l.qty"
                      class="erp-cell w-[72px]"
                      inputmode="decimal"
                      placeholder="0"
                      :aria-label="`Return quantity ${l.itemCode}`"
                      :aria-invalid="Boolean(lineError(i)) || compareQty(l.qty || '0', returnableOf(l)) > 0"
                    />
                    <div v-if="lineError(i)" class="mt-1 text-left text-xs text-note-error-text">{{ lineError(i) }}</div>
                  </template>
                  <strong v-else>{{ formatQty(l.qty) }}</strong>
                </td>
                <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num"><MoneyText :value="lineValue(l)?.amount ?? null" /></td>
              </tr>
            </tbody>
          </table>
          <p class="m-0 text-xs text-erp-muted">You can never return more than was received, minus earlier returns.</p>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Photos</h2>
          <FileTiles :files="files" :editable="editable" :upload="upload" add-label="+ Add photo" />
        </section>

        <ActivityList v-if="row" :items="row.activity" />
      </div>

      <aside v-if="supplier" class="flex flex-col gap-3.5">
        <SideCard :title="form.settleBy === 'CREDIT_NOTE' ? 'Credit expected (MYR)' : 'Value going back (MYR)'">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Goods</span><span>{{ formatMoney(goods) }}</span></div>
            <div v-for="t in taxLines" :key="t.code" class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>{{ t.name }}</span><span>{{ formatMoney(t.amount) }}</span></div>
            <div class="flex justify-between gap-3 py-[7px] font-bold"><span>{{ form.settleBy === 'CREDIT_NOTE' ? 'Credit total' : 'Total' }}</span><span>{{ formatMoney(creditTotal) }}</span></div>
          </div>
        </SideCard>

        <NextSteps v-if="editable" title="When you release">
          <li><span>{{ going.length ? goingText : 'The goods' }} leave stock. The event is {{ inventoryConnected ? 'sent to' : 'queued for' }} Inventory.</span></li>
          <li><span>The supplier gets the return notice email<template v-if="form.rmaNo"> with RMA {{ form.rmaNo }}</template>.</span></li>
          <li>
            <span v-if="form.settleBy === 'CREDIT_NOTE'">
              {{ formatRm(creditTotal) }} waits for their credit note.<template v-if="firstInvoice"> When it arrives, {{ firstInvoice.docNo }} drops to {{ formatRm(subMoney(firstInvoice.total, creditTotal)) }}.</template>
            </span>
            <span v-else>The supplier delivers replacement goods; record their delivery order when they arrive.</span>
          </li>
        </NextSteps>
        <SideCard v-else-if="row" :title="row.status === 'SETTLED' ? 'Settled' : 'Waiting for the supplier'">
          <p class="m-0 text-[13px] leading-normal">
            <template v-if="row.status === 'SETTLED'">{{ row.settledBy }}<template v-if="row.settledAt"> · {{ formatDateTime(row.settledAt) }}</template>.</template>
            <template v-else>
              Released<template v-if="row.releasedAt"> {{ formatDateTime(row.releasedAt) }}</template>.
              {{ row.settleBy === 'CREDIT_NOTE' ? `${formatRm(row.total)} waits for their credit note.` : 'Waiting for the replacement goods.' }}
            </template>
          </p>
        </SideCard>

        <SideCard v-if="originals" title="Original documents">
          <div class="flex flex-col">
            <div v-if="originals.grn" class="flex items-center justify-between gap-2.5 border-b border-erp-row py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_RECEIPT', originals.grn.id, originals.grn.docNo)" :to="linkTo('PUR_RECEIPT', originals.grn.id, originals.grn.docNo)!" class="erp-link">{{ originals.grn.docNo }}</RouterLink>
              <span v-else>{{ originals.grn.docNo }}</span>
              <span class="text-xs text-erp-muted">{{ originals.grn.received }} received</span>
              <StatusChip status="GRN" :group="originals.grn.chip.group" :label="originals.grn.chip.label" />
            </div>
            <div v-for="inv in originals.invoices" :key="inv.id" class="flex items-center justify-between gap-2.5 border-b border-erp-row py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_INVOICE', inv.id, inv.docNo)" :to="linkTo('PUR_INVOICE', inv.id, inv.docNo)!" class="erp-link">{{ inv.docNo }}</RouterLink>
              <span v-else>{{ inv.docNo }}</span>
              <span class="text-xs text-erp-muted">{{ formatRm(inv.total) }}</span>
              <StatusChip status="PI" :group="inv.group" :label="inv.label" />
            </div>
            <div v-if="originals.po" class="flex items-center justify-between gap-2.5 py-2 text-[13px]">
              <RouterLink v-if="linkTo('PUR_ORDER', originals.po.id, originals.po.docNo)" :to="linkTo('PUR_ORDER', originals.po.id, originals.po.docNo)!" class="erp-link">{{ originals.po.docNo }}</RouterLink>
              <span v-else>{{ originals.po.docNo }}</span>
              <span class="text-xs text-erp-muted">does not reopen</span>
              <StatusChip :status="originals.po.status" :label="originals.po.status === 'PARTIAL' ? 'Partial' : originals.po.label" />
            </div>
          </div>
        </SideCard>
      </aside>
    </div>

    <Dialog v-if="row" v-model:visible="settleOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '480px' }">
      <template #header>
        <div>
          <h2 class="m-0 text-xl font-bold">{{ row.settleBy === 'CREDIT_NOTE' ? 'Record credit note' : 'Record replacement' }} · {{ row.docNo }}</h2>
          <p class="m-0 mt-1 text-[13px] text-erp-muted">
            {{ row.settleBy === 'CREDIT_NOTE' ? `The supplier credits ${formatRm(row.total)} for the goods returned.` : 'The replacement goods come back into stock.' }}
          </p>
        </div>
      </template>
      <FormField :label="row.settleBy === 'CREDIT_NOTE' ? 'Their credit note no' : 'Their delivery order no'" :error="settleError" for="settle-no">
        <input id="settle-no" v-model="settleNo" class="erp-input" maxlength="50" />
      </FormField>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <button type="button" class="erp-btn erp-btn-secondary" @click="settleOpen = false">Cancel</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="busy" @click="settle">Settle return</button>
        </div>
      </template>
    </Dialog>
  </template>
</template>
