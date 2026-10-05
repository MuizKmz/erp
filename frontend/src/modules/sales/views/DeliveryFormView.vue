<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FileTiles from '@/components/erp/FileTiles.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { roleLabel } from '@/composables/useSession'
import { formatDate, formatDateTime, formatMoney, formatQty, formatRm } from '@/utils/format'
import { salesDeliveriesApi, salesFilesApi } from '../api/sales'
import { docRoute } from '../routes'
import type { DeliveryAction, DeliveryDetail } from '../types'

/** S16 · Confirm delivery (DeliveryConfirm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()

const id = computed(() => String(route.params.id))
const delivery = ref<DeliveryDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const reason = ref('')
const reasonError = ref('')
const dragging = ref(false)
const uploading = ref(false)

const form = reactive({
  docDate: '',
  vehicle: '',
  driver: '',
  consignmentNote: '',
  deliverTo: '',
  receiver: '',
  warehouseNote: '',
  lines: [] as { lineNo: number; qty: string }[],
})
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const plainQty = (v: string) => formatQty(v).replace(/,/g, '')

const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: DeliveryAction) => Boolean(delivery.value?.allowedActions.includes(a))
const editable = computed(() => can('edit'))

function fill(d: DeliveryDetail) {
  form.docDate = d.docDate
  form.vehicle = d.vehicle ?? ''
  form.driver = d.driver ?? ''
  form.consignmentNote = d.consignmentNote ?? ''
  form.deliverTo = d.deliverTo ?? ''
  form.receiver = d.receiver ?? ''
  form.warehouseNote = d.warehouseNote ?? ''
  form.lines = d.lines.map((l) => ({ lineNo: l.lineNo, qty: plainQty(l.qty) }))
  saved.value = snapshot()
  errors.value = {}
}

function show(d: DeliveryDetail) {
  delivery.value = d
  fill(d)
  setCrumb(d.docNo)
}

onMounted(async () => {
  loading.value = true
  try {
    show(await salesDeliveriesApi.get(id.value))
  } finally {
    loading.value = false
  }
})

// ── Preview of what confirming changes ───────────────────────────────────────
const qtyOf = (lineNo: number) => form.lines.find((l) => l.lineNo === lineNo)?.qty ?? '0'
const validQty = (v: string) => /^\d+(\.\d{1,4})?$/.test(v)
const leftAfter = (l: DeliveryDetail['lines'][number]) => {
  const q = qtyOf(l.lineNo)
  return validQty(q) ? Math.max(0, Number(l.balanceQty) - Number(q)) : null
}
const deliverNow = computed(() => form.lines.reduce((s, l) => s + (validQty(l.qty) ? Number(l.qty) : 0), 0))
const balanceBefore = computed(() => (delivery.value?.lines ?? []).reduce((s, l) => s + Number(l.balanceQty), 0))
const balanceAfter = computed(() => Math.max(0, balanceBefore.value - deliverNow.value))
const progress = computed(() => {
  const d = delivery.value
  if (!d) return { delivered: 0, ordered: 0, pct: 0 }
  const ordered = Number(d.order.ordered)
  const delivered = d.status === 'CONFIRMED' ? Number(d.order.deliveredAfter) : Number(d.order.deliveredAfter) - d.lines.reduce((s, l) => s + Number(l.qty), 0) + deliverNow.value
  return { delivered, ordered, pct: ordered > 0 ? Math.min(100, Math.round((delivered / ordered) * 100)) : 0 }
})
const uomText = computed(() => [...new Set(delivery.value?.lines.map((l) => l.uomCode) ?? [])].join('/'))
const inStock = computed(() => (delivery.value?.lines ?? []).reduce((s, l) => s + Number(l.inStock), 0))
const firstBalance = computed(() => delivery.value?.lines[0]?.balanceQty ?? '0')

// ── Save, confirm, approval ──────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  delivery.value?.lines.forEach((l, i) => {
    const q = qtyOf(l.lineNo)
    if (!validQty(q)) e[`lines[${i}].qty`] = 'Enter a quantity like 60.'
    else if (Number(q) > Number(l.balanceQty)) e[`lines[${i}].qty`] = `Deliver now cannot be more than the balance (${formatQty(l.balanceQty)}).`
  })
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(): Promise<DeliveryDetail | null> {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return null
  }
  const d = delivery.value!
  saving.value = true
  try {
    const result = await salesDeliveriesApi.update(d.id, { version: d.version, ...form, docDate: form.docDate || undefined })
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

async function confirmDelivery() {
  if (dirty.value && !(await save())) return
  if (!validate()) return
  const d = delivery.value!
  if (d.depositHold) {
    toast.add({ severity: 'warn', summary: 'Delivery on hold', detail: `The deposit on ${d.depositHold.proformaNo} (${formatRm(d.depositHold.amount)}) is not paid yet.`, life: 6000 })
    return
  }
  confirm.require({
    header: `Confirm ${d.docNo}?`,
    message: `${formatQty(String(deliverNow.value))} ${uomText.value} leave the warehouse. ${d.order.no} balance goes to ${formatQty(String(balanceAfter.value))}. The DO is then locked.`,
    acceptLabel: 'Confirm delivery',
    rejectLabel: 'Cancel',
    accept: async () => {
      saving.value = true
      try {
        const result = await salesDeliveriesApi.confirm(d.id, d.version)
        show(result)
        toast.add({ severity: 'success', summary: `${result.docNo} delivered`, detail: 'Event sales.shipment.requested saved for Inventory.', life: 4500 })
      } catch (error) {
        if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
      } finally {
        saving.value = false
      }
    },
  })
}

async function requestApproval() {
  reasonError.value = ''
  if (!reason.value.trim()) {
    reasonError.value = 'Type a reason for the approver.'
    return
  }
  if (dirty.value && !(await save())) return
  const d = delivery.value!
  saving.value = true
  try {
    show(await salesDeliveriesApi.requestApproval(d.id, d.version, reason.value.trim()))
    reason.value = ''
    notifyApprovalsChanged()
    toast.add({ severity: 'success', summary: 'Approval requested', detail: `${d.docNo} is waiting for ${delivery.value?.approval.waitingFor ?? 'the Sales Manager'}.`, life: 4000 })
  } finally {
    saving.value = false
  }
}

function deleteDraft() {
  const d = delivery.value!
  confirm.require({
    header: `Delete ${d.docNo}?`,
    message: `The draft is removed and ${d.order.no} goes back to the waiting list. ${d.docNo} is not used again.`,
    acceptLabel: 'Delete draft',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesDeliveriesApi.remove(d.id, d.version)
      toast.add({ severity: 'success', summary: `${d.docNo} deleted`, life: 3000 })
      void router.push('/sales/deliveries')
    },
  })
}

function printLater() {
  toast.add({ severity: 'info', summary: 'Print DO', detail: 'The printed delivery order comes with the print step.', life: 3000 })
}

// ── Proof of delivery ────────────────────────────────────────────────────────
async function upload(file: File) {
  const d = delivery.value!
  uploading.value = true
  try {
    const f = await salesFilesApi.upload(file, 'PROOF_OF_DELIVERY', 'SAL_DELIVERY', d.id)
    d.attachments = [...d.attachments, { id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: 'PROOF_OF_DELIVERY', downloadUrl: f.downloadUrl }]
    toast.add({ severity: 'success', summary: `${f.fileName} attached`, life: 2500 })
  } finally {
    uploading.value = false
  }
}
async function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file && can('attach')) await upload(file)
}
async function onBrowse(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await upload(file)
}

const confirmed = computed(() => delivery.value?.status === 'CONFIRMED')
const credit = computed(() => delivery.value?.credit.snapshot ?? null)
const showCreditFailed = computed(() => Boolean(delivery.value && !confirmed.value && delivery.value.approval.state !== 'PENDING' && (delivery.value.credit.needsApproval || delivery.value.credit.blocked)))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="delivery">
    <PageHeader :title="confirmed ? `Delivery order ${delivery.docNo}` : `Confirm delivery ${delivery.docNo}`" document>
      <template #chip><StatusChip :status="delivery.status" :label="delivery.statusLabel" :group="confirmed ? 'released' : 'draft'" /></template>
      <template #subtitle>
        From
        <RouterLink v-if="delivery.order.id" :to="`/sales/orders/${delivery.order.id}`" class="erp-link">{{ delivery.order.no }}</RouterLink>
        <template v-else>{{ delivery.order.no }}</template>
        · {{ delivery.customer.name }}
      </template>
      <template #actions>
        <RouterLink to="/sales/deliveries" class="erp-btn erp-btn-secondary">{{ editable ? 'Cancel' : 'Back' }}</RouterLink>
        <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteDraft">Delete draft</button>
        <button type="button" class="erp-btn erp-btn-secondary" @click="printLater">Print DO</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || !dirty" @click="save">Save draft</button>
        <button v-if="!confirmed" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !can('confirm') || Boolean(delivery.depositHold)" @click="confirmDelivery">Confirm delivery</button>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <NoticeBanner v-if="!delivery.inventoryConnected">
        <strong>Inventory is not connected yet.</strong> Delivery is confirmed here in Sales and the event is saved. When the Inventory module is plugged in, picking and delivery move there, and this screen shows its status instead.
      </NoticeBanner>
      <NoticeBanner v-if="confirmed">
        <span class="inline-flex items-center gap-2">
          <Lock :size="14" aria-hidden="true" />
          Delivered{{ delivery.confirmedAt ? ` ${formatDateTime(delivery.confirmedAt)}` : '' }}{{ delivery.confirmedByName ? ` by ${delivery.confirmedByName}` : '' }}. The DO is locked; mistakes are fixed with a sales return.
        </span>
      </NoticeBanner>
      <NoticeBanner v-if="delivery.depositHold" kind="error">
        <strong>Delivery is on hold.</strong> The deposit on {{ delivery.depositHold.proformaNo }} ({{ formatRm(delivery.depositHold.amount) }}) is not paid yet. Confirm becomes possible once Finance records the payment.
      </NoticeBanner>
      <NoticeBanner v-if="delivery.approval.state === 'PENDING'" kind="warning">
        Waiting for <strong>{{ delivery.approval.waitingFor }}</strong> to approve: {{ delivery.approval.reason }}. The DO is locked until someone decides.
      </NoticeBanner>
      <NoticeBanner v-else-if="delivery.approval.state === 'REJECTED' && !confirmed" kind="error">
        Rejected by {{ delivery.approval.decidedBy }}<template v-if="delivery.approval.comment">: “{{ delivery.approval.comment }}”</template>. Wait for the customer to pay, or request approval again.
      </NoticeBanner>
      <NoticeBanner v-else-if="delivery.approval.state === 'APPROVED' && !confirmed">
        Credit approved by {{ delivery.approval.decidedBy }}<template v-if="delivery.approval.comment"> · “{{ delivery.approval.comment }}”</template>. You can confirm the delivery.
      </NoticeBanner>
      <NoticeBanner v-if="delivery.credit.warning && !confirmed" kind="warning">
        Credit warning: the customer is over the credit limit by {{ formatRm(delivery.credit.warning.overCredit) }}. The delivery is allowed; the warning is logged.
      </NoticeBanner>

      <div class="grid items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="erp-card grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-[18px]">
            <FormField label="Delivery date" for="do-date">
              <DatePicker v-if="editable" input-id="do-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
            <FormField label="Vehicle · driver" for="do-vehicle">
              <div v-if="editable" class="flex gap-2">
                <input id="do-vehicle" v-model="form.vehicle" class="erp-input min-w-0" placeholder="Vehicle" maxlength="30" aria-label="Vehicle" />
                <input v-model="form.driver" class="erp-input min-w-0" placeholder="Driver" maxlength="60" aria-label="Driver" />
              </div>
              <div v-else class="erp-input-ro">{{ [form.vehicle, form.driver].filter(Boolean).join(' · ') || '—' }}</div>
            </FormField>
            <FormField label="Consignment note" for="do-cn">
              <input v-if="editable" id="do-cn" v-model="form.consignmentNote" class="erp-input" maxlength="50" />
              <div v-else class="erp-input-ro">{{ form.consignmentNote || '—' }}</div>
            </FormField>
            <FormField class="col-span-2" label="Deliver to" for="do-to">
              <input v-if="editable" id="do-to" v-model="form.deliverTo" class="erp-input" maxlength="300" />
              <div v-else class="erp-input-ro">{{ form.deliverTo || '—' }}</div>
            </FormField>
            <FormField label="Receiver" for="do-receiver">
              <input v-if="editable" id="do-receiver" v-model="form.receiver" class="erp-input" maxlength="100" />
              <div v-else class="erp-input-ro">{{ form.receiver || '—' }}</div>
            </FormField>
            <FormField class="col-span-3" label="Warehouse note" for="do-note">
              <input v-if="editable" id="do-note" v-model="form.warehouseNote" class="erp-input" maxlength="2000" />
              <div v-else class="erp-input-ro">{{ form.warehouseNote || '—' }}</div>
            </FormField>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">What is being delivered</h2>
            <div class="overflow-x-auto">
              <table class="erp-table">
                <thead>
                  <tr>
                    <th>Item</th><th>Description</th><th class="num">Ordered</th><th class="num">Delivered before</th><th class="num">Balance</th>
                    <th class="num">{{ confirmed ? 'Delivered' : 'Deliver now' }}</th><th class="num">Left after</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in delivery.lines" :key="l.id">
                    <td class="font-bold whitespace-nowrap">{{ l.itemCode }}</td>
                    <td>{{ l.itemName }}</td>
                    <td class="num">{{ formatQty(l.orderedQty) }}</td>
                    <td class="num">{{ formatQty(l.deliveredBeforeQty) }}</td>
                    <td class="num">{{ formatQty(l.balanceQty) }}</td>
                    <td class="num w-[110px]">
                      <input
                        v-if="editable && form.lines[i]"
                        v-model="form.lines[i].qty"
                        class="erp-cell min-w-[80px] border-2 border-mod-primary font-bold"
                        inputmode="decimal"
                        :aria-invalid="Boolean(errors[`lines[${i}].qty`])"
                        :aria-label="`Deliver now, ${l.itemCode}`"
                      />
                      <span v-else class="font-bold">{{ formatQty(l.qty) }}</span>
                    </td>
                    <td class="num font-bold text-mod-accent">{{ confirmed ? formatQty(l.leftAfterQty) : leftAfter(l) === null ? '—' : formatQty(String(leftAfter(l))) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-for="(l, i) in delivery.lines" v-show="errors[`lines[${i}].qty`]" :key="`e-${l.id}`" class="m-0 text-xs font-medium text-note-error-text">{{ l.itemCode }}: {{ errors[`lines[${i}].qty`] }}</p>
            <p v-if="!confirmed" class="m-0 text-xs text-erp-muted">
              Deliver now cannot be more than the balance<template v-if="delivery.lines.length === 1"> ({{ formatQty(firstBalance) }})</template>. The rest stays open on the order.
            </p>
          </section>

          <!-- Credit check on delivery (policy: over the overdue limit needs Sales Manager approval) -->
          <section v-if="showCreditFailed && credit" class="flex flex-col gap-3 rounded-xl border-2 border-note-error-border bg-erp-card px-5 py-[18px]">
            <div>
              <h2 class="m-0 text-[15px] font-bold text-note-error-text">Credit check did not pass</h2>
              <p class="m-0 mt-0.5 text-xs text-erp-muted">{{ delivery.customer.name }} ({{ delivery.customer.code }}) · {{ delivery.docNo }} · checked {{ credit.scope === 'BRANCH' ? 'per branch' : 'group-wide' }}</p>
            </div>
            <table class="erp-table">
              <thead><tr><th>Check</th><th class="num">Limit</th><th class="num">Now</th><th class="num">This delivery</th><th>Result</th></tr></thead>
              <tbody>
                <tr>
                  <td class="font-semibold">Credit limit</td>
                  <td class="num">{{ credit.creditLimit ? formatMoney(credit.creditLimit) : 'No limit' }}</td>
                  <td class="num">{{ formatMoney((Number(credit.owed) + Number(credit.otherOpen)).toFixed(2)) }}</td>
                  <td class="num">{{ formatMoney(credit.thisDocument) }}</td>
                  <td :class="Number(credit.overCredit) > 0 ? 'font-semibold text-attention' : 'text-chip-done-text'">{{ Number(credit.overCredit) > 0 ? `Over by ${formatMoney(credit.overCredit)}` : 'Within limit' }}</td>
                </tr>
                <tr>
                  <td class="font-semibold">Overdue limit</td>
                  <td class="num">{{ credit.overdueLimit ? formatMoney(credit.overdueLimit) : 'No limit' }}</td>
                  <td class="num">{{ formatMoney(credit.overdue) }}</td>
                  <td class="num">—</td>
                  <td :class="Number(credit.overOverdue) > 0 ? 'font-semibold text-note-error-text' : 'text-chip-done-text'">{{ Number(credit.overOverdue) > 0 ? `Over by ${formatMoney(credit.overOverdue)}` : 'Within limit' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="m-0 text-[13px]">
              <template v-if="delivery.credit.blocked">Policy for <strong>Delivery order</strong>: block. This delivery cannot be confirmed; ask Finance.</template>
              <template v-else>Policy for <strong>Delivery order</strong>: require approval. </template>
              <RouterLink to="/sales/settings/credit-control" class="erp-link">See credit control policy</RouterLink>
            </p>
            <template v-if="can('requestApproval')">
              <FormField label="Reason for the approver" :error="reasonError" for="do-reason">
                <textarea id="do-reason" v-model="reason" rows="2" class="erp-input h-auto py-2" maxlength="1000" :aria-invalid="Boolean(reasonError)" />
              </FormField>
              <p class="m-0 text-xs text-erp-muted">Send to {{ roleLabel(delivery.credit.approverRole ?? 'SALES_MANAGER') }}. Confirm stays blocked until it is approved.</p>
              <div class="flex justify-end">
                <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="requestApproval">Request approval</button>
              </div>
            </template>
          </section>

          <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
            <h2 class="m-0 text-[15px] font-bold">Proof of delivery</h2>
            <label
              v-if="can('attach')"
              class="flex min-h-[90px] cursor-pointer items-center justify-center rounded-[10px] border-2 border-dashed px-4 text-[13px] text-erp-subtle"
              :class="dragging ? 'border-mod-primary bg-mod-light' : 'border-erp-input'"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              <span v-if="uploading">Uploading…</span>
              <span v-else>Drop the signed DO or a photo here, or <span class="font-semibold text-mod-accent">browse</span></span>
              <input type="file" accept="image/*,application/pdf" class="hidden" :disabled="uploading" @change="onBrowse" />
            </label>
            <FileTiles v-if="delivery.attachments.length || !can('attach')" :files="delivery.attachments" />
          </section>

          <ActivityList :items="delivery.activity" />
        </div>

        <aside class="flex flex-col gap-4">
          <NextSteps v-if="!confirmed" title="When you confirm">
            <li>
              <span>
                {{ delivery.order.no }} balance goes from {{ formatQty(String(balanceBefore)) }} to <strong>{{ formatQty(String(balanceAfter)) }}</strong>. Its status becomes
                {{ balanceAfter === 0 ? 'Done' : 'Partial' }}.
              </span>
            </li>
            <li><span>{{ formatQty(String(deliverNow)) }} {{ uomText }} can now be invoiced from the order.</span></li>
            <li><span>The event <code>sales.shipment.requested</code> is saved for Inventory to pick up later.</span></li>
            <li><span>The DO is locked. Mistakes are fixed with a return, not an edit.</span></li>
          </NextSteps>

          <SideCard :title="`${delivery.order.no} progress`">
            <div class="flex h-2 overflow-hidden rounded bg-erp-track" role="progressbar" :aria-valuenow="progress.pct" aria-valuemin="0" aria-valuemax="100">
              <div class="h-full bg-mod-primary" :style="{ width: `${progress.pct}%` }" />
            </div>
            <div class="flex justify-between text-xs text-erp-subtle">
              <span>{{ confirmed ? 'After' : 'After this DO' }}: {{ formatQty(String(progress.delivered)) }} of {{ formatQty(String(progress.ordered)) }} delivered</span>
              <span class="font-bold text-erp-text">{{ progress.pct }}%</span>
            </div>
            <div class="flex flex-col text-[13px]">
              <div class="flex justify-between gap-3 py-[3px]"><span class="text-erp-muted">In stock now</span><span class="erp-num">{{ formatQty(String(inStock)) }}</span></div>
              <div class="flex justify-between gap-3 py-[3px]"><span class="text-erp-muted">Wanted by</span><span>{{ formatDate(delivery.order.wantedBy ?? '') || '—' }}</span></div>
              <div class="flex justify-between gap-3 py-[3px]"><span class="text-erp-muted">Sales agent</span><span>{{ delivery.order.agentName ?? '—' }}</span></div>
            </div>
          </SideCard>

          <LinkedDocs v-if="delivery.links.length" :docs="delivery.links" :route-of="docRoute" />
        </aside>
      </div>
    </div>
  </template>
</template>
