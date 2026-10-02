<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError, openFile } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatDayMonth, formatMoney, formatQty, formatRm, qtyWithUnit } from '@/utils/format'
import { isPositiveDecimal } from '@/utils/money'
import { lookupsApi, requestsApi, rfqsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ItemOption, RequestDetail, RfqAction, RfqDetail, RfqSupplierReply, SupplierOption } from '../types'
import RecordReplyDialog from './RecordReplyDialog.vue'

/** P08 · RFQ: compare replies and award (RfqCompare.html, FlowP2). `/purchase/rfqs/new` asks suppliers. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const setCrumb = usePageCrumb()
const { today } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const rfq = ref<RfqDetail | null>(null)
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateToIso(d)
}

// ── New RFQ ──────────────────────────────────────────────────────────────────
type LineItem = Pick<ItemOption, 'code' | 'name' | 'uomCode'>
interface EditLine {
  key: number
  item: LineItem | null
  qty: string
}
let nextKey = 1
const request = ref<RequestDetail | null>(null)
const draft = reactive({
  lines: [] as EditLine[],
  suppliers: [] as SupplierOption[],
  replyBy: '',
  neededBy: '',
  remarks: '',
})
const supplierToAdd = ref<SupplierOption | null>(null)
const asOption = (code: string, name: string): SupplierOption => ({ code, name, shortName: null, email: null, paymentTermDays: 0, currency: 'MYR', isWalkIn: false })

function addDraftSupplier(s: { code: string; name: string } | null) {
  if (s && !draft.suppliers.some((x) => x.code === s.code)) draft.suppliers.push(asOption(s.code, s.name))
  supplierToAdd.value = null
}
const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items.filter((s) => !s.isWalkIn)
const searchItems = async (q: string) => (await lookupsApi.items(q)).items
const pickerValue = (line: EditLine) => line.item as ItemOption | null
function onItemPicked(line: EditLine, item: ItemOption) {
  line.item = item
  if (item.preferredSupplierCode) addDraftSupplier({ code: item.preferredSupplierCode, name: item.preferredSupplierName ?? item.preferredSupplierCode })
}

async function startNew() {
  const requestId = typeof route.query.request === 'string' ? route.query.request : ''
  request.value = requestId ? await requestsApi.get(requestId) : null
  draft.lines = request.value ? [] : [{ key: nextKey++, item: null, qty: '' }]
  draft.suppliers = []
  for (const l of request.value?.lines ?? []) if (l.preferredSupplierCode) addDraftSupplier({ code: l.preferredSupplierCode, name: l.preferredSupplierName ?? l.preferredSupplierCode })
  draft.replyBy = plusDays(today.value, 3)
  draft.neededBy = request.value?.neededBy ?? ''
  draft.remarks = ''
  errors.value = {}
  setCrumb('New RFQ')
}

async function send() {
  const e: Record<string, string> = {}
  if (!request.value) {
    if (!draft.lines.some((l) => l.item)) e.lines = 'Add at least one item.'
    draft.lines.forEach((l, i) => {
      if (l.item && !isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
    })
  }
  if (!draft.suppliers.length) e.supplierCodes = 'Pick at least one supplier to ask.'
  if (!draft.replyBy) e.replyBy = 'Pick the date replies are due.'
  errors.value = e
  if (Object.keys(e).length) return
  busy.value = true
  try {
    const created = await rfqsApi.create({
      requestId: request.value?.id,
      lines: request.value ? undefined : draft.lines.filter((l) => l.item).map((l) => ({ itemCode: l.item!.code, qty: l.qty })),
      supplierCodes: draft.suppliers.map((s) => s.code),
      replyBy: draft.replyBy,
      neededBy: draft.neededBy || undefined,
      remarks: draft.remarks || undefined,
    })
    toast.add({ severity: 'success', summary: `${created.docNo} sent`, detail: `${created.suppliers.length} suppliers get the RFQ email with their own reply link.`, life: 4000 })
    await router.replace(`/purchase/rfqs/${created.id}`)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    busy.value = false
  }
}

// ── Compare ──────────────────────────────────────────────────────────────────
const chosen = ref('')
const reason = ref('')
const replyFor = ref<RfqSupplierReply | null>(null)
const replyOpen = ref(false)
const closeOpen = ref(false)
const closeReason = ref('')
const adding = ref(false)

const can = (action: RfqAction) => Boolean(rfq.value?.allowedActions.includes(action))
const isOpen = computed(() => rfq.value?.status === 'WAITING' || rfq.value?.status === 'READY')

function show(r: RfqDetail) {
  rfq.value = r
  setCrumb(r.docNo)
  if (r.awardedSupplierCode) chosen.value = r.awardedSupplierCode
  else if (!r.suppliers.some((s) => s.code === chosen.value && s.status === 'REPLIED')) chosen.value = r.compare.cheapest[0] ?? r.suppliers.find((s) => s.status === 'REPLIED')?.code ?? ''
  reason.value = r.awardReason ?? reason.value
}

async function load() {
  loading.value = true
  errors.value = {}
  try {
    if (isNew.value) await startNew()
    else show(await rfqsApi.get(id.value))
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())

const columns = computed(() => rfq.value?.suppliers ?? [])
const single = computed(() => (rfq.value?.lines.length === 1 ? rfq.value.lines[0]! : null))
const repliedCount = computed(() => columns.value.filter((s) => s.status === 'REPLIED').length)
const chosenSupplier = computed(() => columns.value.find((s) => s.code === chosen.value) ?? null)
const nameOf = (s: RfqSupplierReply) => s.shortName ?? s.name
const notCheapest = computed(() => Boolean(rfq.value && chosen.value && repliedCount.value > 1 && !rfq.value.compare.cheapest.includes(chosen.value)))
const gridStyle = computed(() => ({ gridTemplateColumns: `220px repeat(${Math.max(columns.value.length, 1)}, minmax(0, 1fr))${can('addSupplier') ? ' 220px' : ''}` }))

type Tone = 'good' | 'bad' | 'muted' | undefined
interface Cell {
  text: string
  tone?: Tone
  strong?: boolean
}
const missing = (s: RfqSupplierReply): Cell => ({ text: s.status === 'DECLINED' ? 'Declined' : s.status === 'ASKED' ? 'Not replied yet' : '—', tone: 'muted' })

const rows = computed(() => {
  const r = rfq.value
  if (!r) return []
  const out: { key: string; label: string; cell: (s: RfqSupplierReply) => Cell }[] = []
  for (const l of r.lines) {
    out.push({
      key: `price-${l.lineNo}`,
      label: single.value ? 'Unit price' : `Unit price · ${l.itemCode}`,
      cell: (s) => {
        const p = s.prices.find((x) => x.lineNo === l.lineNo)
        if (!p) return missing(s)
        const lowest = repliedCount.value > 1 && (r.compare.lowestPrice[String(l.lineNo)] ?? []).includes(s.code)
        return { text: `RM ${formatMoney(p.unitPrice)}${lowest ? ' · lowest' : ''}`, tone: lowest ? 'good' : undefined, strong: true }
      },
    })
  }
  out.push({
    key: 'total',
    label: single.value ? `Total for ${qtyWithUnit(single.value.qty, single.value.uomCode)}` : 'Total',
    cell: (s) => (s.total ? { text: `RM ${formatMoney(s.total)} + tax` } : missing(s)),
  })
  out.push({
    key: 'delivery',
    label: 'Delivery time',
    cell: (s) => {
      if (!s.leadTimeText) return missing(s)
      const fastest = repliedCount.value > 1 && r.compare.fastest.includes(s.code)
      const tone: Tone = s.late ? 'bad' : fastest ? 'good' : undefined
      return { text: `${s.leadTimeText}${s.deliveryBy ? ` · by ${formatDayMonth(s.deliveryBy)}` : ''}`, tone, strong: Boolean(tone) }
    },
  })
  if (single.value) {
    const line = single.value
    out.push({
      key: 'moq',
      label: 'Minimum order',
      cell: (s) => {
        const p = s.prices.find((x) => x.lineNo === line.lineNo)
        return p ? { text: p.minOrderQty ? qtyWithUnit(p.minOrderQty, line.uomCode) : 'None' } : missing(s)
      },
    })
  }
  out.push({ key: 'term', label: 'Payment term', cell: (s) => (s.paymentTermDays !== null ? { text: `${s.paymentTermDays} days` } : missing(s)) })
  out.push({ key: 'valid', label: 'Quote valid until', cell: (s) => (s.validUntil ? { text: formatDate(s.validUntil) } : missing(s)) })
  out.push({
    key: 'ontime',
    label: 'On time last 12 months',
    cell: (s) => (s.onTime ? { text: `${s.onTime.pct}% of ${s.onTime.deliveries} deliveries` } : { text: 'No deliveries yet', tone: 'muted' }),
  })
  return out
})

const headerSub = (s: RfqSupplierReply) =>
  [
    s.code,
    s.isPreferred ? 'preferred supplier' : null,
    s.status === 'REPLIED' && s.repliedAt ? `replied ${formatDateTime(s.repliedAt)}` : s.status === 'DECLINED' ? 'declined' : `asked ${formatDateTime(s.askedAt)}`,
    s.status === 'ASKED' && s.remindedAt ? `reminded ${formatDateTime(s.remindedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

function openReply(s: RfqSupplierReply) {
  replyFor.value = s
  replyOpen.value = true
}

async function addSupplier(s: SupplierOption) {
  if (!rfq.value) return
  busy.value = true
  try {
    show(await rfqsApi.addSupplier(rfq.value.id, rfq.value.version, s.code))
    toast.add({ severity: 'success', summary: `${s.shortName ?? s.name} asked`, detail: 'They get the RFQ email with their own reply link.', life: 3000 })
    adding.value = false
  } finally {
    busy.value = false
  }
}

async function remindAll() {
  if (!rfq.value) return
  const waiting = columns.value.filter((s) => s.status === 'ASKED').map(nameOf)
  show(await rfqsApi.remind(rfq.value.id))
  toast.add({ severity: 'success', summary: 'Reminder sent', detail: `${waiting.join(', ')} get the RFQ email again.`, life: 3500 })
}

async function award() {
  const r = rfq.value
  const s = chosenSupplier.value
  if (!r || !s) return
  errors.value = {}
  busy.value = true
  try {
    const result = await rfqsApi.award(r.id, { version: r.version, supplierCode: s.code, reason: reason.value.trim() || undefined })
    toast.add({ severity: 'success', summary: `${result.order.docNo} drafted`, detail: `Awarded to ${nameOf(s)}. Check the PO and send it.`, life: 5000 })
    await router.push(`/purchase/orders/${result.order.id}`)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    busy.value = false
  }
}

async function closeRfq() {
  if (!rfq.value) return
  if (!closeReason.value.trim()) {
    errors.value = { closeReason: 'Say why no supplier is chosen, e.g. too costly.' }
    return
  }
  busy.value = true
  try {
    show(await rfqsApi.close(rfq.value.id, rfq.value.version, closeReason.value.trim()))
    toast.add({ severity: 'success', summary: `${rfq.value.docNo} closed`, detail: 'Every supplier gets a “thank you, not this time” email.', life: 4000 })
    closeOpen.value = false
  } finally {
    busy.value = false
  }
}

const subtitleWhat = computed(() => {
  const r = rfq.value
  if (!r) return ''
  return single.value ? `${qtyWithUnit(single.value.qty, single.value.uomCode)} ${single.value.itemCode}` : (r.summary ?? '')
})
const others = computed(() => columns.value.filter((s) => s.code !== chosen.value).map(nameOf))
const awardedOrderRoute = computed(() => {
  const o = rfq.value?.awardedOrder
  return o && !isLegacyNo(o.docNo) ? docRoute('PUR_ORDER', o.id) : null
})
const toneClass = (tone: Tone) => (tone === 'good' ? 'text-chip-done-text' : tone === 'bad' ? 'text-note-error-text' : tone === 'muted' ? 'text-erp-muted' : '')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <!-- ── New RFQ ─────────────────────────────────────────────────────────── -->
  <template v-else-if="isNew">
    <PageHeader title="New request for quote" document>
      <template #chip><StatusChip status="DRAFT" label="New" /></template>
      <template #subtitle>
        Pick the suppliers to ask and the reply-by date. Each supplier gets an email with its own reply link.
      </template>
      <template #actions>
        <RouterLink :to="request ? `/purchase/requests/${request.id}` : '/purchase/rfqs'" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="busy" @click="send">Send to suppliers</button>
      </template>
    </PageHeader>

    <NoticeBanner v-if="request" kind="info">
      Items from
      <RouterLink :to="`/purchase/requests/${request.id}`" class="erp-link">{{ request.docNo }}</RouterLink>
      · raised by {{ request.requestedBy.name }}<template v-if="request.neededBy"> · needed by {{ formatDate(request.neededBy) }}</template>.
      The request closes and links to this RFQ when you send it.
    </NoticeBanner>

    <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">What to quote</h2>
        <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
      </div>
      <table class="erp-table">
        <thead>
          <tr>
            <th>Item · from Master Data</th>
            <th class="num">Qty</th>
            <th>UOM</th>
            <th v-if="!request" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          <template v-if="request">
            <tr v-for="l in request.lines" :key="l.id">
              <td>
                <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
              </td>
              <td class="num">{{ formatQty(l.qty) }}</td>
              <td>{{ l.uomCode }}</td>
            </tr>
          </template>
          <template v-else>
            <tr v-for="(l, i) in draft.lines" :key="l.key">
              <td class="min-w-[320px]">
                <MasterDataPicker :model-value="pickerValue(l)" :search="searchItems" placeholder="Type an item code or name" @picked="onItemPicked(l, $event)" />
                <div v-if="errors[`lines[${i}].itemCode`]" class="mt-1 text-xs text-note-error-text">{{ errors[`lines[${i}].itemCode`] }}</div>
              </td>
              <td class="num w-[110px]">
                <input v-model="l.qty" class="erp-cell w-[72px]" inputmode="decimal" :aria-label="`Quantity, line ${i + 1}`" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" />
                <div v-if="errors[`lines[${i}].qty`]" class="mt-1 text-left text-xs text-note-error-text">{{ errors[`lines[${i}].qty`] }}</div>
              </td>
              <td>{{ l.item?.uomCode }}</td>
              <td class="w-8">
                <button
                  v-if="draft.lines.length > 1"
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head"
                  :aria-label="`Remove line ${i + 1}`"
                  @click="draft.lines = draft.lines.filter((x) => x.key !== l.key)"
                >
                  <X :size="14" />
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="!request">
        <button type="button" class="erp-btn erp-btn-secondary" @click="draft.lines.push({ key: nextKey++, item: null, qty: '' })">
          <Plus :size="14" aria-hidden="true" />Add line
        </button>
      </div>
    </section>

    <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4">
      <FormField label="Suppliers to ask" class="col-span-3" :error="errors.supplierCodes" for="add-supplier">
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-for="s in draft.suppliers"
            :key="s.code"
            class="inline-flex items-center gap-1.5 rounded-full border border-erp-border bg-erp-head py-1 pr-1.5 pl-3 text-[13px] text-erp-text"
          >
            {{ s.code }} · {{ s.name }}
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent text-erp-muted hover:bg-erp-card"
              :aria-label="`Remove ${s.name}`"
              @click="draft.suppliers = draft.suppliers.filter((x) => x.code !== s.code)"
            >
              <X :size="12" />
            </button>
          </span>
          <div class="w-[320px]">
            <MasterDataPicker v-model="supplierToAdd" input-id="add-supplier" :search="searchSuppliers" placeholder="Add a supplier: code or name" @picked="addDraftSupplier" />
          </div>
        </div>
      </FormField>
      <FormField label="Reply by" :error="errors.replyBy" for="reply-by">
        <DatePicker
          input-id="reply-by"
          :model-value="isoToDate(draft.replyBy)"
          :min-date="isoToDate(today) ?? undefined"
          date-format="d M yy"
          show-icon
          fluid
          class="erp-date"
          @update:model-value="draft.replyBy = dateToIso($event)"
        />
      </FormField>
      <FormField label="Needed by" :error="errors.neededBy" for="rfq-needed-by">
        <DatePicker
          input-id="rfq-needed-by"
          :model-value="isoToDate(draft.neededBy)"
          :min-date="isoToDate(draft.replyBy || today) ?? undefined"
          date-format="d M yy"
          show-icon
          show-button-bar
          fluid
          class="erp-date"
          @update:model-value="draft.neededBy = dateToIso($event)"
        />
      </FormField>
      <FormField label="Note to suppliers" for="rfq-note">
        <input id="rfq-note" v-model="draft.remarks" class="erp-input" maxlength="2000" placeholder="e.g. delivery to HQ Shah Alam" />
      </FormField>
      <p class="col-span-3 m-0 text-xs text-erp-muted">
        Orders over RM 50,000.00 need replies from at least 2 suppliers. Only active suppliers from Master Data can be asked.
      </p>
    </section>
  </template>

  <!-- ── Compare ─────────────────────────────────────────────────────────── -->
  <template v-else-if="rfq">
    <PageHeader :title="`${rfq.docNo} · compare replies`" document>
      <template #chip>
        <StatusChip :status="rfq.status" :label="rfq.status === 'CLOSED' ? 'Closed without order' : undefined" />
      </template>
      <template #subtitle>
        {{ subtitleWhat }}
        <template v-if="rfq.source.type === 'REQUEST' && rfq.source.id">
          · from <RouterLink :to="docRoute('PUR_REQUEST', rfq.source.id)!" class="erp-link">{{ rfq.source.no }}</RouterLink>
        </template>
        <template v-else-if="rfq.source.type !== 'BUYER'"> · for {{ rfq.source.label }}</template>
        <template v-if="rfq.neededBy"> · needed by {{ formatDayMonth(rfq.neededBy) }}</template>
        <template v-if="isOpen && rfq.replyBy"> · replies due {{ formatDayMonth(rfq.replyBy) }}</template>
      </template>
      <template #actions>
        <template v-if="isOpen">
          <button v-if="can('remind')" type="button" class="erp-btn erp-btn-secondary" :disabled="busy" @click="remindAll">Remind suppliers</button>
          <button v-if="can('close')" type="button" class="erp-btn erp-btn-secondary" :disabled="busy" @click="(closeReason = ''), (errors = {}), (closeOpen = true)">
            Close without order
          </button>
          <button
            v-if="can('award') || can('recordReply')"
            type="button"
            class="erp-btn erp-btn-primary"
            :disabled="busy || !can('award') || chosenSupplier?.status !== 'REPLIED' || !chosenSupplier?.total"
            @click="award"
          >
            Award and create PO
          </button>
        </template>
        <RouterLink v-else-if="awardedOrderRoute" :to="awardedOrderRoute" class="erp-btn erp-btn-primary">Open {{ rfq.awardedOrder?.docNo }}</RouterLink>
      </template>
    </PageHeader>

    <!-- Side-by-side replies -->
    <div class="erp-compare" :style="gridStyle">
      <div class="lab" />
      <div v-for="s in columns" :key="s.code" class="flex-col !items-start gap-1" :class="{ win: s.code === chosen }">
        <span class="text-[15px] font-bold">{{ s.name }}</span>
        <span class="text-xs text-erp-muted">{{ headerSub(s) }}</span>
        <button v-if="can('recordReply')" type="button" class="erp-btn erp-btn-secondary mt-1 h-[28px] px-2.5 text-xs" @click="openReply(s)">
          {{ s.status === 'ASKED' ? 'Record reply' : 'Change reply' }}
        </button>
      </div>
      <div v-if="can('addSupplier')" class="add justify-center">
        <div v-if="adding" class="w-full">
          <MasterDataPicker :search="searchSuppliers" placeholder="Supplier code or name" @picked="addSupplier" />
        </div>
        <button v-else type="button" class="erp-btn erp-btn-secondary h-8" @click="adding = true">+ Ask another supplier</button>
      </div>

      <template v-for="row in rows" :key="row.key">
        <div class="lab">{{ row.label }}</div>
        <div v-for="s in columns" :key="s.code" :class="{ win: s.code === chosen }">
          <component :is="row.cell(s).strong ? 'strong' : 'span'" :class="toneClass(row.cell(s).tone)">{{ row.cell(s).text }}</component>
        </div>
        <div v-if="can('addSupplier')" class="add" />
      </template>

      <div class="lab">Their quote</div>
      <div v-for="s in columns" :key="s.code" class="flex-wrap gap-x-3" :class="{ win: s.code === chosen }">
        <button v-for="q in s.quotes" :key="q.id" type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-[13px] text-erp-link" @click="openFile(q.downloadUrl)">{{ q.fileName }}</button>
        <span v-if="!s.quotes.length" class="text-erp-muted">{{ s.quoteRef ?? '—' }}</span>
      </div>
      <div v-if="can('addSupplier')" class="add" />

      <div class="lab border-b-0">Choose</div>
      <div v-for="s in columns" :key="s.code" class="gap-2 border-b-0" :class="{ win: s.code === chosen }">
        <template v-if="isOpen">
          <input
            :id="`award-${s.code}`"
            v-model="chosen"
            type="radio"
            name="award"
            :value="s.code"
            :disabled="s.status !== 'REPLIED' || !can('award')"
            :aria-label="`Award ${nameOf(s)}`"
          />
          <label :for="`award-${s.code}`" :class="{ 'font-bold': s.code === chosen, 'text-erp-muted': s.status !== 'REPLIED' }">Award</label>
        </template>
        <StatusChip v-else-if="s.isAwarded" status="AWARDED" />
        <span v-else class="text-erp-muted">—</span>
      </div>
      <div v-if="can('addSupplier')" class="add border-b-0" />
    </div>

    <div class="flex grow items-start gap-4">
      <div class="flex grow flex-col gap-4">
        <section v-if="rfq.status !== 'CLOSED'" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Why this supplier</h2>
          <FormField label="Reason saved with the award" :error="errors.reason" for="award-reason">
            <textarea
              v-if="isOpen && can('award')"
              id="award-reason"
              v-model="reason"
              class="erp-input h-16 resize-none py-2.5"
              maxlength="2000"
              :aria-invalid="Boolean(errors.reason)"
              :placeholder="notCheapest ? 'Required: why not the cheapest?' : 'Optional when you choose the cheapest'"
            />
            <div v-else class="erp-input-ro h-auto min-h-[38px] py-2.5 whitespace-pre-line">{{ rfq.awardReason || '—' }}</div>
          </FormField>
          <p class="m-0 text-xs text-erp-muted">
            Choosing a supplier that is not the cheapest needs a reason. It is shown to the approver and kept in the audit trail.
          </p>
        </section>
        <NoticeBanner v-else kind="warning">Closed without order: “{{ rfq.closeReason }}”. Every supplier was told.</NoticeBanner>
        <ActivityList :items="rfq.activity" />
      </div>

      <aside class="flex w-[400px] shrink-0 flex-col gap-4">
        <NextSteps v-if="isOpen" title="When you award">
          <template v-if="chosenSupplier && chosenSupplier.status === 'REPLIED'">
            <li><span>A draft PO is created for {{ nameOf(chosenSupplier) }} with price, lead time and payment term copied from their reply.</span></li>
            <li v-if="others.length"><span>{{ others.join(', ') }} {{ others.length === 1 ? 'gets' : 'get' }} a polite “not this time” email.</span></li>
            <li>
              <span v-if="rfq.source.type === 'REQUEST' && rfq.source.no">{{ rfq.source.no }} closes and links to the new PO.</span>
              <span v-else>{{ rfq.docNo }} closes and links to the new PO.</span>
            </li>
          </template>
          <li v-else><span>Pick a supplier that has replied. Record replies that came by email with “Record reply”.</span></li>
          <template v-if="chosenSupplier?.totalWithTax" #footer>
            <div class="flex flex-col border-t border-erp-row pt-2.5 text-[13px]">
              <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
                <span>PO value with tax</span><strong class="erp-num">{{ formatRm(chosenSupplier.totalWithTax) }}</strong>
              </div>
              <div class="flex justify-between gap-3 py-[7px]">
                <span>Needs approval?</span>
                <StatusChip
                  v-if="chosenSupplier.approval"
                  :status="chosenSupplier.approval.required ? 'PENDING_APPROVAL' : 'DONE'"
                  :label="chosenSupplier.approval.text"
                  :title="chosenSupplier.approval.reason"
                />
              </div>
            </div>
          </template>
        </NextSteps>

        <SideCard v-else-if="rfq.status === 'AWARDED'" title="Awarded">
          <p class="m-0 text-[13px] leading-normal">
            Awarded to {{ chosenSupplier ? nameOf(chosenSupplier) : rfq.awardedSupplierCode }}
            <template v-if="rfq.awardedAt"> on {{ formatDateTime(rfq.awardedAt) }}</template>.
            <template v-if="rfq.awardedOrder">
              Draft
              <RouterLink v-if="awardedOrderRoute" :to="awardedOrderRoute" class="erp-link">{{ rfq.awardedOrder.docNo }}</RouterLink>
              <template v-else>{{ rfq.awardedOrder.docNo }}</template>
              was created with their price, lead time and payment term.
            </template>
          </p>
        </SideCard>

        <LinkedDocs v-if="rfq.links.length" :docs="rfq.links" :route-of="(type, docId) => (rfq?.links.find((d) => d.id === docId && isLegacyNo(d.docNo)) ? null : docRoute(type, docId))" />
      </aside>
    </div>

    <RecordReplyDialog v-model:visible="replyOpen" :rfq="rfq" :supplier="replyFor" @saved="show" />

    <Dialog v-model:visible="closeOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '520px' }">
      <template #header>
        <div>
          <h2 class="m-0 text-xl font-bold">Close {{ rfq.docNo }} without order</h2>
          <p class="m-0 mt-1 text-[13px] text-erp-muted">No supplier is chosen. Every supplier gets a polite “thank you, not this time” email.</p>
        </div>
      </template>
      <FormField label="Reason" :error="errors.closeReason" for="close-reason">
        <textarea id="close-reason" v-model="closeReason" class="erp-input min-h-20 py-2" maxlength="300" placeholder="e.g. Too costly, or the need went away" />
      </FormField>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <button type="button" class="erp-btn erp-btn-secondary" @click="closeOpen = false">Keep it open</button>
          <button type="button" class="erp-btn erp-btn-delete" :disabled="busy" @click="closeRfq">Close without order</button>
        </div>
      </template>
    </Dialog>
  </template>
</template>
