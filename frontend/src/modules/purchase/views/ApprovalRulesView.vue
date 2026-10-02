<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { ApiError } from '@/api/http'
import { formatDayMonth, formatMoney, formatRm } from '@/utils/format'
import { settingsApi } from '../api/purchase'
import type { ApprovalRulesInput, ApprovalRulesSettings } from '../types'

/** P24 · Approval Rules (PurPolicies.html) */
const toast = useToast()
const data = ref<ApprovalRulesSettings | null>(null)
const form = ref<ApprovalRulesInput | null>(null)
const errors = ref<Record<string, string>>({})
const busy = ref(false)

function fill(d: ApprovalRulesSettings) {
  data.value = d
  form.value = {
    rules: d.rules.map((r) => ({ id: r.id, thresholdAmount: r.thresholdAmount, secondOverAmount: r.secondOverAmount })),
    tolerance: { ...d.tolerance },
    switches: { rfqRequiredOn: d.switches.rfqRequiredOn, rfqRequiredOver: d.switches.rfqRequiredOver, autoDraftBuyToOrder: d.switches.autoDraftBuyToOrder },
  }
  errors.value = {}
}
onMounted(async () => fill(await settingsApi.approvalRules()))

const dirty = computed(() => {
  if (!data.value || !form.value) return false
  const d = data.value
  return JSON.stringify(form.value) !== JSON.stringify({
    rules: d.rules.map((r) => ({ id: r.id, thresholdAmount: r.thresholdAmount, secondOverAmount: r.secondOverAmount })),
    tolerance: d.tolerance,
    switches: { rfqRequiredOn: d.switches.rfqRequiredOn, rfqRequiredOver: d.switches.rfqRequiredOver, autoDraftBuyToOrder: d.switches.autoDraftBuyToOrder },
  })
})
const readOnly = computed(() => !data.value?.canEdit)

async function save() {
  if (!form.value) return
  busy.value = true
  try {
    fill(await settingsApi.saveApprovalRules(form.value))
    toast.add({ severity: 'success', summary: 'Approval rules saved', detail: 'They apply to new documents from now on.', life: 3000 })
  } catch (e) {
    if (e instanceof ApiError) errors.value = Object.fromEntries((e.body.errors ?? []).map((x) => [x.field, x.message]))
  } finally {
    busy.value = false
  }
}
function discard() {
  if (data.value) fill(data.value)
}
function addRule() {
  toast.add({ severity: 'info', summary: 'Add rule', detail: 'New kinds of rules come later. Change the limits above for now.', life: 3000 })
}
const err = (field: string) => errors.value[field]
</script>

