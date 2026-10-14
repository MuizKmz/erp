<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { coreTaxCodesApi } from '../api/core'
import type { TaxCodeDetail, TaxCodeRow, TaxCodesData, TaxType } from '../types'

/** C10 · Tax codes with their type and rate history (CoreTaxCodes.html) */
const toast = useToast()
const confirm = useConfirm()
const session = useSession()

const TYPES: { value: TaxType; label: string }[] = [
  { value: 'SALES_TAX', label: 'Sales tax' },
  { value: 'SERVICE_TAX', label: 'Service tax' },
  { value: 'EXEMPT', label: 'Exempt' },
]

const data = ref<TaxCodesData | null>(null)
const load = async () => (data.value = await coreTaxCodesApi.list())
onMounted(load)

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
/** The day before, for "SST 10% runs to 31 Dec 2026". */
function dayBefore(iso: string): string {
  const d = isoToDate(iso)
  if (!d) return ''
  d.setDate(d.getDate() - 1)
  return dateToIso(d)
}

const saving = ref(false)
const errors = ref<Record<string, string>>({})

// ── The code: name, type, status and rate history ───────────────────────────
const codeOpen = ref(false)
const detail = ref<TaxCodeDetail | null>(null)
const codeForm = reactive({ name: '', type: 'SALES_TAX' as TaxType, isActive: true })
const canEdit = computed(() => Boolean(detail.value?.allowedActions.includes('edit')))

async function openCode(code: string) {
  errors.value = {}
  showDetail(await coreTaxCodesApi.get(code))
  codeOpen.value = true
}
function showDetail(d: TaxCodeDetail) {
  detail.value = d
  Object.assign(codeForm, { name: d.name, type: d.type, isActive: d.isActive })
}

