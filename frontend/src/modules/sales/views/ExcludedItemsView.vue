<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { salesLookupsApi, salesSettingsApi } from '../api/sales'
import type { ExclusionRow, ExclusionsData } from '../types'

/** S32 · Items excluded from sale (ExcludedItems.html) */
const toast = useToast()
const confirm = useConfirm()
const { can, today, user } = useSession()
const canManage = computed(() => can('sales.settings.manage'))

const data = ref<ExclusionsData | null>(null)
const filter = reactive({ q: '', branch: '', state: 'active' })
let timer: ReturnType<typeof setTimeout> | undefined
async function load() {
  data.value = await salesSettingsApi.exclusions({ q: filter.q || undefined, branch: filter.branch || undefined, state: filter.state })
}
onMounted(load)
watch(() => [filter.branch, filter.state], load)
watch(() => filter.q, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 300)
})

// ── Add an exclusion ─────────────────────────────────────────────────────────
interface ItemOption {
  code: string
  name: string
}
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const form = reactive({ item: null as ItemOption | null, branchCode: '', reason: '', fromDate: '', untilDate: '' })
const errors = ref<Record<string, string>>({})
const saving = ref(false)
onMounted(() => {
  form.branchCode = user.value?.branchCodes.includes('PNG') ? 'PNG' : (user.value?.branchCodes[0] ?? '')
  form.fromDate = today.value
})
const searchItems = async (q: string): Promise<ItemOption[]> => (await salesLookupsApi.items({ q, sellableOnly: 'true' })).items.map((i) => ({ code: i.code, name: i.name }))

