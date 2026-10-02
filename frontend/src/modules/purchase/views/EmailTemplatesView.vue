<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { ApiError } from '@/api/http'
import { formatDayMonth } from '@/utils/format'
import { settingsApi } from '../api/purchase'
import type { EmailTemplateDetail, EmailTemplateInput, EmailTemplateSummary } from '../types'

/** P26 · Email Templates (PurEmailTemplates.html). The chosen template is kept in the URL (?t=). */
const route = useRoute()
const router = useRouter()
const toast = useToast()

const list = ref<EmailTemplateSummary[]>([])
const canEdit = ref(false)
const detail = ref<EmailTemplateDetail | null>(null)
const form = ref<EmailTemplateInput | null>(null)
const errors = ref<Record<string, string>>({})
const busy = ref(false)
const bodyEl = ref<HTMLTextAreaElement | null>(null)

const selectedKey = computed(() => (typeof route.query.t === 'string' ? route.query.t : list.value[0]?.key) ?? '')

const toInput = (d: EmailTemplateDetail): EmailTemplateInput => ({
  toTemplate: d.toTemplate,
  ccTemplate: d.ccTemplate,
  subject: d.subject,
  body: d.body,
  attachPdf: d.attachPdf,
  autoSend: d.autoSend,
  isActive: d.isActive,
})
function fill(d: EmailTemplateDetail) {
  detail.value = d
  form.value = toInput(d)
  errors.value = {}
  const row = list.value.find((t) => t.key === d.key)
  if (row) row.isActive = d.isActive
}
const dirty = computed(() => Boolean(detail.value && form.value && JSON.stringify(form.value) !== JSON.stringify(toInput(detail.value))))
const readOnly = computed(() => !canEdit.value)

onMounted(async () => {
  const r = await settingsApi.emailTemplates()
  list.value = r.items
  canEdit.value = r.canEdit
})
watch(selectedKey, async (key) => {
  if (key) fill(await settingsApi.emailTemplate(key))
}, { immediate: true })

function pick(key: string) {
  if (key === selectedKey.value) return
  if (dirty.value && !window.confirm('You have changes that are not saved. Leave this template?')) return
  router.replace({ query: { ...route.query, t: key } })
}

async function save() {
  if (!form.value || !detail.value) return
  busy.value = true
  try {
    fill(await settingsApi.saveEmailTemplate(detail.value.key, form.value))
    toast.add({ severity: 'success', summary: 'Template saved', life: 2500 })
  } catch (e) {
    if (e instanceof ApiError) errors.value = Object.fromEntries((e.body.errors ?? []).map((x) => [x.field, x.message]))
  } finally {
    busy.value = false
  }
}
async function sendTest() {
  if (!detail.value) return
  busy.value = true
  try {
    const r = await settingsApi.sendTest(detail.value.key)
    toast.add({ severity: 'success', summary: 'Sent', detail: `Test email to ${r.to}. Logged only; email is not connected yet.`, life: 3500 })
    fill(await settingsApi.emailTemplate(detail.value.key))
  } finally {
    busy.value = false
  }
}

const braced = (field: string) => `{${field}}`

/** Clicking a field chip puts it into the message where the cursor is. */
function insertField(field: string) {
  if (!form.value || readOnly.value) return
  const el = bodyEl.value
  const text = `{${field}}`
  const start = el?.selectionStart ?? form.value.body.length
  const end = el?.selectionEnd ?? start
  form.value.body = form.value.body.slice(0, start) + text + form.value.body.slice(end)
  requestAnimationFrame(() => {
    el?.focus()
    el?.setSelectionRange(start + text.length, start + text.length)
  })
}
</script>

