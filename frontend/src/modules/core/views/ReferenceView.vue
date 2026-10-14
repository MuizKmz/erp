<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { coreReferenceApi } from '../api/core'
import type { ReferenceData, ReferenceEntry, ReferenceListKey } from '../types'

/** C12 · Reference lists: item groups, customer categories, areas, credit terms (CoreReference.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const LISTS: { key: ReferenceListKey; label: string; one: string }[] = [
  { key: 'item-groups', label: 'Item groups', one: 'item group' },
  { key: 'customer-categories', label: 'Customer categories', one: 'customer category' },
  { key: 'areas', label: 'Areas', one: 'area' },
  { key: 'credit-terms', label: 'Credit terms', one: 'credit term' },
]

const data = ref<ReferenceData | null>(null)
onMounted(async () => {
  data.value = await coreReferenceApi.list()
})

/** The tab lives in the URL (?list=areas) so back and refresh keep it. */
const active = computed<ReferenceListKey>(() => (LISTS.some((l) => l.key === route.query.list) ? (route.query.list as ReferenceListKey) : 'item-groups'))
const current = computed(() => LISTS.find((l) => l.key === active.value)!)
const rows = computed(() => data.value?.lists[active.value] ?? [])
const counts = computed(() => (data.value ? Object.fromEntries(LISTS.map((l) => [l.key, data.value!.lists[l.key].length])) : null))
const isTerms = computed(() => active.value === 'credit-terms')
const select = (key: string) => router.replace({ query: { ...route.query, list: key === 'item-groups' ? undefined : key } })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Add / edit dialog ────────────────────────────────────────────────────────
const open = ref(false)
const editing = ref<ReferenceEntry | null>(null)
const form = reactive({ name: '', days: '' as number | '', isActive: true })
const errors = ref<Record<string, string>>({})
const saving = ref(false)

function edit(entry: ReferenceEntry | null) {
  errors.value = {}
  editing.value = entry
  Object.assign(form, { name: entry?.name ?? '', days: entry?.days ?? '', isActive: entry?.isActive ?? true })
  open.value = true
}

async function save() {
  saving.value = true
  errors.value = {}
  const list = active.value
  const days = isTerms.value && form.days !== '' ? Number(form.days) : undefined
  try {
    data.value = editing.value
      ? await coreReferenceApi.update(list, editing.value.id, { name: form.name.trim(), days, isActive: form.isActive, version: editing.value.version })
      : await coreReferenceApi.create(list, { name: form.name.trim(), days })
    toast.add({ severity: 'success', summary: editing.value ? `${cap(current.value.one)} saved` : `${cap(current.value.one)} “${form.name.trim()}” added`, life: 3000 })
    open.value = false
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function remove() {
  const e = editing.value!
  const list = active.value
  confirm.require({
    header: `Delete “${e.name}”?`,
    message: 'Nothing uses it, so it can go.',
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      data.value = await coreReferenceApi.remove(list, e.id, e.version)
      toast.add({ severity: 'success', summary: `“${e.name}” deleted`, life: 3000 })
      open.value = false
    },
  })
}
</script>

<template>
  <div v-if="!data" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <section v-else class="erp-card flex flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="Reference lists" subtitle="The short lists that items and customers pick from. Today these are typed; once here, they are picked from a list.">
      <template v-if="data.canEdit" #actions>
        <button type="button" class="erp-btn erp-btn-add" @click="edit(null)"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add {{ current.one }}</button>
      </template>
    </PageHeader>
    <StatusTabs :tabs="LISTS" :counts="counts" :active="active" @select="select" />
    <NoticeBanner v-if="active === 'item-groups' && data.lookAlike" kind="warning">{{ data.lookAlike }}</NoticeBanner>

    <table class="erp-table">
      <thead>
        <tr>
          <th>Name</th>
          <th v-if="isTerms">Days</th>
          <th>Used by</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in rows" :key="e.id">
          <td>
            <button v-if="data.canEdit" type="button" class="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-erp-text hover:text-mod-accent" @click="edit(e)">{{ e.name }}</button>
            <span v-else class="font-semibold">{{ e.name }}</span>
          </td>
          <td v-if="isTerms">{{ e.days }}</td>
          <td>{{ e.usedBy }}</td>
          <td><StatusChip :status="e.isActive ? 'ACTIVE' : 'INACTIVE'" :label="e.isActive ? 'Active' : 'Inactive'" :group="e.isActive ? 'done' : 'draft'" /></td>
        </tr>
        <tr v-if="!rows.length"><td :colspan="isTerms ? 4 : 3" class="text-erp-muted">Nothing on this list yet.</td></tr>
      </tbody>
    </table>
    <span class="text-xs text-erp-muted">An entry in use cannot be deleted; make it inactive instead, and new records can no longer pick it.</span>
  </section>

  <Dialog v-model:visible="open" modal :header="editing ? `${cap(current.one)} “${editing.name}”` : `Add ${current.one}`" :style="{ width: '440px' }">
    <div class="flex flex-col gap-3.5">
      <FormField label="Name" for="ref-name" :error="errors.name">
        <input id="ref-name" v-model="form.name" class="erp-input" maxlength="50" :disabled="Boolean(editing?.refusals.rename)" :placeholder="isTerms ? '60 days' : ''" />
      </FormField>
      <span v-if="editing?.refusals.rename" class="-mt-2 text-xs text-erp-muted">{{ editing.refusals.rename }}</span>
      <template v-if="isTerms">
        <FormField label="Days to pay" for="ref-days" :error="errors.days">
          <input id="ref-days" v-model.number="form.days" class="erp-input" type="number" min="0" max="365" :disabled="Boolean(editing?.refusals.days)" placeholder="60" />
        </FormField>
        <span v-if="editing?.refusals.days" class="-mt-2 text-xs text-erp-muted">{{ editing.refusals.days }}</span>
      </template>
      <template v-if="editing">
        <span class="inline-flex items-center gap-2 text-[13px] font-medium"><SwitchToggle v-model="form.isActive" label="Active" />{{ form.isActive ? 'Active' : 'Inactive: new records can no longer pick it' }}</span>
        <p class="m-0 text-[13px] text-erp-muted">Used by: {{ editing.usedBy }}.</p>
      </template>
    </div>
    <template #footer>
      <button v-if="editing && !editing.refusals.delete" type="button" class="erp-btn erp-btn-delete mr-auto" :disabled="saving" @click="remove">Delete</button>
      <button type="button" class="erp-btn erp-btn-secondary" @click="open = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">{{ editing ? 'Save' : `Add ${current.one}` }}</button>
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
