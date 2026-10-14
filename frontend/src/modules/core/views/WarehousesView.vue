<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { coreWarehousesApi } from '../api/core'
import type { WarehouseDetail, WarehouseRow, WarehousesData } from '../types'

/** C13 · Warehouses, with their locations read only (CoreWarehouses.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const data = ref<WarehousesData | null>(null)
onMounted(async () => {
  data.value = await coreWarehousesApi.list()
})

/** The warehouse whose locations show (?w=HQ-MAIN); at first the one with the most locations. */
const selected = computed<WarehouseRow | null>(() => {
  const all = data.value?.warehouses ?? []
  return all.find((w) => w.code === route.query.w) ?? [...all].sort((a, b) => b.locations.length - a.locations.length)[0] ?? null
})
const select = (w: WarehouseRow) => router.replace({ query: { ...route.query, w: w.code } })

// ── Add / edit dialog ────────────────────────────────────────────────────────
const open = ref(false)
const editing = ref<WarehouseDetail | null>(null)
const form = reactive({ code: '', name: '', branchCode: '', isActive: true })
const errors = ref<Record<string, string>>({})
const saving = ref(false)

async function edit(w: WarehouseRow | null) {
  errors.value = {}
  if (w) select(w)
  editing.value = w ? await coreWarehousesApi.get(w.id) : null
  Object.assign(form, { code: w?.code ?? '', name: w?.name ?? '', branchCode: w?.branchCode ?? data.value?.branches[0]?.code ?? '', isActive: w?.isActive ?? true })
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
      ? await coreWarehousesApi.update(editing.value.id, { name, branchCode: form.branchCode, isActive: form.isActive, version: editing.value.version })
      : await coreWarehousesApi.create({ code: form.code.trim().toUpperCase(), name, branchCode: form.branchCode })
    const code = editing.value?.code ?? form.code.trim().toUpperCase()
    toast.add({ severity: 'success', summary: editing.value ? `Warehouse ${code} saved` : `Warehouse ${code} added`, life: 3000 })
    if (!editing.value) void router.replace({ query: { ...route.query, w: code } })
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
    header: `Delete warehouse ${d.code}?`,
    message: `No document uses ${d.code} and it has no locations, so it can go. The code is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      data.value = await coreWarehousesApi.remove(d.id, d.version)
      toast.add({ severity: 'success', summary: `Warehouse ${d.code} deleted`, life: 3000 })
      open.value = false
      void router.replace({ query: { ...route.query, w: undefined } })
    },
  })
}
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <div v-else class="grid items-start gap-4 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
    <section class="erp-card flex flex-col gap-3 px-6 py-[18px]">
      <PageHeader title="Warehouses" subtitle="Where goods are received, stored and delivered from.">
        <template v-if="data.canEdit" #actions>
          <button type="button" class="erp-btn erp-btn-add" @click="edit(null)"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add warehouse</button>
        </template>
      </PageHeader>
      <table class="erp-table">
        <thead><tr><th>Code</th><th>Name</th><th>Branch</th><th>Locations</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="w in data.warehouses" :key="w.id" class="cursor-pointer" :class="{ 'bg-mod-light': selected?.code === w.code }" @click="select(w)">
            <td>
              <button v-if="data.canEdit" type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-left font-semibold whitespace-nowrap text-erp-link" @click.stop="edit(w)">{{ w.code }}</button>
              <span v-else class="font-semibold whitespace-nowrap text-erp-link">{{ w.code }}</span>
            </td>
            <td>{{ w.name }}</td>
            <td>{{ w.branch }}</td>
            <td>{{ w.locations.length }}</td>
            <td><StatusChip :status="w.isActive ? 'ACTIVE' : 'INACTIVE'" :label="w.isActive ? 'Active' : 'Inactive'" :group="w.isActive ? 'done' : 'draft'" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="selected" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between gap-2">
        <h2 class="m-0 text-[15px] font-bold">Locations in {{ selected.code }}</h2>
        <span class="inline-flex items-center gap-1.5 text-xs text-erp-muted"><Lock :size="12" aria-hidden="true" />Read only</span>
      </div>
      <NoticeBanner kind="info">Locations belong to the WMS. Once it is connected, racks and bins are added and changed there, and Core shows them. Until then these are the opening locations.</NoticeBanner>
      <table v-if="selected.locations.length" class="erp-table">
        <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="l in selected.locations" :key="l.code">
            <td class="font-semibold whitespace-nowrap">{{ l.code }}</td>
            <td>{{ l.name }}</td>
            <td><StatusChip :status="l.isActive ? 'ACTIVE' : 'INACTIVE'" :label="l.isActive ? 'Active' : 'Inactive'" :group="l.isActive ? 'done' : 'draft'" /></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="m-0 text-[13px] text-erp-muted">No locations yet. The WMS adds them once it is connected.</p>
    </section>
  </div>

  <Dialog v-model:visible="open" modal append-to="self" :header="editing ? `Warehouse ${editing.code}` : 'Add warehouse'" :style="{ width: '460px' }">
    <div class="flex flex-col gap-3.5">
      <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
        <span class="flex justify-between gap-2">
          <label for="wh-code">Code</label>
          <span v-if="editing" class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
        </span>
        <div v-if="editing" id="wh-code" class="erp-input-ro">{{ form.code }}</div>
        <input v-else id="wh-code" v-model="form.code" class="erp-input uppercase placeholder:normal-case" maxlength="20" placeholder="KL-MAIN" />
        <span v-if="errors.code" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.code }}</span>
      </div>
      <FormField label="Name" for="wh-name" :error="errors.name">
        <input id="wh-name" v-model="form.name" class="erp-input" maxlength="100" placeholder="Kuala Lumpur · main" />
      </FormField>
      <FormField label="Branch" for="wh-branch" :error="errors.branchCode">
        <select id="wh-branch" v-model="form.branchCode" class="erp-input" :disabled="Boolean(editing?.refusals.branch)">
          <option v-for="b in data?.branches ?? []" :key="b.code" :value="b.code">{{ b.code }} · {{ b.name }}</option>
        </select>
      </FormField>
      <span v-if="editing?.refusals.branch" class="-mt-2 text-xs text-erp-muted">{{ editing.refusals.branch }}</span>
      <template v-if="editing">
        <span class="inline-flex items-center gap-2 text-[13px] font-medium">
          <SwitchToggle v-model="form.isActive" label="Active" :disabled="Boolean(editing.refusals.deactivate) && editing.isActive" />{{ form.isActive ? 'Active' : 'Inactive' }}
        </span>
        <p class="m-0 text-[13px] text-erp-muted">{{ usageLine }}</p>
        <NoticeBanner v-if="editing.refusals.deactivate && editing.isActive" kind="info">{{ editing.refusals.deactivate }}</NoticeBanner>
        <p v-if="editing.refusals.delete" class="m-0 text-xs text-erp-muted">{{ editing.refusals.delete }}</p>
      </template>
      <span v-else class="text-xs text-erp-muted">A new warehouse has no locations: the WMS adds them once it is connected.</span>
    </div>
    <template #footer>
      <button v-if="editing?.allowedActions.includes('delete')" type="button" class="erp-btn erp-btn-delete mr-auto" :disabled="saving" @click="remove">Delete</button>
      <button type="button" class="erp-btn erp-btn-secondary" @click="open = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">{{ editing ? 'Save' : 'Add warehouse' }}</button>
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
