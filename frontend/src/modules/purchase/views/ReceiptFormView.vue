<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { FileText, Image as ImageIcon } from '@lucide/vue'
import { ApiError, openFile } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import ChecksList from '@/components/erp/ChecksList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatQty, qtyWithUnit } from '@/utils/format'
import { compareQty, isQty, subQty, sumQty } from '@/utils/money'
import { attachmentsApi, lookupsApi, receiptsApi } from '../api/purchase'
import { docRoute, isLegacyNo } from '../routes'
import type { ReceiptAction, ReceiptDetail, ReceiptPoSummary, ReceiptTemplate, ShortAction, WarehouseOption } from '../types'

/** P15 · Confirm goods received (GrnConfirm.html, FlowP4). `/purchase/receipts/new?po=` starts one for a PO. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirmDialog = useConfirm()
const setCrumb = usePageCrumb()
const { today, can: hasPermission } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')
const receipt = ref<ReceiptDetail | null>(null)
const template = ref<ReceiptTemplate | null>(null)
const loading = ref(true)
const busy = ref(false)
const errors = ref<Record<string, string>>({})
const locations = ref<{ code: string; name: string }[]>([])

// ── Form ─────────────────────────────────────────────────────────────────────
interface FormLine {
  poLineId: string
  itemCode: string
  itemName: string
  uomCode: string
  orderedQty: string
  receivedBeforeQty: string
  openQty: string
  receivedQty: string
  condition: string
  locationCode: string
}
const form = reactive({
  docDate: '',
  supplierDoNo: '',
  vehicleNo: '',
  warehouseCode: '',
  remarks: '',
  shortAction: 'KEEP_OPEN' as ShortAction,
  lines: [] as FormLine[],
})
const newFiles = ref<{ id: string; fileName: string; mimeType: string }[]>([])
const uploading = ref(false)

const plain = (v: string) => formatQty(v).replace(/,/g, '')
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, files: newFiles.value.map((f) => f.id) })
const dirty = computed(() => snapshot() !== saved.value)

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

const can = (action: ReceiptAction) =>
  isNew.value ? (action === 'edit' || (action === 'confirm' && hasPermission('purchase.receipt.confirm'))) : Boolean(receipt.value?.allowedActions.includes(action))
const editable = computed(() => isNew.value || can('edit'))
const po = computed<ReceiptPoSummary | null>(() => receipt.value?.po ?? template.value?.po ?? null)
const warehouses = computed<WarehouseOption[]>(() => receipt.value?.warehouses ?? template.value?.warehouses ?? [])
const inventoryConnected = computed(() => receipt.value?.inventoryConnected ?? template.value?.inventoryConnected ?? true)

function fillFromTemplate(t: ReceiptTemplate) {
  form.docDate = t.docDate
  form.supplierDoNo = ''
  form.vehicleNo = ''
  form.warehouseCode = t.warehouseCode
  form.remarks = ''
  form.shortAction = 'KEEP_OPEN'
  // Most deliveries are complete, so "Receiving now" starts at what is open.
  form.lines = t.lines.map((l) => ({ ...l, receivedQty: plain(l.openQty), condition: 'GOOD', locationCode: '' }))
  newFiles.value = []
  saved.value = snapshot()
}

function fillFromReceipt(r: ReceiptDetail) {
  form.docDate = r.docDate
  form.supplierDoNo = r.supplierDoNo ?? ''
  form.vehicleNo = r.vehicleNo ?? ''
  form.warehouseCode = r.warehouse.code
  form.remarks = r.remarks ?? ''
  form.shortAction = r.shortAction ?? 'KEEP_OPEN'
  form.lines = r.lines.map((l) => ({
    poLineId: l.poLineId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    uomCode: l.uomCode,
    orderedQty: l.orderedQty,
    receivedBeforeQty: l.receivedBeforeQty,
    openQty: l.openQty,
    receivedQty: plain(l.receivedQty),
    condition: l.condition,
    locationCode: l.locationCode ?? '',
  }))
  newFiles.value = []
  saved.value = snapshot()
}

function show(r: ReceiptDetail) {
  receipt.value = r
  template.value = null
  fillFromReceipt(r)
  setCrumb(r.docNo)
  errors.value = {}
}

async function load() {
  loading.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      receipt.value = null
      template.value = await receiptsApi.template(String(route.query.po ?? ''))
      fillFromTemplate(template.value)
      setCrumb('New receipt')
    } else {
      show(await receiptsApi.get(id.value))
    }
  } catch (error) {
    // e.g. "GRN-0003 is already open for PO-L-0879" — back to the list, the toast says why.
    if (isNew.value && error instanceof ApiError) await router.replace('/purchase/receipts')
    else throw error
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, (next, prev) => next !== prev && void load())
watch(
  () => form.warehouseCode,
  async (code) => {
    locations.value = code ? (await lookupsApi.locations(code)).items : []
    for (const l of form.lines) if (l.locationCode && !locations.value.some((x) => x.code === l.locationCode)) l.locationCode = ''
  },
)

// ── Quantities ───────────────────────────────────────────────────────────────
const shortOf = (l: FormLine) => (isQty(l.receivedQty) ? subQty(l.openQty, l.receivedQty) : l.openQty)
const totalReceiving = computed(() => sumQty(form.lines.map((l) => l.receivedQty)))
const totalOpen = computed(() => sumQty(form.lines.map((l) => l.openQty)))
const totalShort = computed(() => sumQty(form.lines.map((l) => (compareQty(shortOf(l), '0') > 0 ? shortOf(l) : '0'))))
const singleUom = computed(() => (new Set(form.lines.map((l) => l.uomCode)).size === 1 ? (form.lines[0]?.uomCode ?? null) : null))
const units = (qty: string) => (singleUom.value ? qtyWithUnit(qty, singleUom.value) : `${formatQty(qty)} units`)
const over = computed(() => form.lines.some((l) => compareQty(l.receivedQty, l.openQty) > 0 || !isQty(l.receivedQty)))
const counted = computed(() => form.lines.filter((l) => compareQty(l.receivedQty, '0') > 0))

/** The PO after this receipt (drafts), or as it is now (confirmed). */
const poAfter = computed(() => {
  const p = po.value
  if (!p) return null
  if (!editable.value) return { ordered: p.ordered, received: p.received, open: p.open, label: p.statusLabel, status: p.status }
  const received = sumQty([p.received, totalReceiving.value])
  const open = subQty(p.open, totalReceiving.value)
  const done = compareQty(open, '0') <= 0
  return { ordered: p.ordered, received, open, label: done ? 'Done' : 'Partially received', status: done ? 'DONE' : 'PARTIAL' }
})
const poQty = (qty: string) => (po.value?.uomCode ? qtyWithUnit(qty, po.value.uomCode) : formatQty(qty))

