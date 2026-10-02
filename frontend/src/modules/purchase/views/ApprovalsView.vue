<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { Check } from '@lucide/vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { roleLabel, useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatMoney, formatPrice, formatQty, formatShortDate, formatRm } from '@/utils/format'
import { approvalsApi } from '../api/purchase'
import { docRoute } from '../routes'
import type { InboxDetail, InboxItem, InboxList } from '../types'

/** P02 · Purchase approvals (PurApprovals.html): orders over the limit and invoices that don't match. */
type Tab = 'waiting' | 'approved' | 'rejected'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user } = useSession()

const tab = computed<Tab>(() => {
  const s = route.query.status
  return s === 'approved' || s === 'rejected' ? s : 'waiting'
})
const selectedId = computed(() => (typeof route.query.id === 'string' ? route.query.id : null))

const list = ref<InboxList | null>(null)
const detail = ref<InboxDetail | null>(null)
const loadingList = ref(true)
const loadingDetail = ref(false)
const comment = ref('')
const commentError = ref('')
const deciding = ref(false)

const TABS: { key: Tab; label: string }[] = [
  { key: 'waiting', label: 'Waiting for me' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

function go(query: { status?: Tab; id?: string | null }) {
  const status = query.status ?? tab.value
  const id = query.id === undefined ? selectedId.value : query.id
  void router.replace({ query: { ...(status !== 'waiting' && { status }), ...(id && { id }) } })
}

async function loadList() {
  loadingList.value = true
  try {
    list.value = await approvalsApi.list(tab.value)
    // Keep the selection if it is still in the list, else open the first one.
    const items = list.value.items
    if (!selectedId.value || !items.some((i) => i.id === selectedId.value)) {
      go({ id: items[0]?.id ?? null })
    }
  } finally {
    loadingList.value = false
  }
}

async function loadDetail(id: string | null) {
  comment.value = ''
  commentError.value = ''
  if (!id) {
    detail.value = null
    return
  }
  loadingDetail.value = true
  try {
    detail.value = await approvalsApi.get(id)
  } catch {
    detail.value = null
  } finally {
    loadingDetail.value = false
  }
}

watch(tab, () => void loadList(), { immediate: true })
watch(selectedId, (id) => void loadDetail(id), { immediate: true })

const signedInAs = computed(() => (user.value ? `Signed in as ${user.value.name}, ${roleLabel(user.value.roles[0] ?? '')}.` : ''))

function sentLine(item: InboxItem): string {
  if (item.draftedFrom) return `Drafted automatically from ${item.draftedFrom.salesOrderNo} · ${formatDateTime(item.draftedFrom.at)}`
  return `Sent by ${item.requestedByName} · ${formatDateTime(item.requestedAt)}`
}

// ── Decision ─────────────────────────────────────────────────────────────────
const doc = computed(() => detail.value?.document ?? null)
const isWaiting = computed(() => detail.value?.status === 'PENDING')

const approveLabel = computed(() => {
  const d = doc.value
  if (!d) return 'Approve'
  if (d.kind === 'INVOICE' && Number(d.difference.amount) !== 0) return `Approve RM ${formatMoney(d.difference.amount.replace('-', ''))}`
  return `Approve RM ${formatMoney(d.total)}`
})
const rejectLabel = computed(() =>
  doc.value?.kind === 'INVOICE' ? 'Reject · ask for new bill' : doc.value?.kind === 'DEBIT_NOTE' ? 'Reject · do not pay' : 'Reject · back to draft',
)
const PANEL_TITLE = { ORDER: 'order to approve', INVOICE: 'three-way match', DEBIT_NOTE: 'extra charge' } as const
const OPEN_LABEL = { ORDER: 'Open order', INVOICE: 'Open invoice', DEBIT_NOTE: 'Open debit note' } as const
const footnote = computed(() => {
  const d = doc.value
  if (!d || !detail.value) return ''
  if (d.kind === 'ORDER') return `Approving lets ${d.buyerName} release ${d.docNo} for RM ${formatMoney(d.total)}. Your decision is logged.`
  if (d.kind === 'DEBIT_NOTE') return `Approving adds RM ${formatMoney(d.total)} to ${d.invoiceNo} and queues it for Finance. Your decision is logged.`
  return `Approving records ${d.docNo} for RM ${formatMoney(d.billedTotal)} and queues it for Finance. Your decision is logged.`
})
const openDocument = computed(() => (detail.value ? docRoute(detail.value.entityType, detail.value.entityId) : null))

async function decide(decision: 'approve' | 'reject') {
  if (!detail.value) return
  commentError.value = ''
  if (decision === 'reject' && !comment.value.trim()) {
    commentError.value = 'Please add a comment so the requester knows why it was rejected.'
    return
  }
  deciding.value = true
  const d = detail.value
  try {
    const result =
      decision === 'approve' ? await approvalsApi.approve(d.id, comment.value.trim()) : await approvalsApi.reject(d.id, comment.value.trim())
    const what =
      result.outcome === 'NEXT_STEP'
        ? 'Approved · now waiting for the next approver.'
        : decision === 'reject'
          ? `${d.requestedByName} sees your comment.`
          : d.entityType === 'PUR_ORDER'
            ? `${d.requestedByName} can release it now.`
            : 'Recorded as billed and queued for Finance.'
    toast.add({ severity: 'success', summary: `${d.docNo} ${decision === 'approve' ? 'approved' : 'rejected'}`, detail: what, life: 4000 })
    notifyApprovalsChanged()
    go({ id: null })
    await loadList()
  } finally {
    deciding.value = false
  }
}
</script>

<template>
  <div class="flex items-end justify-between gap-4">
    <div>
      <h1 class="m-0 text-xl font-bold">Purchase approvals</h1>
      <p class="mt-1 mb-0 text-xs text-erp-muted">Orders over the limit and supplier invoices that don't match. {{ signedInAs }}</p>
    </div>
    <div class="flex gap-6" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        class="-mb-px border-0 border-b-2 border-solid bg-transparent px-0 pb-2 font-[inherit] text-[13px] font-semibold whitespace-nowrap"
        :class="tab === t.key ? 'border-mod-line text-mod-accent' : 'border-transparent text-erp-muted hover:text-erp-text'"
        @click="go({ status: t.key, id: null })"
      >
        {{ t.label }} · {{ list?.counts[t.key] ?? 0 }}
      </button>
    </div>
  </div>

  <div class="grid grow grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-stretch gap-4">
    <!-- Left: cards and recent decisions -->
    <div class="flex min-w-0 flex-col gap-3">
      <div v-if="loadingList && !list" class="erp-card px-5 py-8 text-center text-[13px] text-erp-muted">Loading…</div>
      <div v-else-if="!list?.items.length" class="erp-card px-5 py-8 text-center text-[13px] text-erp-muted">
        {{ tab === 'waiting' ? 'Nothing is waiting for you.' : tab === 'approved' ? 'You have not approved anything yet.' : 'You have not rejected anything yet.' }}
      </div>
      <button
        v-for="item in list?.items ?? []"
        :key="item.id"
        type="button"
        class="erp-card flex w-full flex-col gap-1.5 px-5 py-4 text-left font-[inherit] text-erp-text"
        :class="item.id === selectedId ? '!border-2 !border-mod-line !bg-mod-light px-[19px] py-[15px]' : 'hover:shadow-sm'"
        :aria-pressed="item.id === selectedId"
        @click="go({ id: item.id })"
      >
        <span class="flex items-center justify-between gap-3">
          <span class="text-[15px] font-bold">{{ item.title }}</span>
          <StatusChip v-if="item.myDecision" :status="item.myDecision" />
          <StatusChip v-else status="PENDING_APPROVAL" :label="item.kind" />
        </span>
        <span class="text-[13px]">{{ item.reason }}</span>
        <span class="flex items-center justify-between gap-3">
          <span class="text-xs text-erp-muted">{{ sentLine(item) }}</span>
          <strong v-if="item.amount" class="text-[13px] erp-num">{{ formatRm(item.amount) }}</strong>
        </span>
      </button>

      <section class="erp-card flex flex-col gap-2 px-5 py-4">
        <div class="flex items-center justify-between">
          <h2 class="m-0 text-[15px] font-bold">You decided in the last 7 days</h2>
          <span class="text-xs text-erp-muted">{{ list?.recentDecisions.length ?? 0 }} {{ list?.recentDecisions.length === 1 ? 'decision' : 'decisions' }}</span>
        </div>
        <p v-if="list && !list.recentDecisions.length" class="m-0 text-[13px] text-erp-muted">No decisions in the last 7 days.</p>
        <table v-else class="erp-table">
          <thead>
            <tr><th>Document</th><th>Reason</th><th>Decision</th><th>When</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in list?.recentDecisions ?? []" :key="r.requestId">
              <td class="font-bold whitespace-nowrap">{{ r.docNo }}</td>
              <td>{{ r.reason }}</td>
              <td><StatusChip :status="r.decision" /></td>
              <td class="whitespace-nowrap">{{ formatShortDate(r.decidedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Right: the selected approval -->
    <section class="erp-card flex min-w-0 flex-col gap-4 px-5 py-[18px]">
      <div v-if="loadingDetail" class="py-10 text-center text-[13px] text-erp-muted">Loading…</div>
      <div v-else-if="!detail || !doc" class="py-10 text-center text-[13px] text-erp-muted">Pick an approval on the left to see the details.</div>

      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 text-base font-bold">{{ doc.docNo }} · {{ PANEL_TITLE[doc.kind] }}</h2>
          <RouterLink v-if="openDocument" :to="openDocument" class="erp-link text-[13px] font-semibold">
            {{ OPEN_LABEL[doc.kind] }}
          </RouterLink>
        </div>

        <!-- Supplier debit note: the charges and the check against the PO -->
        <template v-if="doc.kind === 'DEBIT_NOTE'">
          <table class="erp-table">
            <thead>
              <tr><th>Charge</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in doc.lines" :key="l.itemCode">
                <td><div class="font-bold">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                <td class="num">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
                <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num">{{ formatMoney(l.amount) }}</td>
              </tr>
            </tbody>
          </table>
          <NoticeBanner v-if="doc.check" kind="warning">{{ doc.check }}</NoticeBanner>
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Debit note total</span><strong class="erp-num">{{ formatRm(doc.total) }}</strong>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Their note · adds to</span><span>{{ doc.theirNoteNo }} · {{ doc.invoiceNo }}</span>
            </div>
            <div v-if="doc.afterTotal" class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">{{ doc.invoiceNo }} after this note</span>
              <span class="erp-num">RM {{ formatMoney(doc.invoiceTotal ?? '0') }} → <strong>RM {{ formatMoney(doc.afterTotal) }}</strong></span>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Why approval is needed</span><span class="max-w-[65%] text-right">{{ detail.reason }}</span>
            </div>
          </div>
        </template>

        <!-- Invoice: three-way match -->
        <template v-else-if="doc.kind === 'INVOICE'">
          <table class="erp-table">
            <thead>
              <tr><th /><th class="num">Order</th><th class="num">Received</th><th class="num">Billed</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-bold">Quantity</td>
                <td class="num">{{ formatQty(doc.quantity.order) }}</td>
                <td class="num">{{ formatQty(doc.quantity.received) }}</td>
                <td class="num font-bold" :class="doc.quantity.ok ? '' : 'text-note-error-text'">
                  {{ formatQty(doc.quantity.billed) }}
                  <Check v-if="doc.quantity.ok" :size="14" class="inline text-chip-done-text" aria-label="matches" />
                </td>
              </tr>
              <tr v-if="doc.unitPrice">
                <td class="font-bold">Unit price</td>
                <td class="num">{{ formatPrice(doc.unitPrice.order) }}</td>
                <td class="num text-erp-muted">—</td>
                <td class="num font-bold" :class="doc.unitPrice.ok ? '' : 'text-note-error-text'">{{ formatPrice(doc.unitPrice.billed) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Difference</span>
              <strong class="erp-num" :class="Number(doc.difference.amount) > 0 ? 'text-note-error-text' : ''">
                {{ Number(doc.difference.amount) >= 0 ? '+' : '−' }} RM {{ formatMoney(doc.difference.amount.replace('-', '')) }}
                <template v-if="doc.difference.pct">({{ doc.difference.pct.replace('-', '') }}%)</template>
              </strong>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Allowed tolerance</span><span>{{ doc.tolerance }}</span>
            </div>
            <div v-if="doc.supplierNote" class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Supplier's note</span><span class="text-right">{{ doc.supplierNote }}</span>
            </div>
          </div>
        </template>

        <!-- Purchase order -->
        <template v-else>
          <table class="erp-table">
            <thead>
              <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in doc.lines" :key="l.itemCode">
                <td><div class="font-bold">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                <td class="num whitespace-nowrap">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
                <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num"><MoneyText :value="l.amount" /></td>
              </tr>
            </tbody>
          </table>
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Order total</span><strong class="erp-num">{{ formatRm(doc.total) }}</strong>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Why approval is needed</span><span class="max-w-[65%] text-right">{{ detail.reason }}</span>
            </div>
            <div v-if="doc.award" class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Why this supplier · {{ doc.award.rfqNo }}</span>
              <span class="max-w-[65%] text-right">{{ doc.award.reason }}</span>
            </div>
            <div v-if="doc.salesOrder" class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Customer order</span>
              <span class="text-right erp-num">
                {{ doc.salesOrder.no }} · {{ doc.salesOrder.customerName }} · RM {{ formatMoney(doc.salesOrder.total) }}
                <template v-if="doc.salesOrder.marginPct"> · margin {{ doc.salesOrder.marginPct }}%</template>
              </span>
            </div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2">
              <span class="text-erp-muted">Deliver to</span>
              <span>{{ doc.warehouseName }}<template v-if="doc.expectedDate"> · {{ formatDate(doc.expectedDate) }}</template></span>
            </div>
          </div>
        </template>

        <div v-if="detail.requesterNote" class="rounded-[10px] bg-erp-head px-3.5 py-3 text-[13px] leading-normal">
          <strong>{{ detail.requestedByName }} wrote:</strong> {{ detail.requesterNote }}
        </div>

        <!-- Already decided (Approved / Rejected tabs) -->
        <template v-if="!isWaiting">
          <NoticeBanner :kind="detail.status === 'REJECTED' ? 'error' : 'info'">
            <template v-for="s in detail.steps.filter((s) => s.decidedAt)" :key="s.stepNo">
              {{ s.status === 'APPROVED' ? 'Approved' : 'Rejected' }} by {{ s.decidedByName }} on {{ formatDateTime(s.decidedAt!) }}.
              <template v-if="s.comment">“{{ s.comment }}”</template><br />
            </template>
          </NoticeBanner>
        </template>

        <!-- Waiting: decide -->
        <template v-else>
          <NoticeBanner v-if="!detail.canDecide" kind="error">{{ detail.cannotDecideReason }}</NoticeBanner>
          <template v-else>
            <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted" for="decision-comment">
              Your comment
              <textarea
                id="decision-comment"
                v-model="comment"
                class="erp-input"
                maxlength="1000"
                :aria-invalid="Boolean(commentError)"
                :placeholder="`Visible to ${detail.requestedByName} and in the audit trail`"
              />
              <span v-if="commentError" class="text-note-error-text" role="alert">{{ commentError }}</span>
            </label>
            <div class="mt-auto flex flex-col gap-2 pt-2">
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="erp-btn erp-btn-danger h-10" :disabled="deciding" @click="decide('reject')">{{ rejectLabel }}</button>
                <button type="button" class="erp-btn erp-btn-primary h-10" :disabled="deciding" @click="decide('approve')">{{ approveLabel }}</button>
              </div>
              <p class="m-0 text-xs text-erp-muted">{{ footnote }}</p>
            </div>
          </template>
        </template>
      </template>
    </section>
  </div>
</template>
