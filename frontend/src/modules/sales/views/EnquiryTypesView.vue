<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { useSession } from '@/composables/useSession'
import { salesSettingsApi } from '../api/sales'
import type { EnquiryTypeDetail, EnquiryTypesData, EnquiryTypeSetting } from '../types'

/** S31 · Enquiry types and sources (EnquiryTypes.html) */
const toast = useToast()
const { can } = useSession()
const canManage = computed(() => can('sales.settings.manage'))

const data = ref<EnquiryTypesData | null>(null)
onMounted(async () => {
  data.value = await salesSettingsApi.enquiryTypes()
})

// ── Edit panel ───────────────────────────────────────────────────────────────
const editing = ref<string | null | undefined>(undefined) // undefined = closed, null = new type
const form = reactive({ name: '', defaultAgentRule: 'CUSTOMER' as EnquiryTypeSetting['defaultAgentRule'], isActive: true, details: [] as EnquiryTypeDetail[] })
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const newDetail = reactive({ open: false, label: '', kind: 'TEXT' as EnquiryTypeDetail['kind'], required: false, choices: '' })
const KIND_LABEL: Record<EnquiryTypeDetail['kind'], string> = { TEXT: 'Text', CHOICE: 'Choice', FILE: 'File', NUMBER: 'Number', DATE: 'Date' }

