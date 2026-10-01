<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { TriangleAlert } from '@lucide/vue'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { notifyApprovalsChanged } from '@/composables/useApprovalsCount'
import { roleLabel } from '@/composables/useSession'
import { formatMoney, formatRm } from '@/utils/format'
import { ordersApi } from '../api/purchase'
import type { ApprovalCheck, OrderDetail } from '../types'

/** P11 · Send PO for approval (PoApproval.html). The order stays locked until someone decides. */
const props = defineProps<{ orderId: string; version: number }>()
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ sent: [order: OrderDetail] }>()
const toast = useToast()

const check = ref<ApprovalCheck | null>(null)
const loading = ref(false)
const sending = ref(false)
const approverCode = ref('')
const note = ref('')

// immediate: the dialog can be opened before it mounts (PO list → "Send for approval" → ?approve=1)
watch(
  visible,
  async (open) => {
    if (!open) return
    check.value = null
    note.value = ''
    loading.value = true
    try {
      check.value = await ordersApi.approvalCheck(props.orderId)
      approverCode.value = check.value.approver?.defaultCode ?? check.value.candidates[0]?.code ?? ''
    } catch {
      visible.value = false
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const approverName = computed(
  () =>
    check.value?.candidates.find((c) => c.code === approverCode.value)?.name ??
    check.value?.approver?.defaultName ??
    'The approver',
)
const blocked = computed(() =>
  Boolean(check.value && (!check.value.rfq.satisfied || !check.value.required || !approverCode.value)),
)

async function send() {
  if (!check.value || blocked.value) return
  sending.value = true
  try {
    const order = await ordersApi.submit(props.orderId, {
      version: props.version,
      note: note.value.trim() || undefined,
      approverCode: approverCode.value || undefined,
    })
    toast.add({
      severity: 'success',
      summary: `${order.docNo} sent for approval`,
      detail: `${approverName.value} gets an email and an item in Approvals.`,
      life: 4000,
    })
    notifyApprovalsChanged()
    visible.value = false
    emit('sent', order)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '620px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">Send {{ check?.docNo ?? '' }} for approval</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">The order stays locked until someone decides.</p>
      </div>
    </template>

    <div v-if="loading || !check" class="py-10 text-center text-[13px] text-erp-muted">
      Checking the approval rules…
    </div>
    <div v-else class="flex flex-col gap-4">
      <div
        class="flex items-start gap-2.5 rounded-[10px] border border-note-warn-border bg-note-warn-bg px-3.5 py-3 text-[13px] leading-normal text-note-warn-strong"
      >
        <TriangleAlert :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span><strong>Why approval is needed:</strong> {{ check.reason }}</span>
      </div>

      <NoticeBanner v-if="!check.rfq.satisfied" kind="error">{{ check.rfq.message }}</NoticeBanner>
      <NoticeBanner v-if="!check.required" kind="info"
        >This order is under the limit. Release it directly.</NoticeBanner
      >

      <div class="grid grid-cols-2 gap-3">
        <FormField label="Approver" for="approver">
          <select id="approver" v-model="approverCode" class="erp-input">
            <option v-for="c in check.candidates" :key="c.code" :value="c.code">
              {{ c.name }} · {{ roleLabel(c.role) }}
            </option>
          </select>
        </FormField>
        <FormField label="Second approver">
          <div class="erp-input-ro">{{ check.second.text }}</div>
        </FormField>
      </div>

      <div class="rounded-[10px] border border-erp-border bg-erp-head px-4 py-1.5 text-[13px]">
        <div class="flex justify-between gap-3 border-b border-erp-row py-2">
          <span class="text-erp-muted">Supplier</span><span>{{ check.summary.supplierName }}</span>
        </div>
        <div class="flex justify-between gap-3 border-b border-erp-row py-2">
          <span class="text-erp-muted">What</span><span>{{ check.summary.what }}</span>
        </div>
        <div
          class="flex justify-between gap-3 py-2"
          :class="{ 'border-b border-erp-row': check.summary.salesOrder }"
        >
          <span class="text-erp-muted">Order total</span
          ><strong class="erp-num">{{ formatRm(check.summary.total) }}</strong>
        </div>
        <div v-if="check.summary.salesOrder" class="flex justify-between gap-3 py-2">
          <span class="text-erp-muted">Customer order</span>
          <span class="erp-num">
            {{ check.summary.salesOrder.no }} · RM {{ formatMoney(check.summary.salesOrder.total) }}
            <template v-if="check.summary.salesOrder.marginPct">
              · margin {{ check.summary.salesOrder.marginPct }}%</template
            >
          </span>
        </div>
      </div>

      <FormField label="Note to approver" for="approval-note">
        <textarea
          id="approval-note"
          v-model="note"
          class="erp-input"
          maxlength="1000"
          placeholder="Why this order, why now, anything the approver should know"
        />
      </FormField>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span class="text-xs text-erp-muted">{{
          check ? `${approverName} gets an email and an item in Approvals.` : ''
        }}</span>
        <div class="flex gap-2">
          <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="blocked || sending" @click="send">
            Send for approval
          </button>
        </div>
      </div>
    </template>
  </Dialog>
</template>
