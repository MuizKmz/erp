<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { ApiError } from '@/api/http'
import { formatDayMonth } from '@/utils/format'
import { settingsApi } from '../api/purchase'
import type { DocumentTypesInput, DocumentTypesSettings } from '../types'

/** P25 · Document Types (PurDocTypes.html) */
const toast = useToast()
const data = ref<DocumentTypesSettings | null>(null)
const form = ref<DocumentTypesInput | null>(null)
const errors = ref<Record<string, string>>({})
const busy = ref(false)

const toInput = (d: DocumentTypesSettings): DocumentTypesInput => ({
  sequences: d.sequences.map((s) => ({ docType: s.docType, prefix: s.prefix, digits: s.digits, nextValue: s.nextValue })),
  poTypes: d.poTypes.map((t) => ({ code: t.code, name: t.name, description: t.description, isActive: t.isActive })),
})
function fill(d: DocumentTypesSettings) {
  data.value = d
  form.value = toInput(d)
  errors.value = {}
}
onMounted(async () => fill(await settingsApi.documentTypes()))

const dirty = computed(() => Boolean(data.value && form.value && JSON.stringify(form.value) !== JSON.stringify(toInput(data.value))))
const readOnly = computed(() => !data.value?.canEdit)

/** Preview only; the server formats the real number. */
function preview(s: { prefix: string; digits: number; nextValue: number }) {
  const digits = Number(s.digits) || 0
  return `${s.prefix}${String(s.nextValue).padStart(digits, '0')}`
}

async function save() {
  if (!form.value) return
  busy.value = true
  try {
    fill(await settingsApi.saveDocumentTypes(form.value))
    toast.add({ severity: 'success', summary: 'Document types saved', life: 2500 })
  } catch (e) {
    if (e instanceof ApiError) errors.value = Object.fromEntries((e.body.errors ?? []).map((x) => [x.field, x.message]))
  } finally {
    busy.value = false
  }
}
function addType() {
  toast.add({ severity: 'info', summary: 'Add type', detail: 'New purchase order types come later.', life: 3000 })
}
const seqError = (i: number) => errors.value[`sequences[${i}].prefix`] ?? errors.value[`sequences[${i}].nextValue`] ?? errors.value[`sequences[${i}].digits`]
const FLAGS = (t: DocumentTypesSettings['poTypes'][number]) =>
  [t.needsGoodsReceipt ? 'Goods receipt' : 'No goods receipt', t.linkedToSalesOrder ? 'Linked to SO' : '', t.sendsToAssetRegister ? 'Finance' : ''].filter(Boolean)
</script>

