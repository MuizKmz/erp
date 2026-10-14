<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Check, Minus, Upload, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import { useSession } from '@/composables/useSession'
import { coreImportsApi } from '../api/core'
import type { ImportAnswer, ImportKind, ImportKindInfo, ImportRowStatus } from '../types'

/** C14 · Import from CSV (CoreImport.html): choose what, upload the file, check the rows, load. */
const toast = useToast()
const session = useSession()

const kinds = ref<ImportKindInfo[]>([])
const kind = ref<ImportKind>('customers')
const file = ref<File | null>(null)
const answer = ref<ImportAnswer | null>(null)
const loaded = ref(false)
const busy = ref<'check' | 'load' | null>(null)
const fileError = ref('')
const input = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  kinds.value = (await coreImportsApi.kinds()).kinds
})

const canImport = computed(() => session.can('core.import'))
const current = computed(() => kinds.value.find((k) => k.kind === kind.value))
const ready = computed(() => (answer.value && !loaded.value ? (answer.value.counts.ready ?? 0) : 0))
const problemRows = computed(() => answer.value?.problems.rows.length ?? 0)
/** Step reached: 1 choose what, 2 file uploaded, 3 rows checked, 4 loaded. */
const step = computed(() => (loaded.value ? 4 : answer.value ? 3 : file.value ? 2 : 1))
const STEPS = ['Choose what', 'Upload the file', 'Check the rows', 'Load']

function reset() {
  file.value = null
  answer.value = null
  loaded.value = false
  fileError.value = ''
  if (input.value) input.value.value = ''
}

async function check(f: File) {
  file.value = f
  answer.value = null
  loaded.value = false
  fileError.value = ''
  busy.value = 'check'
  try {
    answer.value = await coreImportsApi.check(kind.value, f)
  } catch (error) {
    if (error instanceof ApiError) fileError.value = error.fieldErrors.file ?? error.message
  } finally {
    busy.value = null
  }
}

function pick(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0]
  if (f) void check(f)
}

async function load() {
  if (!file.value) return
  busy.value = 'load'
  try {
    answer.value = await coreImportsApi.load(kind.value, file.value)
    loaded.value = true
    const saved = (answer.value.counts.added ?? 0) + (answer.value.counts.updated ?? 0)
    toast.add({ severity: saved ? 'success' : 'warn', summary: saved ? `${saved} row${saved === 1 ? '' : 's'} saved` : 'Nothing was saved', life: 3000 })
  } catch (error) {
    if (error instanceof ApiError) fileError.value = error.fieldErrors.file ?? error.message
  } finally {
    busy.value = null
  }
}

