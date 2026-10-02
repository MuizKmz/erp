<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatPrice, formatQty, formatRm, percentOf, qtyWithUnit } from '@/utils/format'
import { compareQty, isQty, previewLine, subQty, sumMoney, sumQty } from '@/utils/money'
import { attachmentsApi, cancelOrdersApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { CancelOrderAction, CancelOrderDetail, CancelOrderTemplate, CancelPoSummary, SupplierRecord } from '../types'

/** P13 · Cancel PO balance (PoCancel.html, FlowP6 steps 2–4). `/purchase/cancel-orders/new?po=` starts one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today, user, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const row = ref<CancelOrderDetail | null>(null)
const template = ref<CancelOrderTemplate | null>(null)
const orders = ref<{ id: string; docNo: string; isMigrated: boolean; supplierName: string; openText: string }[]>([])
const poId = ref('')
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})

interface FormLine {
  poLineId: string
  itemCode: string
  itemName: string
  uomCode: string
  taxRate: string
  orderedQty: string
  receivedQty: string
  openQty: string
  unitPrice: string
  cancelQty: string
}
const form = reactive({ docDate: '', reason: '', remarks: '', lines: [] as FormLine[] })
const newFiles = ref<{ id: string; fileName: string; mimeType: string }[]>([])
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, files: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)
const plain = (v: string) => formatQty(v).replace(/,/g, '')

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

function fillFromTemplate(t: CancelOrderTemplate) {
  form.docDate = t.docDate
  form.reason = t.reasons[0] ?? ''
  form.remarks = ''
  form.lines = t.lines.map((l) => ({ ...l, poLineId: l.poLineId!, cancelQty: plain(l.openQty) }))
  newFiles.value = []
  saved.value = snapshot()
}

function show(r: CancelOrderDetail) {
  row.value = r
  template.value = null
  form.docDate = r.docDate
  form.reason = r.reason
  form.remarks = r.remarks ?? ''
  form.lines = r.lines.map((l) => ({ ...l, poLineId: l.poLineId ?? '', cancelQty: plain(l.cancelQty) }))
  newFiles.value = []
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
      template.value = null
      setCrumb('New cancellation')
      orders.value = (await cancelOrdersApi.cancellableOrders()).items
      poId.value = typeof route.query.po === 'string' ? route.query.po : ''
      if (poId.value) await loadTemplate(poId.value)
    } else {
      show(await cancelOrdersApi.get(id.value))
    }
  } finally {
    loading.value = false
  }
}
async function loadTemplate(value: string) {
  try {
    template.value = await cancelOrdersApi.template(value)
    fillFromTemplate(template.value)
  } catch (error) {
    template.value = null
    if (!(error instanceof ApiError)) throw error
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())
watch(poId, (value, old) => value && old !== undefined && value !== template.value?.po.id && isNew.value && void loadTemplate(value))

const can = (action: CancelOrderAction) =>
  isNew.value ? action === 'edit' || (action === 'release' && hasPermission('purchase.cancel_order.release')) : Boolean(row.value?.allowedActions.includes(action))
const editable = computed(() => isNew.value || can('edit'))
const po = computed<CancelPoSummary | null>(() => row.value?.po ?? template.value?.po ?? null)
const supplier = computed<SupplierRecord | null>(() => row.value?.supplier ?? template.value?.supplier ?? null)
const reasons = computed(() => row.value?.reasons ?? template.value?.reasons ?? [])

// ── Values (preview; the server's totals are the truth) ──────────────────────
const lineValue = (l: FormLine) => previewLine(isQty(l.cancelQty) ? l.cancelQty : '0', l.unitPrice, l.taxRate)
const cancelTotal = computed(() => sumMoney(form.lines.flatMap((l) => [lineValue(l)?.amount ?? '0', lineValue(l)?.taxAmount ?? '0'])))
const totalCancel = computed(() => sumQty(form.lines.map((l) => l.cancelQty)))
const totalOpen = computed(() => sumQty(form.lines.map((l) => l.openQty)))
const over = computed(() => form.lines.some((l) => !isQty(l.cancelQty) || compareQty(l.cancelQty, l.openQty) > 0))
const closesPo = computed(() => po.value?.open !== null && compareQty(totalCancel.value, po.value?.open ?? '0') >= 0)
const unit = (qty: string) => (po.value?.uomCode ? qtyWithUnit(qty, po.value.uomCode) : formatQty(qty))
const cancelledQty = computed(() => (editable.value ? totalCancel.value : sumQty((row.value?.lines ?? []).map((l) => l.cancelQty))))
const bar = computed(() => ({ received: percentOf(po.value?.received, po.value?.ordered), cancel: percentOf(cancelledQty.value, po.value?.ordered) }))

// ── Files ────────────────────────────────────────────────────────────────────
const files = computed(() => [...(row.value?.attachments ?? []), ...newFiles.value.map((f) => ({ ...f, downloadUrl: `/attachments/${f.id}/download` }))])
async function upload(file: File) {
  const uploaded = await attachmentsApi.upload(file, 'SUPPLIER_LETTER')
  newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName, mimeType: file.type })
}
const letter = computed(() => row.value?.supplierLetter ?? newFiles.value[0]?.fileName ?? null)

// ── Save, release, delete ────────────────────────────────────────────────────
function body() {
  return {
    reason: form.reason,
    docDate: form.docDate,
    remarks: form.remarks,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.map((l) => ({ poLineId: l.poLineId, cancelQty: l.cancelQty || '0' })),
  }
}

async function save(quiet = false): Promise<CancelOrderDetail | null> {
  if (isNew.value && !template.value) {
    errors.value = { poId: 'Pick the purchase order.' }
    return null
  }
  if (over.value) {
    errors.value = { lines: 'Only the part not yet received can be cancelled.' }
    return null
  }
  busy.value = true
  try {
    const result = isNew.value
      ? await cancelOrdersApi.create({ ...body(), poId: template.value!.po.id!, reason: form.reason })
      : await cancelOrdersApi.update(row.value!.id, { ...body(), version: row.value!.version })
    if (!quiet) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/cancel-orders/${result.id}`)
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
    message: `${current.po.docNo} loses ${current.summary ?? 'its open balance'} (${formatRm(current.totalValue)}) and the supplier gets the cancellation notice. This cannot be undone.`,
    acceptLabel: 'Release cancellation',
    rejectLabel: 'Not yet',
    accept: async () => {
      busy.value = true
      try {
        const result = await cancelOrdersApi.release(current.id, current.version)
        show(result)
        toast.add({ severity: 'success', summary: `${result.docNo} released`, detail: `${result.po.docNo} is now ${(result.po.statusLabel ?? '').toLowerCase()}.`, life: 4000 })
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
    message: `The draft is removed and the balance of ${r.po.docNo} stays open. ${r.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await cancelOrdersApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/cancel-orders')
    },
  })
}

const title = computed(() => (row.value ? `Cancel order balance ${row.value.docNo}` : 'New cancellation'))
const poRoute = computed(() => (po.value?.id && !isLegacyNo(po.value.docNo) ? docRoute('PUR_ORDER', po.value.id) : null))
const lineError = (i: number) => errors.value[`lines[${i}].cancelQty`]
const items = computed(() => [...new Set(form.lines.filter((l) => compareQty(l.cancelQty, '0') > 0).map((l) => l.itemCode))])
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="title" subtitle="Closes the part of a purchase order the supplier will never deliver" document>
      <template #chip>
        <StatusChip v-if="row" :status="row.status" :group="row.status === 'RELEASED' ? 'done' : 'draft'" />
        <StatusChip v-else status="DRAFT" label="New" />
      </template>
      <template #actions>
        <RouterLink to="/purchase/cancel-orders" class="erp-btn erp-btn-secondary">Back</RouterLink>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || (!isNew && !dirty) || (isNew && !template)" @click="save()">Save draft</button>
          <button v-if="can('release')" type="button" class="erp-btn erp-btn-primary" :disabled="busy || (isNew && !template)" @click="release">Release cancellation</button>
        </template>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_340px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4">
          <FormField label="Purchase order" :error="errors.poId" for="pco-po">
            <select v-if="isNew" id="pco-po" v-model="poId" class="erp-input">
              <option value="">{{ orders.length ? 'Pick the purchase order' : 'No order has an open balance' }}</option>
              <option v-for="o in orders" :key="o.id" :value="o.id">{{ o.docNo }}{{ o.isMigrated ? ' · migrated' : '' }} · {{ o.supplierName }} · {{ o.openText }} open</option>
            </select>
            <div v-else class="erp-input-ro">
              <RouterLink v-if="poRoute" :to="poRoute" class="erp-link">{{ po?.docNo }}</RouterLink>
              <template v-else>{{ po?.docNo }}</template>{{ po?.isMigrated ? ' · migrated' : '' }}
            </div>
          </FormField>
          <FormField :label="po ? `Supplier · ${po.supplier.code}` : 'Supplier'">
            <div class="erp-input-ro">{{ po?.supplier.name ?? '—' }}</div>
          </FormField>
          <FormField label="Cancel date" :error="errors.docDate" for="pco-date">
            <DatePicker
              v-if="editable"
              input-id="pco-date"
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
          <FormField label="Reason" :error="errors.reason" for="pco-reason">
            <select v-if="editable" id="pco-reason" v-model="form.reason" class="erp-input">
              <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ form.reason }}</div>
          </FormField>
          <FormField label="Supplier letter">
            <div class="erp-input-ro truncate">{{ letter ?? 'Attach it below' }}</div>
          </FormField>
          <FormField label="Asked by">
            <div class="erp-input-ro">{{ row?.askedBy.name ?? template?.askedBy.name ?? user?.name }}</div>
          </FormField>
          <FormField label="Note" class="col-span-3" for="pco-note">
            <input v-if="editable" id="pco-note" v-model="form.remarks" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.remarks || '—' }}</div>
          </FormField>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">What is being cancelled</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <p v-if="!form.lines.length" class="m-0 text-[13px] text-erp-muted">Pick the purchase order to see what is still open.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="num">Ordered</th>
                <th class="num">Received</th>
                <th class="num">Open</th>
                <th class="num">{{ editable ? 'Cancel now' : 'Cancelled' }}</th>
                <th class="num">Unit price</th>
                <th class="num">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="l.poLineId">
                <td>
                  <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                  <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
                </td>
                <td class="num">{{ formatQty(l.orderedQty) }}</td>
                <td class="num">{{ formatQty(l.receivedQty) }}</td>
                <td class="num">{{ formatQty(l.openQty) }}</td>
                <td class="num">
                  <template v-if="editable">
                    <input
                      v-model="l.cancelQty"
                      class="erp-cell w-[72px]"
                      inputmode="decimal"
                      :aria-label="`Cancel quantity ${l.itemCode}`"
                      :aria-invalid="Boolean(lineError(i)) || compareQty(l.cancelQty, l.openQty) > 0"
                    />
                    <div v-if="lineError(i)" class="mt-1 text-left text-xs text-note-error-text">{{ lineError(i) }}</div>
                  </template>
                  <strong v-else>{{ formatQty(l.cancelQty) }}</strong>
                </td>
                <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num"><MoneyText :value="lineValue(l)?.amount ?? null" /></td>
              </tr>
            </tbody>
          </table>
          <p class="m-0 text-xs text-erp-muted">Only the part not yet received can be cancelled. Goods already received go back through a purchase return.</p>
        </section>

        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Attachments</h2>
          <FileTiles :files="files" :editable="editable" :upload="upload" />
        </section>

        <ActivityList v-if="row" :items="row.activity" />
      </div>

      <aside v-if="po" class="flex flex-col gap-3.5">
        <SideCard v-if="po.ordered !== null" :title="`${po.docNo} ${row?.status === 'RELEASED' ? 'now' : 'today'}`">
          <div class="flex h-3 overflow-hidden rounded-md bg-erp-track" aria-hidden="true">
            <div class="bg-mod-line" :style="{ width: `${bar.received}%` }" />
            <div class="bg-note-error-border" :style="{ width: `${bar.cancel}%` }" />
          </div>
          <div class="flex justify-between text-xs">
            <span>{{ formatQty(po.received ?? '0') }} received</span>
            <span class="text-note-error-text">{{ formatQty(cancelledQty) }} {{ editable ? 'to cancel' : 'cancelled' }}</span>
          </div>
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Order total</span><span>{{ formatRm(po.total ?? '0') }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Received and billed</span><span>{{ formatRm(po.receivedValue ?? '0') }}</span></div>
            <div class="flex justify-between gap-3 py-[7px]"><span>Value cancelled</span><strong>{{ formatRm(editable ? cancelTotal : (row?.totalValue ?? '0')) }}</strong></div>
          </div>
        </SideCard>

        <NextSteps v-if="editable && form.lines.length" title="When you release">
          <li>
            <span v-if="closesPo">{{ po.docNo }} closes as <strong>{{ compareQty(po.received ?? '0', '0') > 0 ? 'Done · balance cancelled' : 'Cancelled' }}</strong>. {{ unit(totalOpen) }} open drop to 0.</span>
            <span v-else>{{ po.docNo }} keeps {{ unit(subQty(po.open ?? '0', totalCancel)) }} open.</span>
          </li>
          <li><span>{{ formatRm(cancelTotal) }} is removed from committed spend.</span></li>
          <li><span>The supplier gets the cancellation notice email.</span></li>
          <li v-if="items.length"><span>If still needed, {{ items.join(', ') }} {{ items.length === 1 ? 'shows' : 'show' }} again on the demand list.</span></li>
        </NextSteps>
        <SideCard v-else-if="row?.status === 'RELEASED'" title="Released">
          <p class="m-0 text-[13px] leading-normal">
            Released<template v-if="row.releasedAt"> on {{ formatDateTime(row.releasedAt) }}</template>. {{ formatRm(row.totalValue) }} was removed from committed spend and the
            supplier was told.
          </p>
        </SideCard>

        <SideCard v-if="supplier" title="Supplier record">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>On time, last 12 months</span><span>{{ supplier.onTimePct ? `${supplier.onTimePct}%` : '—' }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Balances cancelled this year</span><span>{{ supplier.cancelledThisYear }}</span></div>
            <div class="flex justify-between gap-3 py-[7px]">
              <span>Status in Master Data</span>
              <StatusChip v-if="supplier.status" :status="supplier.status" :group="supplier.status === 'ACTIVE' ? 'done' : 'cancelled'" :label="supplier.status === 'ACTIVE' ? 'Active' : 'Blocked'" />
            </div>
          </div>
        </SideCard>

        <SideCard title="Who can do this">
          <p class="m-0 text-[13px] leading-normal text-erp-subtle">
            Permission <code>purchase.cancel_order.release</code>. Buyers can draft; the Purchasing Manager releases.
          </p>
        </SideCard>

        <LinkedDocs
          v-if="row && row.links.length"
          :docs="row.links"
          :route-of="(type, docId) => (row?.links.find((d) => d.id === docId && isLegacyNo(d.docNo)) ? null : docRoute(type, docId))"
        />
      </aside>
    </div>
  </template>
</template>