<template>
  <div v-if="!data || !form" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader title="Document Types" subtitle="Numbering for every Purchase document, and the kinds of purchase order you can raise.">
      <template #actions>
        <template v-if="!readOnly">
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || !dirty" @click="fill(data!)">Discard</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="busy || !dirty" @click="save">Save changes</button>
        </template>
        <span v-else class="text-xs text-erp-muted">Only the Purchasing Manager can change these.</span>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-3.5">
        <section class="erp-card flex flex-col gap-3 px-5 py-4">
          <h2 class="m-0 text-[15px] font-bold">Numbering</h2>
          <div class="overflow-x-auto">
            <table class="erp-table">
              <thead><tr><th>Document</th><th>Prefix</th><th>Next no</th><th>Digits</th><th>Resets</th><th>Next number</th></tr></thead>
              <tbody>
                <template v-for="(s, i) in data.sequences" :key="s.docType">
                  <tr>
                    <td class="font-semibold whitespace-nowrap">{{ s.name }}</td>
                    <td><input v-model="form.sequences[i]!.prefix" class="erp-input h-8 w-[90px]" :disabled="readOnly" :aria-invalid="!!errors[`sequences[${i}].prefix`]" :aria-label="`${s.name} prefix`" /></td>
                    <td><input v-model.number="form.sequences[i]!.nextValue" type="number" :min="s.nextValue" class="erp-input h-8 w-[90px] text-right" :disabled="readOnly" :aria-invalid="!!errors[`sequences[${i}].nextValue`]" :aria-label="`${s.name} next number`" /></td>
                    <td><input v-model.number="form.sequences[i]!.digits" type="number" min="3" max="8" class="erp-input h-8 w-[70px] text-right" :disabled="readOnly" :aria-invalid="!!errors[`sequences[${i}].digits`]" :aria-label="`${s.name} digits`" /></td>
                    <td class="text-erp-muted">Never</td>
                    <td class="erp-num font-semibold">{{ preview(form.sequences[i]!) }}</td>
                  </tr>
                  <tr v-if="seqError(i)"><td colspan="6" class="text-xs text-note-error-text">{{ seqError(i) }}</td></tr>
                </template>
              </tbody>
            </table>
          </div>
          <p class="m-0 text-xs text-erp-muted">Documents brought over from the old system keep their numbers with <strong>-L-</strong> added, for example <strong>PO-L-0861</strong>. New numbers never clash with them.</p>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Purchase order types</h2>
            <button v-if="!readOnly" type="button" class="erp-btn erp-btn-secondary h-8" @click="addType"><Plus :size="14" aria-hidden="true" />Add type</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div v-for="(t, i) in data.poTypes" :key="t.code" class="flex flex-col gap-2 rounded-[10px] border border-erp-border px-4 py-3" :class="{ 'opacity-60': !form.poTypes[i]!.isActive }">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <input v-if="!readOnly" v-model="form.poTypes[i]!.name" class="erp-input h-8 min-w-0 font-semibold" :aria-label="`${t.code} name`" />
                  <strong v-else>{{ t.name }}</strong>
                  <span class="text-xs text-erp-muted whitespace-nowrap">· {{ t.code }}</span>
                </div>
                <SwitchToggle v-model="form.poTypes[i]!.isActive" :label="`${t.name} in use`" :disabled="readOnly || t.code === 'STD'" />
              </div>
              <textarea v-if="!readOnly" v-model="form.poTypes[i]!.description" rows="2" class="erp-input h-auto py-2 text-[13px]" :aria-label="`${t.code} description`" />
              <p v-else class="m-0 text-[13px] text-erp-subtle">{{ t.description }}</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="f in FLAGS(t)" :key="f" class="rounded-full bg-mod-chip-bg px-2 py-0.5 text-[11px] font-semibold text-mod-chip-text">{{ f }}</span>
              </div>
            </div>
          </div>
          <p v-if="errors.poTypes" class="m-0 text-xs text-note-error-text">{{ errors.poTypes }}</p>
        </section>
      </div>

      <div class="flex flex-col gap-3.5">
        <SideCard title="Number rules">
          <div class="flex items-center justify-between gap-3 border-b border-erp-row pb-2.5 text-[13px]">
            <div>
              <div class="font-semibold">Add branch code</div>
              <div class="text-xs text-erp-muted">For example PO-PNG-0007 for Penang</div>
            </div>
            <SwitchToggle :model-value="data.numberWithBranchCode" label="Add branch code" disabled title="Comes with branch numbering later" />
          </div>
          <div class="flex items-center justify-between gap-3 text-[13px]">
            <div>
              <div class="font-semibold">Number on save, never re-used</div>
              <div class="text-xs text-erp-muted">A deleted draft leaves a gap; the audit trail explains it</div>
            </div>
            <SwitchToggle :model-value="true" label="Number on save, never re-used" disabled />
          </div>
        </SideCard>
        <SideCard v-if="data.history.length" title="Change history">
          <div v-for="h in data.history" :key="h.id" class="flex flex-col gap-0.5 border-b border-erp-row pb-2 text-[13px] last:border-b-0 last:pb-0">
            <span class="text-xs text-erp-muted">{{ formatDayMonth(h.at.slice(0, 10)) }} · {{ h.userName }}</span>
            <span>{{ h.message }}</span>
          </div>
        </SideCard>
      </div>
    </div>
  </template>
</template>
