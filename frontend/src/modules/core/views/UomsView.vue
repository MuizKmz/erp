<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { coreUomsApi } from '../api/core'
import type { UomDetail, UomRow, UomsData } from '../types'

/** C11 · Units of measure (CoreUoms.html) */
const toast = useToast()
const confirm = useConfirm()

const data = ref<UomsData | null>(null)
onMounted(async () => {
  data.value = await coreUomsApi.list()
})

const usedText = (u: UomRow) =>
  `${u.baseOf} item${u.baseOf === 1 ? '' : 's'}` + (u.conversions ? ` · in ${u.conversions} conversion${u.conversions === 1 ? '' : 's'}` : '')

// ── Add / edit dialog ────────────────────────────────────────────────────────
const open = ref(false)
const editing = ref<UomDetail | null>(null) // null = new unit
const form = reactive({ code: '', name: '', decimals: 0, isActive: true })
const errors = ref<Record<string, string>>({})
const saving = ref(false)

async function edit(u: UomRow | null) {
  errors.value = {}
  editing.value = u ? await coreUomsApi.get(u.id) : null
  Object.assign(form, { code: u?.code ?? '', name: u?.name ?? '', decimals: u?.decimals ?? 0, isActive: u?.isActive ?? true })
  open.value = true
}

const usageLine = computed(() => {
  const d = editing.value
  if (!d) return ''
  const docs = d.usage.documents
  const where = d.usage.modules.filter((m) => m.documents > 0).map((m) => (m.module === 'purchase' ? 'Purchase' : m.module === 'sales' ? 'Sales' : m.module))
  return docs ? `Used on ${docs} document${docs === 1 ? '' : 's'} in ${where.join(' and ')}.` : 'Not used on any document yet.'
})

async function save() {
  saving.value = true
  errors.value = {}
  try {
    const name = form.name.trim()
    data.value = editing.value
      ? await coreUomsApi.update(editing.value.id, { name, decimals: Number(form.decimals), isActive: form.isActive, version: editing.value.version })
      : await coreUomsApi.create({ code: form.code.trim().toUpperCase(), name, decimals: Number(form.decimals) })
    toast.add({ severity: 'success', summary: editing.value ? `Unit ${editing.value.code} saved` : `Unit ${form.code.trim().toUpperCase()} added`, life: 3000 })
    open.value = false
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function remove() {
  const d = editing.value!
  confirm.require({
    header: `Delete unit ${d.code}?`,
    message: `Nothing uses ${d.code}, so it can go. The code cannot be used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      data.value = await coreUomsApi.remove(d.id, d.version)
      toast.add({ severity: 'success', summary: `Unit ${d.code} deleted`, life: 3000 })
      open.value = false
    },
  })
}
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <section class="erp-card flex flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="Units of measure" subtitle="Decimals say how many places a quantity in this unit may have: 0 for pieces, 2 for metres.">
        <template v-if="data.canEdit" #actions>
          <button type="button" class="erp-btn erp-btn-add" @click="edit(null)"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add unit</button>
        </template>
      </PageHeader>
      <table class="erp-table">
        <thead><tr><th>Code</th><th>Name</th><th>Decimals</th><th>Used as base unit</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="u in data.units" :key="u.id">
            <td>
              <button v-if="data.canEdit" type="button" class="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-erp-text hover:text-mod-accent" @click="edit(u)">{{ u.code }}</button>
              <span v-else class="font-semibold">{{ u.code }}</span>
            </td>
            <td>{{ u.name }}</td>
            <td>{{ u.decimals }}</td>
            <td>{{ usedText(u) }}</td>
            <td><StatusChip :status="u.isActive ? 'ACTIVE' : 'INACTIVE'" :label="u.isActive ? 'Active' : 'Inactive'" :group="u.isActive ? 'done' : 'draft'" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Conversions</h2>
      <table class="erp-table">
        <thead><tr><th>Item</th><th>Name</th><th>Conversion</th></tr></thead>
        <tbody>
          <tr v-for="c in data.conversions" :key="`${c.itemCode}-${c.text}`">
            <td>
              <RouterLink v-if="c.itemId" :to="`/core/items/${c.itemId}`" class="erp-link font-semibold">{{ c.itemCode }}</RouterLink>
              <span v-else class="font-semibold">{{ c.itemCode }}</span>
            </td>
            <td>{{ c.itemName }}</td>
            <td>{{ c.text }}</td>
          </tr>
          <tr v-if="!data.conversions.length"><td colspan="3" class="text-erp-muted">No conversions yet.</td></tr>
        </tbody>
      </table>
      <span class="text-xs text-erp-muted">Conversions belong to an item: edit them on the item. Changing a factor never changes documents already made.</span>
    </section>

    <Dialog v-model:visible="open" modal append-to="self" :header="editing ? `Unit ${editing.code}` : 'Add unit'" :style="{ width: '440px' }">
      <div class="flex flex-col gap-3.5">
        <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
          <span class="flex justify-between gap-2">
            <label for="uom-code">Code</label>
            <span v-if="editing" class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
          </span>
          <div v-if="editing" id="uom-code" class="erp-input-ro">{{ form.code }}</div>
          <input v-else id="uom-code" v-model="form.code" class="erp-input uppercase" maxlength="10" placeholder="CTN" />
          <span v-if="errors.code" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.code }}</span>
        </div>
        <FormField label="Name" for="uom-name" :error="errors.name">
          <input id="uom-name" v-model="form.name" class="erp-input" maxlength="50" placeholder="Carton" />
        </FormField>
        <FormField label="Decimals" for="uom-decimals" :error="errors.decimals">
          <select id="uom-decimals" v-model.number="form.decimals" class="erp-input">
            <option v-for="n in 5" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
          </select>
        </FormField>
        <span v-if="editing" class="inline-flex items-center gap-2 text-[13px] font-medium">
          <SwitchToggle v-model="form.isActive" label="Active" :disabled="Boolean(editing.refusals.deactivate) && editing.isActive" />Active
        </span>
        <template v-if="editing">
          <p class="m-0 text-[13px] text-erp-muted">{{ usageLine }}</p>
          <NoticeBanner v-if="editing.refusals.deactivate" kind="info">{{ editing.refusals.deactivate }}</NoticeBanner>
          <p v-if="editing.refusals.delete" class="m-0 text-xs text-erp-muted">{{ editing.refusals.delete }}</p>
        </template>
      </div>
      <template #footer>
        <button v-if="editing?.allowedActions.includes('delete')" type="button" class="erp-btn erp-btn-delete mr-auto" :disabled="saving" @click="remove">Delete</button>
        <button type="button" class="erp-btn erp-btn-secondary" @click="open = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">{{ editing ? 'Save' : 'Add unit' }}</button>
      </template>
    </Dialog>
  </template>
</template>
