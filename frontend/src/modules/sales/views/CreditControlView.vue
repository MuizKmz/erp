<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { salesSettingsApi } from '../api/sales'
import type { CreditActionCode, CreditControlData, CreditRuleRow, PolicyToggleKey } from '../types'

/** S29 · Credit control (Policies.html) */
const toast = useToast()
const { can } = useSession()

const data = ref<CreditControlData | null>(null)
const draft = ref<{ creditScope: 'GROUP' | 'BRANCH'; rules: CreditRuleRow[]; toggles: Record<PolicyToggleKey, boolean> } | null>(null)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const canManage = computed(() => can('sales.settings.manage'))

function reset() {
  const d = data.value!
  draft.value = { creditScope: d.creditScope, rules: d.rules.map((r) => ({ ...r })), toggles: { ...d.toggles } }
  errors.value = {}
}
onMounted(async () => {
  data.value = await salesSettingsApi.creditControl()
  reset()
})
const dirty = computed(() => Boolean(data.value && draft.value && JSON.stringify({ s: data.value.creditScope, r: data.value.rules, t: data.value.toggles }) !== JSON.stringify({ s: draft.value.creditScope, r: draft.value.rules, t: draft.value.toggles })))

const DOC_LABEL: Record<CreditRuleRow['docType'], string> = { QUOTATION: 'Quotation', SALES_ORDER: 'Sales order', DELIVERY: 'Delivery order', INVOICE: 'Invoice', CASH_SALE: 'Cash sales' }
const ACTIONS: { value: CreditActionCode; label: string }[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'WARN', label: 'Allow, show warning' },
  { value: 'APPROVAL', label: 'Require approval' },
  { value: 'BLOCK', label: 'Block' },
]
const actionLabel = (doc: CreditRuleRow['docType'], value: CreditActionCode, label: string) => (doc === 'CASH_SALE' && value === 'ALLOW' ? 'Allow (paid on the spot)' : label)
const needsApprover = (r: CreditRuleRow) => r.overCreditAction === 'APPROVAL' || r.overOverdueAction === 'APPROVAL'
const TOGGLE_HINT: Record<PolicyToggleKey, string> = {
  stockCheck: 'Warn when stock is short. Never block.',
  invoiceFromDelivered: 'Invoices copy delivered, not ordered, qty.',
  strictPriceList: 'A price below the list needs approval.',
  roundTo5Sen: 'Rounding kept as its own amount.',
  showMargin: 'Only to roles with the margin permission.',
  skipCreditForSystem: 'Imports and batch jobs. Every skip is logged.',
}
const TOGGLE_ORDER: PolicyToggleKey[] = ['stockCheck', 'invoiceFromDelivered', 'strictPriceList', 'roundTo5Sen', 'showMargin', 'skipCreditForSystem']

