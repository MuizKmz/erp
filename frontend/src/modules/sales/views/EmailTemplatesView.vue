<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { FileText, Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { useSession } from '@/composables/useSession'
import { salesSettingsApi } from '../api/sales'
import type { EmailPreview, EmailTemplateRow } from '../types'

/** S33 · Email templates (EmailTemplates.html) */
const toast = useToast()
const { can } = useSession()
const canManage = computed(() => can('sales.settings.manage'))

const templates = ref<EmailTemplateRow[]>([])
const variables = ref<string[]>([])
const selectedKey = ref('')
const form = reactive({ subject: '', body: '', attachPdf: true, copyAgent: true })
const saved = ref('')
const preview = ref<EmailPreview | null>(null)
const saving = ref(false)
const bodyEl = ref<HTMLTextAreaElement | null>(null)
const subjectEl = ref<HTMLInputElement | null>(null)
const lastField = ref<'subject' | 'body'>('body')

const selected = computed(() => templates.value.find((t) => t.key === selectedKey.value) ?? null)
const dirty = computed(() => JSON.stringify(form) !== saved.value)

function select(key: string) {
  selectedKey.value = key
  const t = templates.value.find((x) => x.key === key)!
  Object.assign(form, { subject: t.subject, body: t.body, attachPdf: t.attachPdf, copyAgent: t.copyAgent })
  saved.value = JSON.stringify(form)
}
onMounted(async () => {
  const r = await salesSettingsApi.templates()
  templates.value = r.items
  variables.value = r.variables
  select(r.items.find((t) => t.key === 'INVOICE')?.key ?? r.items[0]!.key)
})

let timer: ReturnType<typeof setTimeout> | undefined
watch([() => form.subject, () => form.body, selectedKey], () => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (!selectedKey.value) return
    try {
      preview.value = await salesSettingsApi.previewTemplate(selectedKey.value, { subject: form.subject, body: form.body })
    } catch {
      /* the preview stays as it was */
    }
  }, 250)
})

const tokenOf = (v: string) => `{${v}}`