const checks = computed(() => {
  const p = po.value
  if (!p) return []
  const nothingBefore = form.lines.every((l) => compareQty(l.receivedBeforeQty, '0') === 0)
  const poProblem = receipt.value?.poProblem ?? null
  return [
    {
      text: over.value
        ? `Receiving more than is open on ${p.docNo}`
        : `Receiving ${formatQty(totalReceiving.value)} is not more than the ${formatQty(totalOpen.value)} ${nothingBefore ? 'ordered' : 'still open'}`,
      ok: !over.value,
    },
    { text: form.supplierDoNo.trim() ? 'Supplier DO number is filled in' : 'Supplier DO number is missing', ok: Boolean(form.supplierDoNo.trim()) },
    {
      text: counted.value.every((l) => l.locationCode) ? `Put-away location exists at ${p.branch.code}` : 'Pick a put-away location for each item received',
      ok: counted.value.length > 0 && counted.value.every((l) => l.locationCode),
    },
    { text: poProblem ?? `${p.docNo} is released and not closed`, ok: !poProblem },
  ]
})

// ── Photos ───────────────────────────────────────────────────────────────────
const files = computed(() => [...(receipt.value?.attachments ?? []), ...newFiles.value.map((f) => ({ ...f, kind: null, downloadUrl: `/attachments/${f.id}/download` }))])
async function addFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const uploaded = await attachmentsApi.upload(file, file.type.startsWith('image/') ? 'DELIVERY_PHOTO' : 'DO_PHOTO')
    newFiles.value.push({ id: uploaded.id, fileName: uploaded.fileName, mimeType: file.type })
  } finally {
    uploading.value = false
  }
}

// ── Save, confirm, delete ────────────────────────────────────────────────────
function body() {
  return {
    docDate: form.docDate,
    supplierDoNo: form.supplierDoNo,
    vehicleNo: form.vehicleNo,
    warehouseCode: form.warehouseCode,
    remarks: form.remarks,
    shortAction: compareQty(totalShort.value, '0') > 0 ? form.shortAction : null,
    attachmentIds: newFiles.value.length ? newFiles.value.map((f) => f.id) : undefined,
    lines: form.lines.map((l) => ({ poLineId: l.poLineId, receivedQty: l.receivedQty || '0', condition: l.condition, locationCode: l.locationCode || null })),
  }
}