<template>
  <div v-if="!data || !form" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader title="Approval Rules" subtitle="Who must approve what in Purchase. Changes are logged and apply to new documents only.">
      <template #actions>
        <template v-if="!readOnly">
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || !dirty" @click="discard">Discard</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="busy || !dirty" @click="save">Save changes</button>
        </template>
        <span v-else class="text-xs text-erp-muted">Only the Purchasing Manager can change these.</span>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card flex flex-col gap-3 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Approval limits</h2>
            <button v-if="!readOnly" type="button" class="erp-btn erp-btn-secondary h-8" @click="addRule"><Plus :size="14" aria-hidden="true" />Add rule</button>
          </div>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead><tr><th>Branch</th><th>Document</th><th>Needs approval when</th><th>Approver</th><th>Second approver</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in data.rules" :key="r.id">
                  <td class="font-semibold">{{ r.branch }}</td>
                  <td>{{ r.document }}</td>
                  <td>
                    <div v-if="r.thresholdAmount !== null" class="flex items-center gap-2 whitespace-nowrap">
                      <span>{{ r.conditionLabel }}</span>
                      <strong v-if="readOnly" class="erp-num">{{ formatMoney(r.thresholdAmount) }}</strong>
                      <input v-else v-model="form.rules[i]!.thresholdAmount" class="erp-input h-8 w-[100px] text-right" inputmode="decimal" :aria-invalid="!!err(`rules[${i}].thresholdAmount`)" :aria-label="`${r.branch} ${r.document} limit`" />
                    </div>
                    <span v-else>{{ r.conditionLabel }}</span>
                    <div v-if="err(`rules[${i}].thresholdAmount`)" class="mt-1 text-xs text-note-error-text">{{ err(`rules[${i}].thresholdAmount`) }}</div>
                  </td>
                  <td :class="{ 'text-erp-muted': r.blocked }">
                    <div v-for="part in (r.approver ?? '').split(' · ')" :key="part" class="whitespace-nowrap first:font-semibold">{{ part }}</div>
                  </td>
                  <td>
                    <template v-if="r.secondApprover">
                      <div class="flex items-center gap-2 whitespace-nowrap">
                        <span>Over RM</span>
                        <strong v-if="readOnly" class="erp-num">{{ formatMoney(r.secondOverAmount) }}</strong>
                        <input v-else v-model="form.rules[i]!.secondOverAmount" class="erp-input h-8 w-[100px] text-right" inputmode="decimal" :aria-invalid="!!err(`rules[${i}].secondOverAmount`)" :aria-label="`${r.branch} second approver limit`" />
                      </div>
                      <div class="whitespace-nowrap text-erp-subtle">{{ r.secondApprover }}</div>
                    </template>
                    <span v-else class="text-erp-muted">{{ r.blocked ? '—' : 'None' }}</span>
                    <div v-if="err(`rules[${i}].secondOverAmount`)" class="mt-1 text-xs text-note-error-text">{{ err(`rules[${i}].secondOverAmount`) }}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-4">
          <div>
            <h2 class="m-0 text-[15px] font-bold">Three-way match tolerance</h2>
            <p class="m-0 mt-0.5 text-[13px] text-erp-muted">Inside these limits an invoice passes on its own.</p>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <label class="flex flex-col gap-1 text-[13px]">
              <span class="font-semibold">Unit price</span>
              <span class="text-xs text-erp-muted">Billed vs ordered price</span>
              <span class="flex items-center gap-2">± <input v-model="form.tolerance.pricePct" class="erp-input w-[90px] text-right" inputmode="decimal" :disabled="readOnly" :aria-invalid="!!err('tolerance.pricePct')" /> %</span>
              <span v-if="err('tolerance.pricePct')" class="text-xs text-note-error-text">{{ err('tolerance.pricePct') }}</span>
            </label>
            <label class="flex flex-col gap-1 text-[13px]">
              <span class="font-semibold">Quantity</span>
              <span class="text-xs text-erp-muted">Billed more than received</span>
              <span class="flex items-center gap-2"><input v-model="form.tolerance.qtyOver" class="erp-input w-[90px] text-right" inputmode="decimal" :disabled="readOnly" :aria-invalid="!!err('tolerance.qtyOver')" /> units</span>
              <span v-if="err('tolerance.qtyOver')" class="text-xs text-note-error-text">{{ err('tolerance.qtyOver') }}</span>
            </label>
            <label class="flex flex-col gap-1 text-[13px]">
              <span class="font-semibold">Tax rounding</span>
              <span class="text-xs text-erp-muted">Tax amount difference</span>
              <span class="flex items-center gap-2">± RM <input v-model="form.tolerance.taxAmount" class="erp-input w-[90px] text-right" inputmode="decimal" :disabled="readOnly" :aria-invalid="!!err('tolerance.taxAmount')" /></span>
              <span v-if="err('tolerance.taxAmount')" class="text-xs text-note-error-text">{{ err('tolerance.taxAmount') }}</span>
            </label>
          </div>
        </section>

        <section class="erp-card flex flex-col px-5 py-4">
          <h2 class="m-0 mb-1 text-[15px] font-bold">Rules</h2>
          <div class="flex items-center justify-between gap-4 border-b border-erp-row py-3">
            <div class="text-[13px]">
              <div class="flex items-center gap-2 font-semibold">
                RFQ needed over RM
                <input v-model="form.switches.rfqRequiredOver" class="erp-input h-8 w-[120px] text-right" inputmode="decimal" :disabled="readOnly" :aria-invalid="!!err('switches.rfqRequiredOver')" aria-label="RFQ needed over" />
              </div>
              <div class="text-xs text-erp-muted">At least {{ data.switches.rfqMinReplies }} supplier replies, unless the item has a contract price</div>
              <div v-if="err('switches.rfqRequiredOver')" class="text-xs text-note-error-text">{{ err('switches.rfqRequiredOver') }}</div>
            </div>
            <SwitchToggle v-model="form.switches.rfqRequiredOn" label="RFQ needed for large orders" :disabled="readOnly" />
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-erp-row py-3">
            <div class="text-[13px]">
              <div class="font-semibold">Allow receiving more than ordered</div>
              <div class="text-xs text-erp-muted">When off, a goods receipt can never exceed the open PO quantity</div>
            </div>
            <SwitchToggle :model-value="data.switches.allowOverReceipt" label="Allow receiving more than ordered" disabled title="Fixed in phase 1" />
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-erp-row py-3">
            <div class="text-[13px]">
              <div class="font-semibold">Auto-draft a PO for buy-to-order sales lines</div>
              <div class="text-xs text-erp-muted">Released sales orders with buy-to-order items create a draft PO for the buyer</div>
            </div>
            <SwitchToggle v-model="form.switches.autoDraftBuyToOrder" label="Auto-draft a PO for buy-to-order sales lines" :disabled="readOnly" />
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-erp-row py-3">
            <div class="text-[13px]">
              <div class="font-semibold">Only active suppliers</div>
              <div class="text-xs text-erp-muted">Blocked or inactive suppliers in Master Data cannot be used</div>
            </div>
            <SwitchToggle :model-value="data.switches.onlyActiveSuppliers" label="Only active suppliers" disabled title="Fixed in phase 1" />
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div class="text-[13px]">
              <div class="font-semibold">Buyer cannot approve their own PO</div>
              <div class="text-xs text-erp-muted">Even if the buyer also holds the approver role</div>
            </div>
            <SwitchToggle :model-value="data.switches.buyerCannotApproveOwnPo" label="Buyer cannot approve their own PO" disabled title="Fixed in phase 1" />
          </div>
        </section>
      </div>

      <div class="flex flex-col gap-3.5">
        <SideCard title="Change history">
          <p v-if="!data.history.length" class="m-0 text-[13px] text-erp-muted">No changes yet.</p>
          <div v-for="h in data.history" :key="h.id" class="flex flex-col gap-0.5 border-b border-erp-row pb-2 text-[13px] last:border-b-0 last:pb-0">
            <span class="text-xs text-erp-muted">{{ formatDayMonth(h.at.slice(0, 10)) }} · {{ h.userName }}</span>
            <span>{{ h.message }}</span>
          </div>
        </SideCard>
        <SideCard title="Who is who">
          <div class="flex flex-col text-[13px]">
            <div v-for="p in data.people" :key="p.label" class="flex justify-between gap-3 border-b border-erp-row py-[7px] last:border-b-0">
              <span class="text-erp-subtle">{{ p.label }}</span><strong>{{ p.name }}</strong>
            </div>
          </div>
          <p class="m-0 text-xs text-erp-muted">From Master Data · Users.</p>
        </SideCard>
        <p v-if="data.rules.find((r) => r.blocked)" class="m-0 px-1 text-xs text-erp-muted">
          Cash purchases above {{ formatRm(data.rules.find((r) => r.blocked)!.thresholdAmount) }} are refused; raise a purchase order instead.
        </p>
      </div>
    </div>
  </template>
</template>
