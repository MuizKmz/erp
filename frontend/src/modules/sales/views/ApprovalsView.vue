<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import StatusChip from '@/components/erp/StatusChip.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { roleLabel, useSession } from '@/composables/useSession'
import { formatDate, formatDateTime, formatMoney, formatPrice, formatQty, formatRm, formatShortDate } from '@/utils/format'
import { salesApprovalsApi } from '../api/sales'
import { docRoute } from '../routes'
import type { ApprovalKind, InboxDetail, InboxList } from '../types'

/** S02 · Sales approvals (Approvals.html): credit on orders, prices on invoices, discounts on quotations. */
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
const KIND_GROUP: Record<ApprovalKind, 'pending' | 'partial'> = { CREDIT: 'pending', PRICE: 'partial', DISCOUNT: 'partial' }

function go(query: { status?: Tab; id?: string | null }) {
  const status = query.status ?? tab.value
  const id = query.id === undefined ? selectedId.value : query.id
  void router.replace({ query: { ...(status !== 'waiting' && { status }), ...(id && { id }) } })
}

async function loadList() {
  loadingList.value = true
  try {
    list.value = await salesApprovalsApi.list(tab.value)
    const items = list.value.items
    if (!selectedId.value || !items.some((i) => i.id === selectedId.value)) go({ id: items[0]?.id ?? null })
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
    detail.value = await salesApprovalsApi.get(id)
  } catch {
    detail.value = null
  } finally {
    loadingDetail.value = false
  }
}

watch(tab, () => void loadList(), { immediate: true })
watch(selectedId, (id) => void loadDetail(id), { immediate: true })

const signedInAs = computed(() => (user.value ? `Signed in as ${user.value.name}, ${roleLabel(user.value.roles[0] ?? '')}.` : ''))
const firstName = (name: string) => name.split(' ')[0]