async function save() {
  const d = draft.value!
  const e: Record<string, string> = {}
  d.rules.forEach((r, i) => {
    if (needsApprover(r) && !r.approverRole) e[`rules[${i}].approverRole`] = `${DOC_LABEL[r.docType]}: pick who approves.`
  })
  errors.value = e
  if (Object.keys(e).length) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return
  }
  saving.value = true
  try {
    const result = await salesSettingsApi.saveCreditControl({ creditScope: d.creditScope, rules: d.rules.map((r) => ({ ...r, approverRole: needsApprover(r) ? r.approverRole : null })), ...d.toggles })
    data.value = result
    reset()
    toast.add({ severity: 'success', summary: result.saved?.length ? 'Policy saved' : 'Nothing changed', detail: result.saved?.join(' · '), life: 4500 })
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="!data || !draft" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader title="Credit control">
      <template #subtitle>
        What Sales does when a customer is over their credit or overdue limit.<template v-if="data.lastChange"> Last changed {{ formatDate(data.lastChange.at.slice(0, 10)) }} by {{ data.lastChange.userName.toLowerCase() === 'admin' ? 'admin' : data.lastChange.userName }}.</template>
      </template>
      <template v-if="canManage" #actions>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!dirty || saving" @click="reset">Discard changes</button>
        <button type="button" class="erp-btn erp-btn-add" :disabled="!dirty || saving" @click="save">Save policy</button>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_350px]">
      <div class="flex min-w-0 flex-col gap-4">
        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <h2 class="m-0 text-[15px] font-bold">Where the limit is checked</h2>
          <div class="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Where the limit is checked">
            <label
              v-for="o in [{ v: 'GROUP', t: 'Group-wide', d: 'One limit across all branches for a customer' }, { v: 'BRANCH', t: 'Per branch', d: 'Each branch has its own limit for the customer' }] as const"
              :key="o.v"
              class="flex cursor-pointer items-start gap-3 rounded-[10px] border px-4 py-3"
              :class="draft.creditScope === o.v ? 'border-2 border-mod-primary bg-mod-light' : 'border-erp-border'"
            >
              <input v-model="draft.creditScope" type="radio" :value="o.v" class="mt-1" :disabled="!canManage" />
              <span><span class="block text-[13px] font-bold">{{ o.t }}</span><span class="text-xs text-erp-subtle">{{ o.d }}</span></span>
            </label>
          </div>
          <p class="m-0 text-xs text-erp-muted">A customer's own setting in Master Data overrides this.</p>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <h2 class="m-0 text-[15px] font-bold">What happens on a breach, per document</h2>
          <table class="erp-table">
            <thead><tr><th>Document</th><th>Over credit limit</th><th>Over overdue limit</th><th>Approver</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in draft.rules" :key="r.docType">
                <td class="font-bold">{{ DOC_LABEL[r.docType] }}</td>
                <td>
                  <select v-model="r.overCreditAction" class="erp-input" :disabled="!canManage" :aria-label="`${DOC_LABEL[r.docType]}, over credit limit`">
                    <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ actionLabel(r.docType, a.value, a.label) }}</option>
                  </select>
                </td>
                <td>
                  <select v-model="r.overOverdueAction" class="erp-input" :disabled="!canManage" :aria-label="`${DOC_LABEL[r.docType]}, over overdue limit`">
                    <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ actionLabel(r.docType, a.value, a.label) }}</option>
                  </select>
                </td>
                <td>
                  <select
                    v-if="needsApprover(r)"
                    v-model="r.approverRole"
                    class="erp-input"
                    :disabled="!canManage"
                    :aria-invalid="Boolean(errors[`rules[${i}].approverRole`])"
                    :aria-label="`${DOC_LABEL[r.docType]}, approver`"
                  >
                    <option :value="null" disabled>Pick an approver</option>
                    <option value="SALES_MANAGER">Sales Manager</option>
                    <option value="FINANCE_MANAGER">Finance Manager</option>
                  </select>
                  <span v-else class="text-erp-muted">Not needed</span>
                  <div v-if="errors[`rules[${i}].approverRole`]" class="mt-1 text-xs text-note-error-text">{{ errors[`rules[${i}].approverRole`] }}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="m-0 text-xs text-erp-muted">Choices: Allow, show warning · Require approval · Block. Block stops the save with a message.</p>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <h2 class="m-0 text-[15px] font-bold">Change history</h2>
          <table class="erp-table">
            <thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead>
            <tbody>
              <tr v-if="!data.history.length"><td colspan="3" class="text-erp-muted">No changes yet.</td></tr>
              <tr v-for="h in data.history" :key="h.id">
                <td class="whitespace-nowrap">{{ formatDate(h.at.slice(0, 10)) }}</td>
                <td class="whitespace-nowrap">{{ h.userName.toLowerCase() === 'admin' ? 'admin' : h.userName }}</td>
                <td>{{ h.message }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <SideCard title="Other sales rules">
        <div class="flex flex-col">
          <div v-for="k in TOGGLE_ORDER" :key="k" class="flex items-center justify-between gap-4 border-b border-erp-row py-3 last:border-b-0">
            <span><span class="block text-[13px] font-bold">{{ data.toggleLabels[k] }}</span><span class="text-xs text-erp-subtle">{{ TOGGLE_HINT[k] }}</span></span>
            <SwitchToggle v-model="draft.toggles[k]" :label="data.toggleLabels[k]" :disabled="!canManage" />
          </div>
        </div>
        <p v-if="!canManage" class="m-0 text-xs text-erp-muted">Only an admin with Operation Policies rights can change these.</p>
      </SideCard>
    </div>
  </template>
</template>