async function save(quiet = false): Promise<ReceiptDetail | null> {
  if (over.value) {
    errors.value = { lines: 'Receiving now cannot be more than the open quantity.' }
    return null
  }
  busy.value = true
  try {
    const result = isNew.value
      ? await receiptsApi.create({ ...body(), poId: po.value!.id })
      : await receiptsApi.update(receipt.value!.id, { ...body(), version: receipt.value!.version })
    if (!quiet) toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved as draft` : 'Draft saved', life: 2500 })
    if (isNew.value) await router.replace(`/purchase/receipts/${result.id}`)
    show(result)
    return result
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
    return null
  } finally {
    busy.value = false
  }
}

async function confirmReceipt() {
  const current = isNew.value || dirty.value ? await save(true) : receipt.value
  if (!current) return
  confirmDialog.require({
    header: `Confirm ${current.docNo}?`,
    message: `${current.po.docNo} is updated with ${units(totalReceiving.value)} received and the receipt is locked. Mistakes are fixed with a purchase return.`,
    acceptLabel: 'Confirm receipt',
    rejectLabel: 'Not yet',
    accept: async () => {
      busy.value = true
      try {
        const result = await receiptsApi.confirm(current.id, current.version)
        show(result)
        toast.add({ severity: 'success', summary: `${result.docNo} confirmed`, detail: `${result.po.docNo} is now ${result.po.statusLabel.toLowerCase()}.`, life: 4000 })
      } catch (error) {
        if (error instanceof ApiError) errors.value = error.fieldErrors
      } finally {
        busy.value = false
      }
    },
  })
}

function deleteDraft() {
  const r = receipt.value
  if (!r) return
  confirmDialog.require({
    header: `Delete ${r.docNo}?`,
    message: `The draft is removed. Its number ${r.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await receiptsApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.docNo} deleted`, life: 3000 })
      await router.push('/purchase/receipts')
    },
  })
}

// ── Display ──────────────────────────────────────────────────────────────────
const title = computed(() => (receipt.value ? `Goods receipt ${receipt.value.docNo}` : 'New goods receipt'))
const poRoute = computed(() => (po.value && !isLegacyNo(po.value.docNo) ? docRoute('PUR_ORDER', po.value.id) : null))
const receivedBy = computed(() => {
  const r = receipt.value?.receivedBy ?? template.value?.receivedBy
  return r ? `${r.name}${r.title ? ` · ${r.title}` : ''}` : ''
})
const lineError = (i: number, field: string) => errors.value[`lines[${i}].${field}`]
const chip = computed(() => {
  const r = receipt.value
  if (!r) return { status: 'DRAFT', label: 'New' }
  if (r.status === 'DRAFT') return { status: 'DRAFT', label: 'Draft' }
  const short = sumQty(r.lines.map((l) => subQty(l.openQtyBefore, l.receivedQty)))
  return compareQty(short, '0') > 0 ? { status: 'PARTIAL', label: `Short ${formatQty(short)}` } : { status: 'DONE', label: 'Received' }
})
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="po">
    <PageHeader :title="title" document>
      <template #chip><StatusChip :status="chip.status" :label="chip.label" /></template>
      <template #subtitle>
        Against
        <RouterLink v-if="poRoute" :to="poRoute" class="erp-link">{{ po.docNo }}</RouterLink>
        <template v-else>{{ po.docNo }}</template>
        · {{ po.supplier.name }}
        <template v-if="receipt?.arrivedAt"> · lorry arrived {{ formatDateTime(receipt.arrivedAt) }}</template>
        <template v-if="receipt?.confirmedAt"> · confirmed {{ formatDateTime(receipt.confirmedAt) }}</template>
      </template>
      <template #actions>
        <RouterLink to="/purchase/receipts" class="erp-btn erp-btn-secondary">Back</RouterLink>
        <template v-if="editable">
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="busy" @click="deleteDraft">Delete draft</button>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || (!isNew && !dirty)" @click="save()">Save draft</button>
          <button v-if="can('confirm')" type="button" class="erp-btn erp-btn-primary" :disabled="busy" @click="confirmReceipt">Confirm receipt</button>
        </template>
      </template>
    </PageHeader>

    <NoticeBanner v-if="!inventoryConnected && !receipt?.isMigrated" kind="warning">
      <strong>Inventory is not connected yet.</strong> This receipt is saved and the stock movement is queued. It posts automatically when the
      Inventory module is plugged in.
    </NoticeBanner>
    <NoticeBanner v-if="receipt?.poProblem" kind="error">{{ receipt.poProblem }}</NoticeBanner>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <!-- Header fields (GrnConfirm.html order) -->
        <section class="erp-card grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-4 gap-y-3 px-5 py-4">
          <FormField :label="`Supplier · ${po.supplier.code}`">
            <div class="erp-input-ro">{{ po.supplier.name }}</div>
          </FormField>
          <FormField label="Received date" :error="errors.docDate" for="received-date">
            <DatePicker
              v-if="editable"
              input-id="received-date"
              :model-value="isoToDate(form.docDate)"
              :min-date="isoToDate(po.docDate) ?? undefined"
              :max-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              fluid
              class="erp-date"
              @update:model-value="form.docDate = dateToIso($event)"
            />
            <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
          </FormField>
          <FormField label="Supplier DO no" :error="errors.supplierDoNo" for="do-no">
            <input v-if="editable" id="do-no" v-model="form.supplierDoNo" class="erp-input" maxlength="50" :aria-invalid="Boolean(errors.supplierDoNo)" />
            <div v-else class="erp-input-ro">{{ form.supplierDoNo || '—' }}</div>
          </FormField>
          <FormField label="Received by">
            <div class="erp-input-ro">{{ receivedBy }}</div>
          </FormField>
          <FormField label="Receiving warehouse" :error="errors.warehouseCode" for="warehouse">
            <select v-if="editable" id="warehouse" v-model="form.warehouseCode" class="erp-input">
              <option v-for="w in warehouses" :key="w.code" :value="w.code">{{ w.name }}</option>
            </select>
            <div v-else class="erp-input-ro">{{ receipt?.warehouse.name }}</div>
          </FormField>
          <FormField label="Vehicle no" for="vehicle">
            <input v-if="editable" id="vehicle" v-model="form.vehicleNo" class="erp-input" maxlength="20" />
            <div v-else class="erp-input-ro">{{ form.vehicleNo || '—' }}</div>
          </FormField>
          <FormField label="Note" class="col-span-2" for="grn-note">
            <input v-if="editable" id="grn-note" v-model="form.remarks" class="erp-input" maxlength="2000" />
            <div v-else class="erp-input-ro">{{ form.remarks || '—' }}</div>
          </FormField>
        </section>

        <!-- Count what arrived -->
        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">{{ editable ? 'Count what arrived' : 'What arrived' }}</h2>
            <span v-if="errors.lines" class="text-xs font-medium text-note-error-text">{{ errors.lines }}</span>
          </div>
          <table class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="num">Ordered</th>
                <th class="num">{{ editable ? 'Receiving now' : 'Received' }}</th>
                <th class="num">Short</th>
                <th>Condition</th>
                <th>Put away to</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="l.poLineId">
                <td>
                  <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                  <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
                </td>
                <td class="num">
                  {{ formatQty(l.orderedQty) }} {{ l.uomCode }}
                  <div v-if="compareQty(l.receivedBeforeQty, '0') > 0" class="text-xs text-erp-muted">{{ formatQty(l.openQty) }} still open</div>
                </td>
                <td class="num">
                  <template v-if="editable">
                    <input
                      v-model="l.receivedQty"
                      class="erp-cell w-[72px]"
                      inputmode="decimal"
                      :aria-invalid="Boolean(lineError(i, 'receivedQty')) || compareQty(l.receivedQty, l.openQty) > 0"
                      :aria-label="`Receiving now ${l.itemCode}`"
                    />
                    <div v-if="lineError(i, 'receivedQty')" class="mt-1 text-left text-xs text-note-error-text">{{ lineError(i, 'receivedQty') }}</div>
                  </template>
                  <strong v-else>{{ formatQty(l.receivedQty) }}</strong>
                </td>
                <td class="num">
                  <strong v-if="compareQty(shortOf(l), '0') > 0" class="text-note-error-text">{{ formatQty(shortOf(l)) }}</strong>
                  <span v-else-if="compareQty(shortOf(l), '0') < 0" class="text-note-error-text">over by {{ formatQty(subQty('0', shortOf(l))) }}</span>
                  <span v-else class="text-erp-muted">0</span>
                </td>
                <td>
                  <select v-if="editable" v-model="l.condition" class="erp-input h-8 w-[110px]" :aria-label="`Condition ${l.itemCode}`">
                    <option value="GOOD">Good</option>
                    <option value="DAMAGED">Damaged</option>
                  </select>
                  <template v-else>{{ l.condition === 'DAMAGED' ? 'Damaged' : 'Good' }}</template>
                </td>
                <td>
                  <template v-if="editable">
                    <select v-model="l.locationCode" class="erp-input h-8 w-[140px]" :aria-label="`Location ${l.itemCode}`" :aria-invalid="Boolean(lineError(i, 'locationCode'))">
                      <option value="">Pick a rack</option>
                      <option v-for="loc in locations" :key="loc.code" :value="loc.code">{{ loc.name }}</option>
                    </select>
                    <div v-if="lineError(i, 'locationCode')" class="mt-1 text-xs text-note-error-text">{{ lineError(i, 'locationCode') }}</div>
                  </template>
                  <template v-else>{{ locations.find((x) => x.code === l.locationCode)?.name ?? (l.locationCode || '—') }}</template>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="compareQty(totalShort, '0') > 0" class="flex flex-wrap items-center gap-6 pt-1 text-xs">
            <span class="font-semibold">{{ units(totalShort) }} short. {{ editable ? 'What should happen to them?' : '' }}</span>
            <template v-if="editable">
              <label class="flex items-center gap-1.5"><input v-model="form.shortAction" type="radio" value="KEEP_OPEN" /> Keep open · expect later</label>
              <label class="flex items-center gap-1.5"><input v-model="form.shortAction" type="radio" value="CANCEL_BALANCE" /> Cancel the balance</label>
            </template>
            <span v-else>{{ receipt?.shortAction === 'CANCEL_BALANCE' ? 'The balance is being cancelled.' : 'Kept open · expected later.' }}</span>
          </div>
        </section>

        <!-- Photos and documents -->
        <section class="erp-card flex flex-col gap-2.5 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Photos and documents</h2>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="f in files"
              :key="f.id"
              type="button"
              class="flex h-[100px] w-[150px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-erp-input bg-erp-head px-2 text-xs text-erp-muted hover:text-erp-text"
              :title="`Open ${f.fileName}`"
              @click="openFile(f.downloadUrl)"
            >
              <ImageIcon v-if="f.mimeType.startsWith('image/')" :size="20" aria-hidden="true" />
              <FileText v-else :size="20" aria-hidden="true" />
              <span class="max-w-full truncate">{{ f.fileName }}</span>
            </button>
            <label
              v-if="editable"
              class="flex h-[100px] w-[150px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-erp-input text-xs text-erp-muted hover:text-erp-text"
            >
              {{ uploading ? 'Uploading…' : '+ Add photo' }}
              <input type="file" accept="image/*,application/pdf" class="hidden" :disabled="uploading" @change="addFile" />
            </label>
            <p v-if="!files.length && !editable" class="m-0 text-[13px] text-erp-muted">No photos.</p>
          </div>
        </section>

        <ActivityList v-if="receipt" :items="receipt.activity" />
      </div>

      <!-- Right panel -->
      <aside class="flex flex-col gap-3.5">
        <SideCard v-if="poAfter" :title="`${po.docNo} ${editable ? 'after this receipt' : 'now'}`">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Ordered</span><span>{{ poQty(poAfter.ordered) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]"><span>Received</span><strong>{{ poQty(poAfter.received) }}</strong></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[7px]">
              <span>Still open</span>
              <span :class="compareQty(poAfter.open, '0') > 0 ? 'font-bold text-note-error-text' : ''">{{ poQty(poAfter.open) }}</span>
            </div>
            <div class="flex justify-between gap-3 py-[7px]"><span>PO status</span><StatusChip :status="poAfter.status" :label="poAfter.label" /></div>
          </div>
        </SideCard>

        <ChecksList v-if="editable" :checks="checks" />

        <NextSteps v-if="editable" title="When you confirm">
          <li>
            <span v-if="compareQty(totalShort, '0') <= 0">{{ po.docNo }} is fully received and closes as Done.</span>
            <span v-else-if="form.shortAction === 'CANCEL_BALANCE'">
              {{ po.docNo }} shows {{ formatQty(poAfter?.received ?? '0') }} received. A cancel order for the last {{ formatQty(totalShort) }} goes to the Purchasing
              Manager.
            </span>
            <span v-else>{{ po.docNo }} shows {{ formatQty(poAfter?.received ?? '0') }} received. It stays open for the last {{ formatQty(totalShort) }}.</span>
          </li>
          <li>
            <span>A stock-in event for {{ units(totalReceiving) }} is {{ inventoryConnected ? 'sent to' : 'queued for' }} Inventory.</span>
          </li>
          <li>
            <span>The supplier invoice can now be matched against {{ formatQty(sumQty([po.received, totalReceiving])) }} received.</span>
          </li>
        </NextSteps>

        <LinkedDocs
          v-if="receipt && receipt.status === 'CONFIRMED'"
          :docs="receipt.links"
          :route-of="(type, docId) => (receipt?.links.find((d) => d.id === docId && isLegacyNo(d.docNo)) ? null : docRoute(type, docId))"
        />
      </aside>
    </div>
  </template>
</template>