const OPEN_LABEL: Record<string, string> = { SAL_ORDER: 'Open order', SAL_INVOICE: 'Open invoice', SAL_QUOTATION: 'Open quotation' }
const openDocument = computed(() => (detail.value ? docRoute(detail.value.entityType, detail.value.entityId) : null))
const footnote = computed(() => {
  const d = detail.value
  if (!d) return ''
  return `Approving lets ${firstName(d.requestedByName)} release ${d.docNo}. Your decision is logged with the time and your comment.`
})

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
    const result = decision === 'approve' ? await salesApprovalsApi.approve(d.id, comment.value.trim()) : await salesApprovalsApi.reject(d.id, comment.value.trim())
    const what =
      result.outcome === 'NEXT_STEP'
        ? 'Approved · now waiting for the next approver.'
        : decision === 'reject'
          ? `${firstName(d.requestedByName)} sees your comment. The document is back to draft.`
          : `${firstName(d.requestedByName)} can release it now.`
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
      <h1 class="m-0 text-xl font-bold">Approvals</h1>
      <p class="mt-1 mb-0 text-xs text-erp-muted">Documents that a policy stopped until someone decides. {{ signedInAs }}</p>
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
          <StatusChip v-else :status="item.kind" :label="item.kindLabel" :group="KIND_GROUP[item.kind]" />
        </span>
        <span class="text-[13px]">{{ item.reason }}</span>
        <span class="flex items-center justify-between gap-3">
          <span class="text-xs text-erp-muted">Requested by {{ item.requestedByName }} · {{ formatDateTime(item.requestedAt) }}</span>
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
      <div v-else-if="!detail" class="py-10 text-center text-[13px] text-erp-muted">Pick an approval on the left to see the details.</div>
      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 text-base font-bold">{{ detail.title }}</h2>
          <RouterLink v-if="openDocument" :to="openDocument" class="erp-link text-[13px] font-semibold">{{ OPEN_LABEL[detail.entityType] ?? 'Open document' }}</RouterLink>
        </div>

        <!-- Credit: exposure and history (Approvals.html) -->
        <template v-if="detail.panel.type === 'CREDIT'">
          <div class="flex flex-col text-[13px] erp-num">
            <div class="flex justify-between gap-3 border-b border-erp-row py-2"><span>Owed now</span><span>{{ formatRm(detail.panel.owedNow) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2 pl-3 text-erp-muted"><span>of which over 60 days</span><span>{{ formatRm(detail.panel.over60) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2"><span>Other open orders</span><span>{{ formatRm(detail.panel.otherOpen) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2"><span>This order</span><span>{{ formatRm(detail.panel.thisOrder) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2 font-bold"><span>Exposure after</span><span>{{ formatRm(detail.panel.exposureAfter) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-2"><span>Credit limit</span><span>{{ detail.panel.creditLimit ? formatRm(detail.panel.creditLimit) : 'No limit' }}</span></div>
            <div class="flex justify-between gap-3 py-2">
              <span>Last payment</span>
              <span>{{ detail.panel.lastPayment ? `${formatRm(detail.panel.lastPayment.amount)} on ${formatDate(detail.panel.lastPayment.date)}` : 'None yet' }}</span>
            </div>
          </div>
          <div v-if="detail.requesterNote" class="rounded-lg bg-erp-head px-4 py-3 text-[13px]">
            <strong>{{ firstName(detail.requestedByName) }} wrote:</strong> {{ detail.requesterNote }}
          </div>
          <div class="flex flex-col gap-1.5">
            <h3 class="m-0 text-[13px] font-bold">Recent history · {{ detail.panel.customerName }}</h3>
            <div v-for="h in detail.panel.history" :key="h.docNo" class="flex justify-between gap-3 text-[13px]">
              <span>{{ h.docNo }} · {{ formatRm(h.total) }}</span><span :class="h.paid.includes('late') ? 'text-attention' : 'text-chip-done-text'">{{ h.paid }}</span>
            </div>
            <div class="flex justify-between gap-3 text-[13px]">
              <span>Last credit approval</span><span class="text-erp-muted">{{ detail.panel.lastCreditApproval ? `Approved ${formatDate(detail.panel.lastCreditApproval)}` : 'None' }}</span>
            </div>
          </div>
        </template>

        <!-- Price below the price list (invoice) -->
        <template v-else-if="detail.panel.type === 'PRICE'">
          <table class="erp-table">
            <thead>
              <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Price list</th><th class="num">Below</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in detail.panel.lines" :key="l.itemCode">
                <td><div class="font-bold">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                <td class="num">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
                <td class="num font-bold">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num">{{ l.listPrice ? formatPrice(l.listPrice) : '—' }}</td>
                <td class="num" :class="l.belowPct ? 'font-semibold text-note-error-text' : ''">{{ l.belowPct ? `${l.belowPct}%` : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="flex justify-between gap-3 text-[13px]"><span class="text-erp-muted">Invoice total</span><strong class="erp-num">{{ formatRm(detail.panel.total) }}</strong></div>
          <div v-if="detail.requesterNote" class="rounded-lg bg-erp-head px-4 py-3 text-[13px]"><strong>{{ firstName(detail.requestedByName) }} wrote:</strong> {{ detail.requesterNote }}</div>
        </template>

        <!-- Discount above the rule (quotation) -->
        <template v-else>
          <table class="erp-table">
            <thead>
              <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Disc %</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in detail.panel.lines" :key="l.itemCode">
                <td><div class="font-bold">{{ l.itemCode }}</div><div class="text-xs text-erp-muted">{{ l.itemName }}</div></td>
                <td class="num">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
                <td class="num">{{ formatPrice(l.unitPrice) }}</td>
                <td class="num font-bold">{{ Number(l.discountPct) ? `${Number(l.discountPct)}%` : '—' }}</td>
                <td class="num">{{ formatMoney(l.amount) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="flex justify-between gap-3 text-[13px]">
            <span class="text-erp-muted">Quotation total<template v-if="detail.panel.marginPct"> · est. margin {{ detail.panel.marginPct }}%</template></span>
            <strong class="erp-num">{{ formatRm(detail.panel.total) }}</strong>
          </div>
          <div v-if="detail.requesterNote" class="rounded-lg bg-erp-head px-4 py-3 text-[13px]"><strong>{{ firstName(detail.requestedByName) }} wrote:</strong> {{ detail.requesterNote }}</div>
        </template>

        <!-- Decision -->
        <template v-if="detail.status === 'PENDING' && detail.canDecide">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold" for="approval-comment">
            Your comment
            <textarea id="approval-comment" v-model="comment" rows="3" class="erp-input h-auto py-2 font-normal" maxlength="1000" :aria-invalid="Boolean(commentError)" />
            <span v-if="commentError" class="text-xs font-normal text-note-error-text">{{ commentError }}</span>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="erp-btn erp-btn-danger h-10" :disabled="deciding" @click="decide('reject')">Reject</button>
            <button type="button" class="erp-btn erp-btn-primary h-10" :disabled="deciding" @click="decide('approve')">Approve</button>
          </div>
          <p class="m-0 text-xs text-erp-muted">{{ footnote }}</p>
        </template>
        <p v-else-if="detail.status === 'PENDING'" class="m-0 rounded-lg bg-erp-head px-4 py-3 text-[13px] text-erp-muted">
          {{ detail.requestedByName === user?.name ? 'You asked for this approval, so someone else must decide it.' : 'This approval waits for someone else.' }}
        </p>
        <div v-else-if="detail.decision" class="rounded-lg bg-erp-head px-4 py-3 text-[13px]">
          {{ detail.decision.status === 'APPROVED' ? 'Approved' : 'Rejected' }} by {{ detail.decision.byName }}<template v-if="detail.decision.at"> on {{ formatDateTime(detail.decision.at) }}</template>.
          <span v-if="detail.decision.comment" class="text-erp-muted">“{{ detail.decision.comment }}”</span>
        </div>
      </template>
    </section>
  </div>
</template>