<template>
  <PageHeader title="Email Templates" subtitle="Emails Purchase sends to suppliers and approvers. Words in braces are filled in from the document.">
    <template #actions>
      <template v-if="!readOnly">
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy || !detail" @click="sendTest">Send test email</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="busy || !dirty" @click="save">Save template</button>
      </template>
      <span v-else class="text-xs text-erp-muted">Only the Purchasing Manager can change these.</span>
    </template>
  </PageHeader>

  <div class="grid grow items-start gap-4 grid-cols-[260px_minmax(0,1fr)_300px]">
    <section class="erp-card flex flex-col gap-1 px-3 py-4">
      <h2 class="m-0 mb-1.5 px-2 text-[15px] font-bold">Templates</h2>
      <button
        v-for="t in list"
        :key="t.key"
        type="button"
        class="flex flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-[13px]"
        :class="t.key === selectedKey ? 'border-mod-light-border bg-mod-light' : 'hover:bg-erp-head'"
        :aria-current="t.key === selectedKey"
        @click="pick(t.key)"
      >
        <span class="font-semibold" :class="{ 'text-erp-muted': !t.isActive }">{{ t.name }}<span v-if="!t.isActive" class="font-normal"> · off</span></span>
        <span class="text-xs text-erp-muted">{{ t.description }}</span>
      </button>
    </section>

    <section v-if="detail && form" class="erp-card flex min-w-0 flex-col gap-3 px-5 py-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">{{ detail.name }}</h2>
        <label class="flex items-center gap-2 text-[13px] font-semibold">In use <SwitchToggle v-model="form.isActive" :label="`${detail.name} in use`" :disabled="readOnly" /></label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 text-xs font-semibold text-erp-subtle">To
          <input v-model="form.toTemplate" class="erp-input font-normal" :disabled="readOnly" :aria-invalid="!!errors.toTemplate" />
          <span v-if="errors.toTemplate" class="font-normal text-note-error-text">{{ errors.toTemplate }}</span>
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold text-erp-subtle">Cc
          <input :value="form.ccTemplate ?? ''" class="erp-input font-normal" :disabled="readOnly" :aria-invalid="!!errors.ccTemplate" @input="form.ccTemplate = ($event.target as HTMLInputElement).value" />
          <span v-if="errors.ccTemplate" class="font-normal text-note-error-text">{{ errors.ccTemplate }}</span>
        </label>
      </div>
      <label class="flex flex-col gap-1 text-xs font-semibold text-erp-subtle">Subject
        <input v-model="form.subject" class="erp-input font-normal" :disabled="readOnly" :aria-invalid="!!errors.subject" />
        <span v-if="errors.subject" class="font-normal text-note-error-text">{{ errors.subject }}</span>
      </label>
      <label class="flex flex-col gap-1 text-xs font-semibold text-erp-subtle">Message
        <textarea ref="bodyEl" v-model="form.body" rows="14" class="erp-input h-auto py-2 font-normal leading-relaxed" :disabled="readOnly" :aria-invalid="!!errors.body" />
        <span v-if="errors.body" class="font-normal text-note-error-text">{{ errors.body }}</span>
      </label>
      <div class="flex items-center justify-between gap-4 border-t border-erp-row pt-3">
        <div class="text-[13px]">
          <div class="font-semibold">Attach the PO as PDF</div>
          <div class="text-xs text-erp-muted">Uses the standard purchase order layout</div>
        </div>
        <SwitchToggle v-model="form.attachPdf" label="Attach the PO as PDF" :disabled="readOnly" />
      </div>
      <div class="flex items-center justify-between gap-4 border-t border-erp-row pt-3">
        <div class="text-[13px]">
          <div class="font-semibold">Send automatically on release</div>
          <div class="text-xs text-erp-muted">Otherwise the buyer clicks “Email to supplier”</div>
        </div>
        <SwitchToggle v-model="form.autoSend" label="Send automatically on release" :disabled="readOnly" />
      </div>
    </section>
    <div v-else class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

    <div v-if="detail" class="flex flex-col gap-3.5">
      <SideCard title="Fields you can use">
        <div class="flex flex-wrap gap-1.5">
          <button v-for="f in detail.fields" :key="f" type="button" class="rounded-md border border-erp-border bg-erp-head px-2 py-1 font-mono text-[11px]" :disabled="readOnly" :title="readOnly ? undefined : 'Add to the message'" @click="insertField(f)" v-text="braced(f)" />
        </div>
        <p class="m-0 text-xs text-erp-muted">Supplier fields come from Master Data. Company name and logo come from Master Data · Company.</p>
      </SideCard>
      <SideCard title="Last sent">
        <p v-if="!detail.lastSent.length" class="m-0 text-[13px] text-erp-muted">Not sent yet.</p>
        <div v-for="s in detail.lastSent" :key="s.id" class="flex justify-between gap-3 border-b border-erp-row pb-2 text-[13px] last:border-b-0 last:pb-0">
          <span class="min-w-0 truncate">{{ s.docNo }} · {{ s.to }}</span>
          <span class="shrink-0 text-erp-muted">{{ formatDayMonth(s.at.slice(0, 10)) }}</span>
        </div>
      </SideCard>
    </div>
  </div>
</template>