function download(name: string, rows: string[][]) {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
const downloadTemplate = () => current.value && download(`${kind.value}-template.csv`, [current.value.columns])
const downloadProblems = () => answer.value && download(`${answer.value.fileName.replace(/\.csv$/i, '')}-problems.csv`, [answer.value.problems.headers, ...answer.value.problems.rows])

/** "… each on its own. Load saves …": the word Load in bold, as in C14. */
const summaryParts = computed(() => {
  const s = answer.value?.summary ?? ''
  const at = s.indexOf('Load saves')
  return at < 0 ? { before: s, bold: '', after: '' } : { before: s.slice(0, at), bold: 'Load', after: s.slice(at + 4) }
})
/** Under the table: C14's words for customers and suppliers; items and prices say how their rows are matched. */
const footNote = computed(() =>
  kind.value === 'customers' || kind.value === 'suppliers' ? 'Codes decide: a known code updates that record, an empty code adds a new one with the next number.' : (current.value?.note ?? ''),
)
const bannerKind = computed(() => (problemRows.value ? 'warning' : 'info'))
const OK: ImportRowStatus[] = ['new', 'update', 'added', 'updated']
const resultClass = (s: ImportRowStatus) =>
  s === 'problem' ? 'text-note-error-text' : s === 'new' || s === 'added' ? 'font-semibold text-chip-done-text' : 'text-erp-muted'
</script>

<template>
  <section class="erp-card flex flex-col gap-3.5 px-6 py-[18px]">
    <PageHeader title="Import" subtitle="Load customers, suppliers, items or price-list prices from a CSV file: a first load from the old system, or many changes at once." />

    <ol class="m-0 flex list-none flex-wrap gap-6 p-0">
      <li v-for="(label, n) in STEPS" :key="label" class="inline-flex items-center gap-2.5 text-[13px] font-semibold" :class="n + 1 <= step ? 'text-erp-text' : 'text-erp-muted'">
        <span class="inline-flex size-[26px] items-center justify-center rounded-full text-xs font-bold" :class="n + 1 <= step ? 'bg-mod-primary text-white' : 'bg-chip-draft-bg text-chip-draft-text'">{{ n + 1 }}</span>
        {{ label }}
      </li>
    </ol>

    <NoticeBanner v-if="!canImport" kind="info">Only the Master Data Admin imports. You can still download a template to see the columns.</NoticeBanner>

    <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-[18px]">
      <label class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
        What to import
        <select v-model="kind" class="erp-input" :disabled="busy !== null" @change="reset">
          <option v-for="k in kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
        </select>
      </label>
      <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
        <span>File</span>
        <button type="button" class="erp-input inline-flex cursor-pointer items-center gap-2 text-left font-medium text-erp-text disabled:cursor-not-allowed" :disabled="!canImport || busy !== null" @click="input?.click()">
          <Upload :size="15" aria-hidden="true" class="shrink-0" />
          <span v-if="busy === 'check'">Checking {{ file?.name }}…</span>
          <span v-else-if="file && answer" class="truncate">{{ file.name }} · {{ answer.rows.length }} row{{ answer.rows.length === 1 ? '' : 's' }}</span>
          <span v-else-if="file" class="truncate">{{ file.name }}</span>
          <span v-else class="text-erp-subtle">Choose a CSV file</span>
        </button>
        <input ref="input" type="file" accept=".csv,text/csv" class="hidden" aria-label="CSV file" @change="pick" />
      </div>
      <button type="button" class="erp-btn erp-btn-secondary" :disabled="!current" @click="downloadTemplate">Download the template</button>
    </div>
    <span v-if="fileError" class="-mt-2 text-xs font-medium text-note-error-text" role="alert">{{ fileError }}</span>
    <span v-else-if="current && !answer" class="-mt-2 text-xs text-erp-muted">{{ current.note }}</span>

    <template v-if="answer">
      <NoticeBanner v-if="loaded" :kind="bannerKind">{{ answer.summary }}</NoticeBanner>
      <NoticeBanner v-else :kind="bannerKind">{{ summaryParts.before }}<strong v-if="summaryParts.bold">{{ summaryParts.bold }}</strong>{{ summaryParts.after }}</NoticeBanner>
      <span v-for="n in answer.notices" :key="n" class="-mt-1.5 text-xs text-erp-muted">{{ n }}</span>

      <table class="erp-table">
        <thead>
          <tr>
            <th class="w-[60px]">Row</th>
            <th class="w-[36px]"><span class="sr-only">Ready</span></th>
            <th v-for="c in answer.columns" :key="c.key" :class="{ num: c.numeric }">{{ c.label }}</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in answer.rows" :key="r.row">
            <td>{{ r.row }}</td>
            <td>
              <Check v-if="OK.includes(r.status)" :size="16" class="text-chip-done-text" aria-label="Ready" />
              <X v-else-if="r.status === 'problem'" :size="16" class="text-note-error-text" aria-label="Problem" />
              <Minus v-else :size="16" class="text-erp-muted" aria-label="No change" />
            </td>
            <td v-for="c in answer.columns" :key="c.key" :class="[{ num: c.numeric }, c.key === 'code' && r.display.code?.startsWith('New') ? 'text-erp-muted' : '']" class="whitespace-nowrap">{{ r.display[c.key] || '—' }}</td>
            <td :class="resultClass(r.status)">{{ r.result }}</td>
          </tr>
        </tbody>
      </table>

      <div class="flex items-center justify-between gap-4">
        <span class="text-xs text-erp-muted">Checking saves nothing. {{ footNote }}</span>
        <div class="flex shrink-0 gap-2">
          <button v-if="problemRows" type="button" class="erp-btn erp-btn-secondary" @click="downloadProblems">Download rows with problems</button>
          <button v-if="loaded" type="button" class="erp-btn erp-btn-secondary" @click="reset">Import another file</button>
          <button v-else-if="ready" type="button" class="erp-btn erp-btn-primary" :disabled="busy !== null" @click="load">
            {{ busy === 'load' ? 'Loading…' : `Load ${ready} row${ready === 1 ? '' : 's'}` }}
          </button>
        </div>
      </div>
    </template>
    <p v-else-if="!fileError" class="m-0 rounded-[10px] border border-dashed border-erp-border px-4 py-8 text-center text-[13px] text-erp-muted">
      Choose what to import and upload a CSV file. Each row is checked first and nothing is saved until you click Load.
    </p>
  </section>
</template>