function edit(t: EnquiryTypeSetting | null) {
  editing.value = t ? t.code : null
  Object.assign(form, {
    name: t?.name ?? '', defaultAgentRule: t?.defaultAgentRule ?? 'CUSTOMER', isActive: t?.isActive ?? true,
    details: (t?.details ?? []).map((d) => ({ ...d, choices: d.choices ? [...d.choices] : undefined })),
  })
  Object.assign(newDetail, { open: false, label: '', kind: 'TEXT', required: false, choices: '' })
  errors.value = {}
}
function addDetail() {
  if (!newDetail.label.trim()) {
    errors.value = { ...errors.value, detail: 'Give the detail a name.' }
    return
  }
  form.details.push({
    label: newDetail.label.trim(), kind: newDetail.kind, required: newDetail.required,
    ...(newDetail.kind === 'CHOICE' && { choices: newDetail.choices.split(',').map((c) => c.trim()).filter(Boolean) }),
  })
  Object.assign(newDetail, { open: false, label: '', kind: 'TEXT', required: false, choices: '' })
  delete errors.value.detail
}
async function save() {
  if (form.name.trim().length < 2) {
    errors.value = { name: 'Give the type a name.' }
    return
  }
  saving.value = true
  try {
    data.value = await salesSettingsApi.saveEnquiryType(editing.value ?? null, { name: form.name.trim(), defaultAgentRule: form.defaultAgentRule, isActive: form.isActive, details: form.details })
    toast.add({ severity: 'success', summary: editing.value ? `${form.name.trim()} saved` : `${form.name.trim()} added`, life: 3000 })
    editing.value = undefined
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────
const sourceOpen = ref(false)
const sourceName = ref('')
const sourceError = ref('')
async function addSource() {
  if (sourceName.value.trim().length < 2) {
    sourceError.value = 'Give the source a name.'
    return
  }
  try {
    data.value = await salesSettingsApi.addSource(sourceName.value.trim())
    toast.add({ severity: 'success', summary: `${sourceName.value.trim()} added`, life: 3000 })
    sourceOpen.value = false
  } catch (error) {
    if (error instanceof ApiError) sourceError.value = error.fieldErrors.name ?? error.message
  }
}
const editingName = computed(() => data.value?.types.find((t) => t.code === editing.value)?.name ?? '')
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader title="Enquiry types and sources" subtitle="The choices in the enquiry form. A type can ask for extra details, so agents collect the same information every time.">
      <template v-if="canManage" #actions>
        <button type="button" class="erp-btn erp-btn-add" @click="edit(null)"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add enquiry type</button>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_400px]">
      <div class="flex min-w-0 flex-col gap-4">
        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <h2 class="m-0 text-[15px] font-bold">Enquiry types</h2>
          <table class="erp-table">
            <thead><tr><th>Type</th><th>Extra details asked</th><th class="num">Used this month</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="t in data.types" :key="t.code" :class="{ 'bg-mod-light': editing === t.code }">
                <td>
                  <button v-if="canManage" type="button" class="cursor-pointer border-0 bg-transparent p-0 text-left font-bold" :class="editing === t.code ? 'text-mod-accent' : 'text-erp-text hover:text-mod-accent'" @click="edit(t)">{{ t.name }}</button>
                  <span v-else class="font-bold">{{ t.name }}</span>
                </td>
                <td>{{ t.details.map((d) => d.label.replace(/ \(.*\)$/, '')).join(', ') || '—' }}</td>
                <td class="num">{{ t.usedThisMonth }}</td>
                <td><StatusChip :status="t.isActive ? 'ACTIVE' : 'INACTIVE'" :label="t.isActive ? 'Active' : 'Inactive'" :group="t.isActive ? 'done' : 'draft'" /></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Where enquiries come from</h2>
            <button v-if="canManage" type="button" class="erp-btn erp-btn-secondary" @click="(sourceName = ''), (sourceError = ''), (sourceOpen = true)"><Plus :size="14" aria-hidden="true" />Add source</button>
          </div>
          <table class="erp-table">
            <thead><tr><th>Source</th><th class="num">This month</th><th class="num">Became quotations</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="s in data.sources" :key="s.code">
                <td class="font-bold">{{ s.name }}</td>
                <td class="num">{{ s.thisMonth }}</td>
                <td class="num">{{ s.becameQuotations }}</td>
                <td><StatusChip :status="s.isActive ? 'ACTIVE' : 'INACTIVE'" :label="s.isActive ? 'Active' : 'Inactive'" :group="s.isActive ? 'done' : 'draft'" /></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section v-if="editing !== undefined" class="erp-card flex min-h-[560px] flex-col gap-3 px-5 py-[18px]">
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 text-[17px] font-bold">{{ editing ? `Edit type · ${editingName}` : 'New enquiry type' }}</h2>
          <button type="button" class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-erp-border bg-erp-card" aria-label="Close" @click="editing = undefined"><X :size="14" /></button>
        </div>
        <FormField label="Name" :error="errors.name" for="et-name"><input id="et-name" v-model="form.name" class="erp-input" maxlength="60" /></FormField>
        <FormField label="Default sales agent" for="et-agent">
          <select id="et-agent" v-model="form.defaultAgentRule" class="erp-input">
            <option value="CUSTOMER">The customer's own agent</option>
            <option value="ROUND_ROBIN">Round-robin across agents</option>
          </select>
        </FormField>
        <span class="text-[13px] font-bold">Extra details the form asks for</span>
        <div v-for="(d, i) in form.details" :key="`${d.label}-${i}`" class="flex items-center gap-2 rounded-[10px] border border-erp-border px-3 py-2.5 text-[13px]">
          <span class="grow">{{ d.label }}<span v-if="d.choices?.length" class="block text-xs text-erp-muted">{{ d.choices.join(', ') }}</span></span>
          <span class="rounded-md bg-erp-head px-2 py-0.5 text-xs font-semibold text-erp-subtle">{{ KIND_LABEL[d.kind] }}</span>
          <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-xs text-erp-muted" :title="'Click to switch'" @click="d.required = !d.required">{{ d.required ? 'Required' : 'Optional' }}</button>
          <button type="button" class="flex h-6 w-6 cursor-pointer items-center justify-center border-0 bg-transparent text-erp-muted" :aria-label="`Remove ${d.label}`" @click="form.details.splice(i, 1)"><X :size="13" /></button>
        </div>
        <div v-if="newDetail.open" class="flex flex-col gap-2 rounded-[10px] border border-dashed border-erp-input p-3">
          <input v-model="newDetail.label" class="erp-input" placeholder="Detail name, e.g. Delivery city" aria-label="Detail name" />
          <div class="flex gap-2">
            <select v-model="newDetail.kind" class="erp-input" aria-label="Kind">
              <option v-for="(label, k) in KIND_LABEL" :key="k" :value="k">{{ label }}</option>
            </select>
            <label class="flex items-center gap-1.5 text-[13px] whitespace-nowrap"><input v-model="newDetail.required" type="checkbox" />Required</label>
          </div>
          <input v-if="newDetail.kind === 'CHOICE'" v-model="newDetail.choices" class="erp-input" placeholder="Choices, separated by commas" aria-label="Choices" />
          <span v-if="errors.detail" class="text-xs text-note-error-text">{{ errors.detail }}</span>
          <div class="flex justify-end gap-2">
            <button type="button" class="erp-btn erp-btn-secondary" @click="newDetail.open = false">Cancel</button>
            <button type="button" class="erp-btn erp-btn-primary" @click="addDetail">Add</button>
          </div>
        </div>
        <div v-else><button type="button" class="erp-btn erp-btn-secondary" @click="newDetail.open = true"><Plus :size="14" aria-hidden="true" />Add detail</button></div>
        <div class="flex items-center justify-between pt-2"><span class="text-[13px] font-bold">Active</span><SwitchToggle v-model="form.isActive" label="Active" /></div>
        <div class="mt-auto flex justify-end gap-2 pt-4">
          <button type="button" class="erp-btn erp-btn-secondary" @click="editing = undefined">Cancel</button>
          <button type="button" class="erp-btn erp-btn-add" :disabled="saving" @click="save">Save type</button>
        </div>
      </section>
      <section v-else class="erp-card flex flex-col gap-2 px-5 py-[18px] text-[13px] text-erp-subtle">
        <h2 class="m-0 text-[15px] font-bold text-erp-text">Edit a type</h2>
        <p class="m-0">{{ canManage ? 'Click a type to change its name, default agent and the extra details the form asks for.' : 'Only an admin with Operation Policies rights can change enquiry types.' }}</p>
      </section>
    </div>

    <Dialog v-model:visible="sourceOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '420px' }" header="Add source">
      <FormField label="Where enquiries come from" :error="sourceError" for="src-name"><input id="src-name" v-model="sourceName" class="erp-input" maxlength="60" placeholder="e.g. Trade fair" /></FormField>
      <template #footer>
        <button type="button" class="erp-btn erp-btn-secondary" @click="sourceOpen = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" @click="addSource">Add source</button>
      </template>
    </Dialog>
  </template>
</template>