async function saveCode() {
  const d = detail.value!
  saving.value = true
  errors.value = {}
  try {
    showDetail(await coreTaxCodesApi.update(d.code, { name: codeForm.name.trim(), type: codeForm.type, isActive: codeForm.isActive, version: d.version }))
    toast.add({ severity: 'success', summary: `Tax code ${d.code} saved`, life: 3000 })
    codeOpen.value = false
    await load()
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function removeRate(id: string) {
  const d = detail.value!
  const period = d.periods.find((p) => p.id === id)!
  confirm.require({
    header: `Remove ${period.rate} from ${formatDate(period.validFrom)}?`,
    message: 'It has not started, so nothing has used it. The rate before it runs on with no end.',
    acceptLabel: 'Remove',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      showDetail(await coreTaxCodesApi.removeRate(d.code, id, d.version))
      toast.add({ severity: 'success', summary: `Rate removed from ${d.code}`, life: 3000 })
      await load()
    },
  })
}

function deleteCode() {
  const d = detail.value!
  confirm.require({
    header: `Delete tax code ${d.code}?`,
    message: `No document and no item uses ${d.code}, so it can go, with its rates. The code is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await coreTaxCodesApi.remove(d.code, d.version)
      toast.add({ severity: 'success', summary: `Tax code ${d.code} deleted`, life: 3000 })
      codeOpen.value = false
      await load()
    },
  })
}

const usageLine = computed(() => {
  const d = detail.value
  if (!d) return ''
  const items = `${d.buying} buying · ${d.selling} selling`
  return d.documents ? `Used on ${d.documents} document${d.documents === 1 ? '' : 's'}; items: ${items}.` : `Not used on any document yet; items: ${items}.`
})

// ── New rate ────────────────────────────────────────────────────────────────
const rateOpen = ref(false)
const rateFor = ref<TaxCodeDetail | null>(null)
const rateForm = reactive({ rate: '', validFrom: '', name: '' })
const closes = computed(() => {
  const d = rateFor.value
  if (!d || !rateForm.validFrom) return ''
  const latest = d.periods.at(-1)!
  return `${latest.name} (${latest.rate}) runs to ${formatDate(dayBefore(rateForm.validFrom))}.`
})

async function openRate(code: string) {
  errors.value = {}
  const d = await coreTaxCodesApi.get(code)
  rateFor.value = d
  Object.assign(rateForm, { rate: '', validFrom: '', name: d.name })
  rateOpen.value = true
}

async function saveRate() {
  const d = rateFor.value!
  saving.value = true
  errors.value = {}
  try {
    await coreTaxCodesApi.addRate(d.code, { rate: rateForm.rate.trim(), validFrom: rateForm.validFrom, name: rateForm.name.trim(), version: d.version })
    toast.add({ severity: 'success', summary: `New rate for ${d.code} from ${formatDate(rateForm.validFrom)}`, life: 3000 })
    rateOpen.value = false
    await load()
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

// ── Add tax code ────────────────────────────────────────────────────────────
const addOpen = ref(false)
const addForm = reactive({ code: '', name: '', type: 'SALES_TAX' as TaxType, rate: '', validFrom: '' })

function openAdd() {
  errors.value = {}
  Object.assign(addForm, { code: '', name: '', type: 'SALES_TAX', rate: '', validFrom: session.today.value })
  addOpen.value = true
}

async function saveAdd() {
  saving.value = true
  errors.value = {}
  try {
    const created = await coreTaxCodesApi.create({ code: addForm.code.trim().toUpperCase(), name: addForm.name.trim(), type: addForm.type, rate: addForm.rate.trim(), validFrom: addForm.validFrom })
    toast.add({ severity: 'success', summary: `Tax code ${created.code} added`, life: 3000 })
    addOpen.value = false
    await load()
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

const itemsText = (c: TaxCodeRow) => `${c.buying} buying · ${c.selling} selling`
const STATE_CHIP = { waiting: { label: 'Waiting', group: 'pending' }, ended: { label: 'Ended', group: 'draft' }, current: null } as const
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <section v-else class="erp-card flex flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="Tax codes" subtitle="Malaysia for now. Documents copy the rate on the day they are made, so a new rate never changes old documents.">
      <template v-if="data.canEdit" #actions>
        <button type="button" class="erp-btn erp-btn-add" @click="openAdd"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add tax code</button>
      </template>
    </PageHeader>
    <NoticeBanner kind="info"><strong>New rate</strong> adds a row from its date and closes the old one the day before. A rate is never edited in place.</NoticeBanner>
    <table class="erp-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Name</th>
          <th>Type</th>
          <th>Rate</th>
          <th>Country</th>
          <th>Valid from</th>
          <th>Valid to</th>
          <th>Items using it</th>
          <th>Status</th>
          <th v-if="data.canEdit"><span class="sr-only">New rate</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in data.codes" :key="c.code">
          <td>
            <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-erp-text hover:text-mod-accent" @click="openCode(c.code)">{{ c.code }}</button>
          </td>
          <td>{{ c.name }}</td>
          <td>{{ c.typeLabel }}</td>
          <td>
            {{ c.rate }}
            <span v-if="c.next" class="block text-xs text-erp-muted">then {{ c.next.rate }} from {{ formatDate(c.next.validFrom) }}</span>
          </td>
          <td>{{ c.country }}</td>
          <td class="whitespace-nowrap">{{ formatDate(c.validFrom) }}</td>
          <td class="whitespace-nowrap">{{ c.validTo ? formatDate(c.validTo) : '—' }}</td>
          <td class="whitespace-nowrap">{{ itemsText(c) }}</td>
          <td><StatusChip :status="c.isActive ? 'ACTIVE' : 'INACTIVE'" :label="c.isActive ? 'Active' : 'Inactive'" :group="c.isActive ? 'done' : 'draft'" /></td>
          <td v-if="data.canEdit" class="text-right">
            <button type="button" class="erp-btn erp-btn-secondary" @click="openRate(c.code)">New rate</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <!-- The code -->
  <Dialog v-model:visible="codeOpen" modal :header="detail ? `Tax code ${detail.code}` : ''" :style="{ width: '600px' }">
    <div v-if="detail" class="flex flex-col gap-3.5">
      <div class="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
        <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
          <span class="flex justify-between gap-2"><span>Code</span><span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span></span>
          <div class="erp-input-ro">{{ detail.code }} · {{ detail.country }}</div>
        </div>
        <FormField label="Name" for="tax-name" :error="errors.name">
          <input id="tax-name" v-model="codeForm.name" class="erp-input" maxlength="60" :disabled="!canEdit" />
        </FormField>
        <FormField label="Type" for="tax-type" :error="errors.type">
          <select id="tax-type" v-model="codeForm.type" class="erp-input" :disabled="!canEdit || detail.documents > 0">
            <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </FormField>
        <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
          <span>Status</span>
          <span class="inline-flex h-[38px] items-center gap-2 text-[13px] font-medium text-erp-text">
            <SwitchToggle v-model="codeForm.isActive" label="Active" :disabled="!canEdit || (Boolean(detail.refusals.deactivate) && detail.isActive)" />{{ codeForm.isActive ? 'Active' : 'Inactive' }}
          </span>
        </div>
      </div>
      <span class="text-xs text-erp-muted">The name is the latest rate's; earlier rates keep theirs.<template v-if="detail.documents"> The type stays: documents use this code.</template></span>
      <p class="m-0 text-[13px] text-erp-muted">{{ usageLine }}</p>
      <NoticeBanner v-if="canEdit && detail.refusals.deactivate && detail.isActive" kind="info">{{ detail.refusals.deactivate }}</NoticeBanner>

      <h3 class="m-0 text-[13px] font-bold">Rate history</h3>
      <table class="erp-table">
        <thead><tr><th>Rate</th><th>Name</th><th>From</th><th>To</th><th><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>
          <tr v-for="p in detail.periods" :key="p.id" :class="{ 'text-erp-muted': p.state === 'ended' }">
            <td>{{ p.rate }}</td>
            <td>{{ p.name }}</td>
            <td class="whitespace-nowrap">
              {{ formatDate(p.validFrom) }}
              <StatusChip v-if="STATE_CHIP[p.state]" :status="p.state" :label="STATE_CHIP[p.state]!.label" :group="STATE_CHIP[p.state]!.group" class="ml-1" />
            </td>
            <td class="whitespace-nowrap">{{ p.validTo ? formatDate(p.validTo) : '—' }}</td>
            <td class="text-right">
              <button v-if="p.removable" type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove ${p.rate} from ${formatDate(p.validFrom)}`" @click="removeRate(p.id)"><X :size="15" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="detail.refusals.delete && canEdit" class="m-0 text-xs text-erp-muted">{{ detail.refusals.delete }}</p>
    </div>
    <template #footer>
      <button v-if="detail?.allowedActions.includes('delete')" type="button" class="erp-btn erp-btn-delete mr-auto" :disabled="saving" @click="deleteCode">Delete</button>
      <button type="button" class="erp-btn erp-btn-secondary" @click="codeOpen = false">{{ canEdit ? 'Cancel' : 'Close' }}</button>
      <button v-if="canEdit" type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="saveCode">Save</button>
    </template>
  </Dialog>

  <!-- New rate -->
  <Dialog v-model:visible="rateOpen" modal :header="rateFor ? `New rate for ${rateFor.code}` : ''" :style="{ width: '460px' }">
    <div v-if="rateFor" class="flex flex-col gap-3.5">
      <p class="m-0 text-[13px] text-erp-muted">Now {{ rateFor.periods.at(-1)!.rate }} from {{ formatDate(rateFor.periods.at(-1)!.validFrom) }} ({{ rateFor.periods.at(-1)!.name }}).</p>
      <div class="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
        <FormField label="Rate (%)" for="rate-rate" :error="errors.rate">
          <input id="rate-rate" v-model="rateForm.rate" class="erp-input" inputmode="decimal" placeholder="8" />
        </FormField>
        <FormField label="From" for="rate-from" :error="errors.validFrom">
          <DatePicker
            input-id="rate-from"
            :model-value="isoToDate(rateForm.validFrom)"
            :min-date="isoToDate(session.today.value) ?? undefined"
            date-format="d M yy"
            fluid
            class="erp-date"
            :invalid="Boolean(errors.validFrom)"
            @update:model-value="rateForm.validFrom = dateToIso($event)"
          />
        </FormField>
      </div>
      <FormField label="Name" for="rate-name" :error="errors.name">
        <input id="rate-name" v-model="rateForm.name" class="erp-input" maxlength="60" placeholder="SST 8%" />
      </FormField>
      <span v-if="closes" class="text-xs text-erp-muted">{{ closes }} Documents keep the rate they used.</span>
    </div>
    <template #footer>
      <button type="button" class="erp-btn erp-btn-secondary" @click="rateOpen = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="saveRate">Add rate</button>
    </template>
  </Dialog>

  <!-- Add tax code -->
  <Dialog v-model:visible="addOpen" modal header="Add tax code" :style="{ width: '460px' }">
    <div class="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
      <FormField label="Code" for="add-code" :error="errors.code">
        <input id="add-code" v-model="addForm.code" class="erp-input uppercase placeholder:normal-case" maxlength="20" placeholder="SST5" />
      </FormField>
      <FormField label="Type" for="add-type" :error="errors.type">
        <select id="add-type" v-model="addForm.type" class="erp-input">
          <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </FormField>
      <FormField label="Name" for="add-name" :error="errors.name" class="col-span-2">
        <input id="add-name" v-model="addForm.name" class="erp-input" maxlength="60" placeholder="SST 5%" />
      </FormField>
      <FormField label="Rate (%)" for="add-rate" :error="errors.rate">
        <input id="add-rate" v-model="addForm.rate" class="erp-input" inputmode="decimal" placeholder="5" />
      </FormField>
      <FormField label="From" for="add-from" :error="errors.validFrom">
        <DatePicker input-id="add-from" :model-value="isoToDate(addForm.validFrom)" date-format="d M yy" fluid class="erp-date" @update:model-value="addForm.validFrom = dateToIso($event)" />
      </FormField>
    </div>
    <template #footer>
      <button type="button" class="erp-btn erp-btn-secondary" @click="addOpen = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="saveAdd">Add tax code</button>
    </template>
  </Dialog>
</template>

<style scoped>
.erp-input:disabled {
  color: var(--erp-subtle);
  background: var(--erp-head-bg);
  border-color: var(--erp-border);
  opacity: 1;
}
</style>
