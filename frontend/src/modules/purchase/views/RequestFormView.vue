<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatPrice, formatQty, qtyWithUnit } from '@/utils/format'
import { isPositiveDecimal, previewLine, sumMoney } from '@/utils/money'
import { lookupsApi, requestsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ItemOption, RequestAction, RequestDetail } from '../types'
import RejectRequestDialog from './RejectRequestDialog.vue'
import RequestToPoDialog from './RequestToPoDialog.vue'

/** P06 · Purchase request (PurRequestForm.html, FlowP1). New and draft are edited by the requester; Purchasing decides. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, state: session } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const request = ref<RequestDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const rejectOpen = ref(false)
const toPoOpen = ref(false)

// ── Form state ───────────────────────────────────────────────────────────────
type LineItem = Pick<ItemOption, 'code' | 'name' | 'uomCode' | 'preferredSupplierName' | 'lastPrice'>
interface EditLine {
  key: number
  item: LineItem | null
  qty: string
}
let nextKey = 1
const form = reactive({ neededBy: '', priority: 'NORMAL' as RequestDetail['priority'], reason: '', lines: [] as EditLine[] })

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) =>
  value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : ''

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, lines: form.lines.map((l) => ({ code: l.item?.code ?? null, qty: l.qty })) })
const dirty = computed(() => snapshot() !== saved.value)

const can = (action: RequestAction) => (isNew.value ? action === 'edit' : Boolean(request.value?.allowedActions.includes(action)))
const editable = computed(() => isNew.value || can('edit'))

function fillForm(r: RequestDetail | null) {
  form.neededBy = r?.neededBy ?? ''
  form.priority = r?.priority ?? 'NORMAL'
  form.reason = r?.reason ?? ''
  form.lines = r
    ? r.lines.map((l) => ({
        key: nextKey++,
        item: { code: l.itemCode, name: l.itemName, uomCode: l.uomCode, preferredSupplierName: l.preferredSupplierName, lastPrice: l.lastPrice },
        qty: formatQty(l.qty).replace(/,/g, ''),
      }))
    : [{ key: nextKey++, item: null, qty: '' }]
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    request.value = isNew.value ? null : await requestsApi.get(id.value)
    fillForm(request.value)
    setCrumb(request.value?.docNo ?? 'New purchase request')
    focusCode.value = request.value?.lines[0]?.itemCode ?? ''
    // "Create PO directly" on the list opens the request with the dialog ready.
    if (route.query.do === 'po') {
      void router.replace({ query: {} })
      if (can('toPo')) toPoOpen.value = true
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())

function show(r: RequestDetail) {
  request.value = r
  fillForm(r)
  setCrumb(r.docNo)
}

// ── Lines ────────────────────────────────────────────────────────────────────
const addLine = () => form.lines.push({ key: nextKey++, item: null, qty: '' })
const removeLine = (key: number) => (form.lines = form.lines.filter((l) => l.key !== key))
const pickerValue = (line: EditLine) => line.item as ItemOption | null
const searchItems = async (q: string) => (await lookupsApi.items(q)).items
const previews = computed(() => form.lines.map((l) => (l.item ? previewLine(l.qty || '0', l.item.lastPrice ?? '0', '0') : null)))
const previewTotal = computed(() => sumMoney(previews.value.filter((p) => p !== null).map((p) => p!.amount)))

// ── Save, submit, delete ─────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.lines.some((l) => l.item)) e.lines = 'Add at least one item.'
  form.lines.forEach((l, i) => {
    if (!l.item && l.qty) e[`lines[${i}].itemCode`] = 'Pick an item from Master Data.'
    if (l.item && !isPositiveDecimal(l.qty)) e[`lines[${i}].qty`] = 'Quantity must be more than 0.'
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<RequestDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  saving.value = true
  try {
    const body = {
      neededBy: form.neededBy || null,
      priority: form.priority,
      reason: form.reason,
      lines: form.lines.filter((l) => l.item).map((l) => ({ itemCode: l.item!.code, qty: l.qty })),
    }
    const result = isNew.value ? await requestsApi.create(body) : await requestsApi.update(id.value, { ...body, version: request.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/requests/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
    return null
  } finally {
    saving.value = false
  }
}

async function submit() {
  const current = dirty.value || isNew.value ? await save() : request.value
  if (!current) return
  saving.value = true
  try {
    const result = await requestsApi.submit(current.id, current.version)
    show(result)
    toast.add({ severity: 'success', summary: `${result.docNo} submitted`, detail: 'Purchasing will turn it into an RFQ or a purchase order.', life: 4000 })
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
  } finally {
    saving.value = false
  }
}

function deleteDraft() {
  const r = request.value
  if (!r) return
  confirm.require({
    header: `Delete ${r.docNo}?`,
    message: `The draft is removed. Its number ${r.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await requestsApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/requests')
    },
  })
}

function askSuppliers() {
  toast.add({ severity: 'info', summary: 'Ask suppliers (RFQ)', detail: 'Requests for quote come in the next step. Use “Create PO directly” for now.', life: 4000 })
}

function onConverted(result: { orders: { id: string; docNo: string }[]; request: RequestDetail }) {
  show(result.request)
  const names = result.orders.map((o) => o.docNo).join(', ')
  toast.add({ severity: 'success', summary: `${request.value?.docNo} converted`, detail: `Draft ${names} ${result.orders.length === 1 ? 'is' : 'are'} ready to check and send.`, life: 5000 })
  if (result.orders.length === 1) void router.push(`/purchase/orders/${result.orders[0]!.id}`)
}

// ── Display helpers ──────────────────────────────────────────────────────────
const title = computed(() => (isNew.value ? 'New purchase request' : `Purchase request ${request.value?.docNo ?? ''}`))
const requester = computed(() => {
  const r = request.value
  const me = session.me?.user
  const name = r?.requestedBy.name ?? me?.name ?? ''
  const titleText = r ? r.requestedBy.title : (me?.jobTitle ?? null)
  return { name, title: titleText, department: r ? r.department : (me?.department ?? null) }
})
const branchName = computed(() => request.value?.branch.name ?? session.me?.branchCode ?? '')

const subtitle = computed(() => {
  const r = request.value
  if (!r) return 'Say what is needed and by when. The request number is given when you save.'
  const who = `Raised by ${r.requestedBy.name}${r.requestedBy.title ? ` (${r.requestedBy.title})` : ''}`
  const from = r.source === 'DEMAND' ? ' from the demand list' : r.source === 'SALES_ORDER' ? ' from a buy-to-order sales line' : ''
  const state = {
    DRAFT: 'draft, not sent to Purchasing yet',
    SUBMITTED: 'waiting for Purchasing',
    CONVERTED: `turned into ${r.turnedInto.map((c) => c.map((d) => d.docNo).join(' → ')).join(', ')}`,
    REJECTED: 'rejected by Purchasing',
  }[r.status]
  return `${who}${from} · ${state}`
})

// The right panel and price history follow the line you click.
const focusCode = ref('')
const insight = computed(() => (focusCode.value ? request.value?.insights[focusCode.value] : undefined))
const unitQty = (qty: string | null) => (qty !== null && Number(qty) === 0 ? '0' : qtyWithUnit(qty, insight.value?.uomCode))
const belowReorder = computed(() => {
  const s = insight.value?.stock
  return Boolean(s && s.reorderLevel !== null && Number(s.onHand) < Number(s.reorderLevel))
})
const historyNote = (h: { unitPrice: string; note: string | null }, index: number) =>
  h.note ?? (index === 0 && insight.value?.lastPrice === h.unitPrice ? 'same as today' : '')
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" :subtitle="subtitle" document>
      <template #chip>
        <StatusChip v-if="request" :status="request.status" />
        <StatusChip v-else status="DRAFT" label="New" />
      </template>
      <template #actions>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="saving" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="saving || (!isNew && !dirty)" @click="save">Save draft</button>
          <button v-if="isNew || can('submit')" type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="submit">Submit to Purchasing</button>
        </template>
        <template v-else-if="request">
          <button v-if="can('reject')" type="button" class="erp-btn erp-btn-danger" @click="rejectOpen = true">Reject</button>
          <button v-if="can('toPo')" type="button" class="erp-btn erp-btn-secondary" @click="toPoOpen = true">Create PO directly</button>
          <button v-if="can('toRfq')" type="button" class="erp-btn erp-btn-primary" @click="askSuppliers">Ask suppliers (RFQ)</button>
        </template>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4" :class="request ? 'grid-cols-[minmax(0,1fr)_330px]' : 'grid-cols-1'">
      <div class="flex min-w-0 flex-col gap-3.5">
        <NoticeBanner v-if="request?.status === 'REJECTED'" kind="error">
          Rejected<template v-if="request.rejectReason">: “{{ request.rejectReason }}”</template>. Raise a new request if it is still needed.
        </NoticeBanner>

        <!-- Header fields (PurRequestForm.html order) -->
        <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4">
          <FormField label="Requested by">
            <div class="erp-input-ro">{{ requester.name }}<template v-if="requester.title"> · {{ requester.title }}</template></div>
          </FormField>
          <FormField label="Department">
            <div class="erp-input-ro">{{ requester.department || '—' }}</div>
          </FormField>
          <FormField label="Branch">
            <div class="erp-input-ro">{{ branchName }}</div>
          </FormField>
          <FormField label="Request date">
            <div class="erp-input-ro">{{ formatDate(request?.docDate ?? today) }}</div>
          </FormField>
          <FormField label="Needed by" :error="errors.neededBy" for="needed-by">
            <DatePicker
              v-if="editable"
              input-id="needed-by"
              :model-value="isoToDate(form.neededBy)"
              :min-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              show-button-bar
              fluid
              class="erp-date"
              :invalid="Boolean(errors.neededBy)"
              @update:model-value="form.neededBy = dateToIso($event)"
            />
            <div v-else class="erp-input-ro">{{ formatDate(form.neededBy) || '—' }}</div>
          </FormField>
          <FormField label="Priority" for="priority">
            <select v-if="editable" id="priority" v-model="form.priority" class="erp-input">
              <option value="NORMAL">Normal</option>
              <option value="URGENT">Urgent</option>
            </select>
            <div v-else class="erp-input-ro">{{ form.priority === 'URGENT' ? 'Urgent' : 'Normal' }}</div>
          </FormField>
          <FormField label="Reason" class="col-span-3" :error="errors.reason" for="reason">
            <input
              v-if="editable"
              id="reason"
              v-model="form.reason"
              class="erp-input"
              maxlength="1000"
              :aria-invalid="Boolean(errors.reason)"
              placeholder="Why it is needed, e.g. below reorder level, or for a customer order"
            />
            <div v-else class="erp-input-ro">{{ form.reason || '—' }}</div>
          </FormField>
        </section>

        <!-- What is needed -->
        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">What is needed</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead>
                <tr>
                  <th>Item · from Master Data</th>
                  <th class="num">Qty</th>
                  <th>UOM</th>
                  <th>Preferred supplier</th>
                  <th class="num">Last price</th>
                  <th class="num">Est. value</th>
                  <th v-if="editable" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                <template v-if="editable">
                  <tr v-for="(l, i) in form.lines" :key="l.key" @focusin="l.item && request?.insights[l.item.code] && (focusCode = l.item.code)">
                    <td class="min-w-[280px]">
                      <MasterDataPicker
                        :model-value="pickerValue(l)"
                        :search="searchItems"
                        :invalid="Boolean(errors[`lines[${i}].itemCode`])"
                        placeholder="Type an item code or name"
                        @picked="l.item = $event"
                      />
                      <div v-if="errors[`lines[${i}].itemCode`]" class="mt-1 text-xs text-note-error-text">{{ errors[`lines[${i}].itemCode`] }}</div>
                    </td>
                    <td class="num w-[110px]">
                      <input v-model="l.qty" class="erp-cell w-[72px]" inputmode="decimal" :aria-invalid="Boolean(errors[`lines[${i}].qty`])" :aria-label="`Quantity, line ${i + 1}`" />
                      <div v-if="errors[`lines[${i}].qty`]" class="mt-1 text-left text-xs text-note-error-text">{{ errors[`lines[${i}].qty`] }}</div>
                    </td>
                    <td>{{ l.item?.uomCode }}</td>
                    <td>{{ l.item ? (l.item.preferredSupplierName ?? '—') : '' }}</td>
                    <td class="num">{{ l.item?.lastPrice ? formatPrice(l.item.lastPrice) : l.item ? '—' : '' }}</td>
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
                <template v-else>
                  <tr
                    v-for="l in request?.lines ?? []"
                    :key="l.id"
                    class="cursor-pointer"
                    :class="{ 'bg-mod-light': request && request.lines.length > 1 && focusCode === l.itemCode }"
                    @click="focusCode = l.itemCode"
                  >
                    <td>
                      <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                      <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
                    </td>
                    <td class="num">{{ formatQty(l.qty) }}</td>
                    <td>{{ l.uomCode }}</td>
                    <td>{{ l.preferredSupplierName ?? '—' }}</td>
                    <td class="num">{{ formatPrice(l.lastPrice) }}</td>
                    <td class="num"><MoneyText :value="l.estAmount" /></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div v-if="editable" class="flex items-center justify-between gap-3">
            <button type="button" class="erp-btn erp-btn-secondary" @click="addLine"><Plus :size="14" aria-hidden="true" />Add line</button>
            <span class="text-[13px]">Estimated value <strong class="erp-num">RM <MoneyText :value="previewTotal" /></strong></span>
          </div>
          <p class="m-0 text-xs text-erp-muted">
            Preferred supplier and last price come from Master Data and purchase history. The buyer can still choose another supplier.
          </p>
        </section>

        <!-- Price history of the focused item -->
        <section v-if="request && insight" class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Price history · {{ focusCode }}</h2>
            <span class="text-xs text-erp-muted">Last 3 purchase orders</span>
          </div>
          <p v-if="!insight.priceHistory.length" class="m-0 text-[13px] text-erp-muted">This item has not been bought before.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>PO no</th>
                <th>Date</th>
                <th>Supplier</th>
                <th class="num">Qty</th>
                <th class="num">Unit price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(h, i) in insight.priceHistory" :key="h.docNo">
                <td><strong>{{ h.docNo }}</strong></td>
                <td class="whitespace-nowrap">{{ formatDate(h.docDate) }}</td>
                <td>{{ h.supplierName }}</td>
                <td class="num">{{ h.qty === null ? '—' : formatQty(h.qty) }}</td>
                <td class="num">{{ formatPrice(h.unitPrice) }}</td>
                <td>
                  <span class="text-xs" :class="h.note ? 'text-attention' : 'text-erp-muted'">{{ historyNote(h, i) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <ActivityList v-if="request" :items="request.activity" />
      </div>

      <!-- Right panel -->
      <aside v-if="request" class="flex flex-col gap-3.5">
        <SideCard v-if="insight" :title="`Stock today · ${focusCode}`">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
              <span>On hand</span>
              <span :class="belowReorder ? 'font-bold text-attention' : ''">{{ unitQty(insight.stock.onHand) }}</span>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
              <span>Reorder level</span><span>{{ insight.stock.reorderLevel === null ? '—' : unitQty(insight.stock.reorderLevel) }}</span>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
              <span>Already on order</span><span>{{ unitQty(insight.stock.onOrder) }}</span>
            </div>
            <div class="flex justify-between gap-3 py-[7px]">
              <span>Used in the last 30 days</span><span>{{ unitQty(insight.stock.usedLast30Days) }}</span>
            </div>
          </div>
        </SideCard>

        <SideCard v-if="insight" title="Open sales orders using it">
          <div v-if="insight.salesOrders.length" class="flex flex-col">
            <div v-for="s in insight.salesOrders" :key="s.soNo" class="flex items-center justify-between gap-2.5 border-b border-erp-row py-2 text-[13px]">
              <span>{{ s.soNo }}<template v-if="s.customerName"> · {{ s.customerName }}</template></span>
              <span class="whitespace-nowrap">{{ s.kind === 'COMPONENT' ? '≈ ' : '' }}{{ qtyWithUnit(s.qty, insight.uomCode) }}</span>
            </div>
          </div>
          <p v-else class="m-0 text-[13px] text-erp-muted">No open sales order uses it.</p>
          <p class="m-0 text-xs text-erp-muted">Read from Sales. Purchase only reads it; it never changes a sales order.</p>
        </SideCard>

        <SideCard v-if="request.status === 'SUBMITTED'" title="Next step for the buyer">
          <div class="flex flex-col gap-3">
            <div v-for="(s, i) in [
              ['Ask suppliers', ' for prices with an RFQ when the value is high or the price may have changed.'],
              ['Order directly', ' from the preferred supplier when the price is known.'],
              ['', 'Either way the request is closed and linked to the new document.'],
            ]" :key="i" class="flex gap-3 text-[13px] leading-normal">
              <b class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-mod-light text-xs text-mod-accent">{{ i + 1 }}</b>
              <span><strong v-if="s[0]">{{ s[0] }}</strong>{{ s[1] }}</span>
            </div>
          </div>
        </SideCard>

        <SideCard v-if="request.status === 'DRAFT'" title="What happens next">
          <p class="m-0 text-[13px] leading-normal">
            Add the needed-by date and the reason, then submit. Purchasing asks suppliers for prices or orders directly, and the
            request is linked to the new document.
          </p>
        </SideCard>

        <LinkedDocs
          v-if="request.status === 'CONVERTED'"
          :docs="request.links"
          :route-of="(type, docId) => (request?.links.find((d) => d.id === docId && isLegacyNo(d.docNo)) ? null : docRoute(type, docId))"
        />
      </aside>
    </div>

    <RejectRequestDialog
      v-if="request"
      v-model:visible="rejectOpen"
      :request-id="request.id"
      :doc-no="request.docNo"
      :requester="request.requestedBy.name"
      :version="request.version"
      @rejected="show"
    />
    <RequestToPoDialog v-if="request" v-model:visible="toPoOpen" :request="request" @converted="onConverted" />
  </template>
</template>