async function add() {
  const e: Record<string, string> = {}
  if (!form.item) e.itemCode = 'Pick an item from Master Data.'
  if (!form.branchCode) e.branchCode = 'Pick a branch.'
  if (!form.reason) e.reason = 'Choose a reason.'
  if (form.untilDate && form.fromDate && form.untilDate < form.fromDate) e.untilDate = 'Until cannot be before From.'
  errors.value = e
  if (Object.keys(e).length) return
  saving.value = true
  try {
    await salesSettingsApi.addExclusion({ itemCode: form.item!.code, branchCode: form.branchCode, reason: form.reason, fromDate: form.fromDate || undefined, untilDate: form.untilDate || undefined })
    toast.add({ severity: 'success', summary: `${form.item!.code} excluded`, detail: 'It shows greyed out in the item picker for that branch.', life: 3500 })
    Object.assign(form, { item: null, reason: '', untilDate: '' })
    await load()
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function remove(r: ExclusionRow) {
  confirm.require({
    header: `Remove the exclusion of ${r.itemCode}?`,
    message: `${r.itemCode} can be sold again in ${r.branchName} from now on.`,
    acceptLabel: 'Remove',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesSettingsApi.removeExclusion(r.id)
      toast.add({ severity: 'success', summary: `${r.itemCode} can be sold again in ${r.branchName}`, life: 3000 })
      await load()
    },
  })
}

const REASON_GROUP: Record<string, 'cancelled' | 'draft' | 'pending'> = { 'Supplier recall': 'cancelled', 'Quality issue': 'cancelled', Seasonal: 'pending' }
const chipClass = (reason: string) => {
  const g = REASON_GROUP[reason] ?? 'draft'
  return g === 'cancelled' ? 'bg-chip-cancelled-bg text-chip-cancelled-text' : g === 'pending' ? 'bg-chip-pending-bg text-chip-pending-text' : 'bg-chip-draft-bg text-chip-draft-text'
}

function exportCsv() {
  const rows = data.value?.items ?? []
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Item', 'Name', 'Branch', 'Reason', 'From', 'Until', 'Added by'].map(cell).join(','),
    ...rows.map((r) => [r.itemCode, r.itemName, r.branchName, r.reason, r.fromDate, r.untilDate ?? '', r.addedByName].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `excluded-items-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <PageHeader title="Items excluded from sale" subtitle="Stops an item from being sold in a branch, without changing the item in Master Data.">
    <template #actions><button type="button" class="erp-btn erp-btn-secondary" @click="exportCsv">Export</button></template>
  </PageHeader>

  <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
    <section class="erp-card flex min-h-[600px] flex-col gap-3 px-5 py-[18px]">
      <div class="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
        <input v-model="filter.q" class="erp-input" placeholder="Search item code or name" aria-label="Search item code or name" />
        <select v-model="filter.branch" class="erp-input" aria-label="Branch">
          <option value="">All branches</option>
          <option v-for="b in data?.branches ?? []" :key="b.code" :value="b.code">{{ b.name }}</option>
        </select>
        <select v-model="filter.state" class="erp-input" aria-label="Which exclusions">
          <option value="active">Active exclusions</option>
          <option value="ended">Ended exclusions</option>
          <option value="all">All exclusions</option>
        </select>
      </div>
      <div class="overflow-x-auto">
      <table class="erp-table [&_td]:px-2.5 [&_th]:px-2.5">
        <thead><tr><th>Item</th><th>Branch</th><th>Reason</th><th>From</th><th>Until</th><th>Added by</th><th v-if="canManage" aria-label="Action" /></tr></thead>
        <tbody>
          <tr v-if="!data?.items.length"><td :colspan="canManage ? 7 : 6" class="text-center text-erp-muted">No exclusions match these filters.</td></tr>
          <tr v-for="r in data?.items ?? []" :key="r.id">
            <td><div class="font-bold whitespace-nowrap">{{ r.itemCode }}</div><div class="text-xs text-erp-muted">{{ r.itemName }}</div></td>
            <td>{{ r.branchName }}</td>
            <td><span class="rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap" :class="chipClass(r.reason)">{{ r.reason }}</span></td>
            <td class="whitespace-nowrap">{{ formatDate(r.fromDate) }}</td>
            <td class="whitespace-nowrap" :class="r.untilDate ? '' : 'text-erp-subtle'">{{ r.untilDate ? formatDate(r.untilDate) : 'Until removed' }}</td>
            <td>{{ r.addedByName.toLowerCase() === 'admin' ? 'admin' : r.addedByName }}</td>
            <td v-if="canManage" class="text-right">
              <button v-if="r.state !== 'ENDED'" type="button" class="erp-btn h-8 border-note-error-border bg-erp-card px-2.5 text-xs text-note-error-text" @click="remove(r)">Remove</button>
              <span v-else class="text-xs text-erp-muted">Ended</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <p class="m-0 mt-auto text-xs text-erp-muted">{{ data?.counts.active ?? 0 }} active exclusions · {{ data?.counts.endedThisYear ?? 0 }} ended this year</p>
    </section>

    <div class="flex flex-col gap-4">
      <SideCard v-if="canManage" title="Add an exclusion">
        <div class="flex flex-col gap-3">
          <FormField label="Item · from Master Data" :error="errors.itemCode" for="ex-item">
            <MasterDataPicker v-model="form.item" input-id="ex-item" :search="searchItems" placeholder="Search item code or name" :invalid="Boolean(errors.itemCode)" />
          </FormField>
          <FormField label="Branch" :error="errors.branchCode" for="ex-branch">
            <select id="ex-branch" v-model="form.branchCode" class="erp-input">
              <option v-for="b in data?.branches ?? []" :key="b.code" :value="b.code">{{ b.name }}</option>
            </select>
          </FormField>
          <FormField label="Reason" :error="errors.reason" for="ex-reason">
            <select id="ex-reason" v-model="form.reason" class="erp-input">
              <option value="" disabled>Choose a reason</option>
              <option v-for="r in data?.reasons ?? []" :key="r" :value="r">{{ r }}</option>
            </select>
          </FormField>
          <div class="grid grid-cols-2 gap-3">
            <FormField label="From" for="ex-from">
              <DatePicker input-id="ex-from" :model-value="isoToDate(form.fromDate)" date-format="d M yy" fluid class="erp-date" @update:model-value="form.fromDate = dateToIso($event)" />
            </FormField>
            <FormField label="Until (optional)" :error="errors.untilDate" for="ex-until">
              <DatePicker input-id="ex-until" :model-value="isoToDate(form.untilDate)" :min-date="isoToDate(form.fromDate) ?? undefined" date-format="d M yy" placeholder="No end date" show-button-bar fluid class="erp-date" @update:model-value="form.untilDate = dateToIso($event)" />
            </FormField>
          </div>
          <div class="flex justify-end"><button type="button" class="erp-btn erp-btn-add" :disabled="saving" @click="add">Add exclusion</button></div>
        </div>
      </SideCard>

      <SideCard title="What an exclusion does">
        <p class="m-0 text-[13px] text-erp-subtle">The item can't be added to quotations, orders, invoices or cash sales in that branch. It shows greyed out in the item picker with the reason.</p>
        <p class="m-0 text-[13px] text-erp-subtle">Documents that already have the item are not changed. To stop selling it everywhere, set “Can be sold” off in Master Data instead.</p>
        <RouterLink to="/sales/orders/new" class="erp-link text-[13px] font-semibold">See it in the item picker →</RouterLink>
      </SideCard>
    </div>
  </div>
</template>
