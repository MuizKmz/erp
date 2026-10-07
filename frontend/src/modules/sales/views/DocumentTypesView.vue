<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useSession } from '@/composables/useSession'
import { salesSettingsApi } from '../api/sales'
import type { DocumentTypesData } from '../types'

/** S30 · Document types and numbering (DocTypes.html) */
const toast = useToast()
const { can } = useSession()

const data = ref<DocumentTypesData | null>(null)
const rows = ref<{ docType: string; resetEvery: 'NEVER' | 'MONTH'; perBranch: boolean }[]>([])
const saving = ref(false)
const canManage = computed(() => can('sales.settings.manage'))

function reset() {
  rows.value = (data.value?.sequences ?? []).map((s) => ({ docType: s.docType, resetEvery: s.resetEvery, perBranch: s.perBranch }))
}
onMounted(async () => {
  data.value = await salesSettingsApi.documentTypes()
  reset()
})
const dirty = computed(() => JSON.stringify(rows.value) !== JSON.stringify((data.value?.sequences ?? []).map((s) => ({ docType: s.docType, resetEvery: s.resetEvery, perBranch: s.perBranch }))))
const rowOf = (docType: string) => rows.value.find((r) => r.docType === docType)!

async function save() {
  saving.value = true
  try {
    const result = await salesSettingsApi.saveDocumentTypes(rows.value)
    data.value = result
    reset()
    toast.add({ severity: 'success', summary: result.saved?.length ? 'Numbering saved' : 'Nothing changed', detail: result.saved?.join(' · '), life: 4500 })
  } finally {
    saving.value = false
  }
}

// ── Add a sales order type ───────────────────────────────────────────────────
const addOpen = ref(false)
const newType = reactive({ name: '', meaning: '', isDefault: false })
const addErrors = ref<Record<string, string>>({})
function openAdd() {
  Object.assign(newType, { name: '', meaning: '', isDefault: false })
  addErrors.value = {}
  addOpen.value = true
}
async function addType() {
  const e: Record<string, string> = {}
  if (newType.name.trim().length < 2) e.name = 'Give the type a name.'
  if (newType.meaning.trim().length < 2) e.meaning = 'Say what the type means.'
  addErrors.value = e
  if (Object.keys(e).length) return
  try {
    data.value = await salesSettingsApi.addOrderType({ name: newType.name.trim(), meaning: newType.meaning.trim(), isDefault: newType.isDefault })
    addOpen.value = false
    toast.add({ severity: 'success', summary: `${newType.name.trim()} added`, life: 3000 })
  } catch (error) {
    if (error instanceof ApiError) addErrors.value = error.fieldErrors
  }
}
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader title="Document types and numbering" subtitle="How each Sales document is numbered. A number is given on first save and never reused, even if the draft is deleted.">
      <template v-if="canManage" #actions>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!dirty || saving" @click="reset">Discard changes</button>
        <button type="button" class="erp-btn erp-btn-add" :disabled="!dirty || saving" @click="save">Save</button>
      </template>
    </PageHeader>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Numbering</h2>
      <table class="erp-table">
        <thead><tr><th>Document</th><th>Format</th><th>Next number</th><th>Restart</th><th>Separate per branch</th><th>Print template</th></tr></thead>
        <tbody>
          <tr v-for="s in data.sequences" :key="s.docType">
            <td class="font-bold">{{ s.name }}</td>
            <td class="font-mono text-xs">{{ s.format }}</td>
            <td class="font-mono text-xs">{{ s.nextNumber ?? '—' }}</td>
            <td class="w-[170px]">
              <select v-model="rowOf(s.docType).resetEvery" class="erp-input" :disabled="!canManage" :aria-label="`${s.name}, restart`">
                <option value="NEVER">Never</option>
                <option value="MONTH">Every month</option>
              </select>
            </td>
            <td class="w-[170px]">
              <select v-model="rowOf(s.docType).perBranch" class="erp-input" :disabled="!canManage" :aria-label="`${s.name}, separate per branch`">
                <option :value="false">No</option>
                <option :value="true">Yes</option>
              </select>
            </td>
            <td>{{ s.printTemplate ?? 'Standard' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 text-[15px] font-bold">Sales order types</h2>
          <button v-if="canManage" type="button" class="erp-btn erp-btn-secondary" @click="openAdd"><Plus :size="14" aria-hidden="true" />Add type</button>
        </div>
        <table class="erp-table">
          <thead><tr><th>Type</th><th>Meaning</th><th>Default</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="t in data.orderTypes" :key="t.code">
              <td class="font-bold">{{ t.name }}</td>
              <td>{{ t.meaning }}</td>
              <td>{{ t.isDefault ? 'Yes' : 'No' }}</td>
              <td><StatusChip :status="t.isActive ? 'ACTIVE' : 'INACTIVE'" :label="t.isActive ? 'Active' : 'Inactive'" :group="t.isActive ? 'done' : 'draft'" /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <SideCard title="Format codes">
        <div class="flex flex-col gap-1 text-[13px]">
          <div class="flex justify-between"><code>{YYMM}</code><span class="text-erp-subtle">year and month, e.g. 2609</span></div>
          <div class="flex justify-between"><code>{YYYY}</code><span class="text-erp-subtle">full year, e.g. 2026</span></div>
          <div class="flex justify-between"><code>{BR}</code><span class="text-erp-subtle">branch code, e.g. PG</span></div>
          <div class="flex justify-between"><code>{####}</code><span class="text-erp-subtle">running number, 4 digits</span></div>
        </div>
        <p class="m-0 text-xs text-erp-muted">Changing a format affects new documents only. Existing numbers never change.</p>
        <template v-if="data.history.length">
          <span class="mt-2 text-xs font-semibold tracking-wide text-erp-muted uppercase">Recent changes</span>
          <div v-for="h in data.history.slice(0, 5)" :key="h.id" class="text-xs text-erp-subtle">{{ h.message }} · {{ h.userName }}</div>
        </template>
      </SideCard>
    </div>

    <Dialog v-model:visible="addOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '460px' }" header="Add sales order type">
      <div class="flex flex-col gap-3">
        <FormField label="Name" :error="addErrors.name" for="ot-name"><input id="ot-name" v-model="newType.name" class="erp-input" maxlength="60" /></FormField>
        <FormField label="Meaning" :error="addErrors.meaning" for="ot-meaning"><input id="ot-meaning" v-model="newType.meaning" class="erp-input" maxlength="200" /></FormField>
        <label class="flex items-center gap-2 text-[13px]"><input v-model="newType.isDefault" type="checkbox" />Make it the default type for new orders</label>
      </div>
      <template #footer>
        <button type="button" class="erp-btn erp-btn-secondary" @click="addOpen = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" @click="addType">Add type</button>
      </template>
    </Dialog>
  </template>
</template>