/** "Click to insert": puts {field} where the cursor was in the subject or the message. */
function insert(v: string) {
  const token = `{${v}}`
  const el = lastField.value === 'subject' ? subjectEl.value : bodyEl.value
  const key = lastField.value
  if (!el) {
    form.body += token
    return
  }
  const start = el.selectionStart ?? form[key].length
  const end = el.selectionEnd ?? start
  form[key] = form[key].slice(0, start) + token + form[key].slice(end)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

async function save() {
  if (!selected.value) return
  saving.value = true
  try {
    const r = await salesSettingsApi.saveTemplate(selected.value.key, { ...form })
    templates.value = r.items
    saved.value = JSON.stringify(form)
    toast.add({ severity: 'success', summary: `${selected.value.name} email saved`, life: 3000 })
  } finally {
    saving.value = false
  }
}
async function sendTest() {
  if (dirty.value) await save()
  const r = await salesSettingsApi.sendTest(selectedKey.value)
  toast.add({ severity: 'success', summary: 'Sent', detail: `Test email logged to ${r.sentTo}.`, life: 3500 })
}

// ── New template ─────────────────────────────────────────────────────────────
const newOpen = ref(false)
const newForm = reactive({ name: '', description: '' })
const newError = ref('')
async function createTemplate() {
  if (newForm.name.trim().length < 2) {
    newError.value = 'Give the template a name.'
    return
  }
  try {
    const r = await salesSettingsApi.newTemplate({ name: newForm.name.trim(), description: newForm.description.trim() || undefined })
    templates.value = r.items
    select(r.key)
    newOpen.value = false
  } catch (error) {
    if (error instanceof ApiError) newError.value = error.fieldErrors.name ?? error.message
  }
}
</script>

<template>
  <PageHeader title="Email templates" subtitle="The email sent when someone clicks “Email to customer” on a document.">
    <template v-if="canManage" #actions>
      <button type="button" class="erp-btn erp-btn-secondary" :disabled="!selected" @click="sendTest">Send test to me</button>
      <button type="button" class="erp-btn erp-btn-add" :disabled="!dirty || saving" @click="save">Save template</button>
    </template>
  </PageHeader>

  <div class="grid grow items-stretch gap-4 grid-cols-[280px_minmax(0,1fr)_380px]">
    <section class="erp-card flex flex-col gap-2 px-4 py-[18px]">
      <h2 class="m-0 mb-1 px-1 text-[15px] font-bold">Templates</h2>
      <button
        v-for="t in templates"
        :key="t.key"
        type="button"
        class="cursor-pointer rounded-[10px] border px-3.5 py-2.5 text-left"
        :class="t.key === selectedKey ? 'border-2 border-mod-primary bg-mod-light' : 'border-erp-border bg-erp-card hover:bg-erp-head'"
        @click="select(t.key)"
      >
        <span class="block text-[13px] font-bold" :class="t.key === selectedKey ? 'text-mod-accent' : ''">{{ t.name }}</span>
        <span class="text-xs text-erp-subtle">{{ t.description }}</span>
      </button>
      <button v-if="canManage" type="button" class="erp-btn erp-btn-secondary mt-auto justify-center" @click="(newForm.name = ''), (newForm.description = ''), (newError = ''), (newOpen = true)">
        <Plus :size="14" aria-hidden="true" />New template
      </button>
    </section>

    <section v-if="selected" class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">{{ selected.name }} email</h2>
      <FormField label="Subject" for="tpl-subject">
        <input id="tpl-subject" ref="subjectEl" v-model="form.subject" class="erp-input" maxlength="300" :disabled="!canManage" @focus="lastField = 'subject'" />
      </FormField>
      <FormField label="Message" for="tpl-body">
        <textarea id="tpl-body" ref="bodyEl" v-model="form.body" rows="12" class="erp-input h-auto py-2 leading-relaxed" maxlength="5000" :disabled="!canManage" @focus="lastField = 'body'" />
      </FormField>
      <template v-if="canManage">
        <span class="text-xs font-semibold text-erp-muted">Click to insert</span>
        <div class="flex flex-wrap gap-2">
          <button v-for="v in variables" :key="v" type="button" class="cursor-pointer rounded-md border-0 bg-mod-light px-2 py-1 font-mono text-xs text-mod-accent" @click="insert(v)">{{ tokenOf(v) }}</button>
        </div>
      </template>
      <div class="flex flex-wrap gap-6 pt-1 text-[13px]">
        <label class="flex items-center gap-2"><SwitchToggle v-model="form.attachPdf" label="Attach the PDF" :disabled="!canManage" />Attach the {{ selected.name.toLowerCase().split(' ·')[0] }} PDF</label>
        <label class="flex items-center gap-2"><SwitchToggle v-model="form.copyAgent" label="Copy the sales agent" :disabled="!canManage" />Copy the sales agent</label>
      </div>
    </section>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <h2 class="m-0 text-[15px] font-bold">Preview{{ preview?.docNo ? ` · ${preview.docNo}` : '' }}</h2>
      <template v-if="preview">
        <p class="m-0 text-xs text-erp-subtle">To: {{ preview.to ?? '—' }}<template v-if="preview.cc"> · Cc: {{ preview.cc }}</template></p>
        <p class="m-0 border-b border-erp-row pb-3 text-[15px] font-bold">{{ preview.subject }}</p>
        <div class="text-[13px] leading-relaxed whitespace-pre-line">{{ preview.body }}</div>
        <div v-if="preview.attachment && form.attachPdf" class="mt-auto flex items-center gap-2 rounded-lg bg-erp-head px-3 py-2.5 text-[13px]">
          <FileText :size="16" class="text-note-error-text" aria-hidden="true" />{{ preview.attachment }}
        </div>
      </template>
      <p v-else class="m-0 text-[13px] text-erp-muted">The preview uses a real document of this kind.</p>
    </section>
  </div>

  <Dialog v-model:visible="newOpen" modal :draggable="false" class="erp-dialog" :style="{ width: '440px' }" header="New template">
    <div class="flex flex-col gap-3">
      <FormField label="Name" :error="newError" for="nt-name"><input id="nt-name" v-model="newForm.name" class="erp-input" maxlength="100" placeholder="e.g. Payment thank-you" /></FormField>
      <FormField label="When it is sent (optional)" for="nt-desc"><input id="nt-desc" v-model="newForm.description" class="erp-input" maxlength="200" placeholder="e.g. Sent manually from an invoice" /></FormField>
    </div>
    <template #footer>
      <button type="button" class="erp-btn erp-btn-secondary" @click="newOpen = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" @click="createTemplate">Create</button>
    </template>
  </Dialog>
</template>
