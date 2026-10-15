<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { configSettingsApi } from '../api/config'
import type { SignInSettings, SignInSettingsView } from '../types'

/** A14 · Sign-in settings (CfgSignInSettings.html): one row each in sys_setting; a save applies on the next request. */
const toast = useToast()

const view = ref<SignInSettingsView | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const form = reactive<SignInSettings>({
  passwordMinLength: 10,
  refuseCommonPasswords: true,
  passwordMaxAgeDays: null,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
  lockoutPerAddress: true,
  idleMinutes: 30,
  refreshDays: 30,
  accessMinutes: 15,
  linkMinutes: 60,
  twoFactorRoles: [],
  emailSetPasswordLink: true,
})
const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)
const editable = computed(() => Boolean(view.value?.allowedActions.includes('edit')))

function show(v: SignInSettingsView) {
  view.value = v
  Object.assign(form, { ...v.settings, twoFactorRoles: [...v.settings.twoFactorRoles] })
  saved.value = snapshot()
  errors.value = {}
}

onMounted(async () => {
  try {
    show(await configSettingsApi.signIn())
  } finally {
    loading.value = false
  }
})

/** Number fields with their unit inside the box ("10 characters"), as on the mockup. */
const NUMBERS = {
  passwordMinLength: 'characters',
  lockoutAttempts: 'wrong passwords',
  lockoutMinutes: 'minutes',
  idleMinutes: 'minutes',
  refreshDays: 'days',
  linkMinutes: 'minutes',
} as const
type NumberField = keyof typeof NUMBERS
const limit = (f: NumberField) => view.value?.limits[f]

const ageLabel = (days: number | null) => (days === null ? 'Never (SDD 10.2)' : `Every ${days} days`)
const roleName = (code: string) => view.value?.roles.find((r) => r.code === code)?.name ?? code
const addable = computed(() => (view.value?.roles ?? []).filter((r) => !form.twoFactorRoles.includes(r.code)))
const adding = ref('')
function addRole() {
  if (adding.value) form.twoFactorRoles.push(adding.value)
  adding.value = ''
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    // The access token's 15 minutes are not on the form (SDD 10.2): everything else is sent.
    const changes: Partial<SignInSettings> = { ...form, twoFactorRoles: [...form.twoFactorRoles] }
    delete changes.accessMinutes
    show(await configSettingsApi.saveSignIn({ ...changes, version: view.value!.version }))
    toast.add({ severity: 'success', summary: 'Sign-in settings saved', detail: 'They apply from the next sign-in or request.', life: 4000 })
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="erp-card px-6 py-[18px]">
    <PageHeader title="Sign-in settings" :subtitle="`How passwords, lockout, sessions and two-factor work for everyone in ${view?.tenantName ?? 'the company'}.`">
      <template #actions>
        <button v-if="dirty" type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="view && show(view)">Undo</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">Save changes</button>
      </template>
    </PageHeader>
  </section>

  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <div v-else-if="view" class="flex max-w-[1000px] flex-col gap-4">
    <!-- Passwords -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Passwords</h2>
      <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5 max-md:grid-cols-1">
        <FormField label="Shortest password" for="passwordMinLength" :error="errors.passwordMinLength">
          <label class="erp-input flex items-center gap-1.5 focus-within:outline-2 focus-within:outline-[var(--mod-line)]">
            <input id="passwordMinLength" v-model.number="form.passwordMinLength" type="text" inputmode="numeric" :min="limit('passwordMinLength')?.min" :max="limit('passwordMinLength')?.max" class="field-sizing-content min-w-[2ch] border-0 bg-transparent p-0 text-[13px] outline-none" :disabled="!editable" />
            <span>{{ NUMBERS.passwordMinLength }}</span>
          </label>
        </FormField>
        <FormField label="Common passwords" for="refuseCommon">
          <select id="refuseCommon" v-model="form.refuseCommonPasswords" class="erp-input" :disabled="!editable">
            <option :value="true">Refused</option>
            <option :value="false">Allowed</option>
          </select>
        </FormField>
        <FormField label="Ask to change regularly" for="passwordMaxAgeDays" :error="errors.passwordMaxAgeDays">
          <select id="passwordMaxAgeDays" v-model="form.passwordMaxAgeDays" class="erp-input" :disabled="!editable">
            <option v-for="d in view.passwordAgeChoices" :key="String(d)" :value="d">{{ ageLabel(d) }}</option>
          </select>
        </FormField>
      </div>
    </section>

    <!-- Wrong passwords -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Wrong passwords</h2>
      <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5 max-md:grid-cols-1">
        <FormField v-for="f in ['lockoutAttempts', 'lockoutMinutes'] as const" :key="f" :label="f === 'lockoutAttempts' ? 'Lock the account after' : 'For'" :for="f" :error="errors[f]">
          <label class="erp-input flex items-center gap-1.5 focus-within:outline-2 focus-within:outline-[var(--mod-line)]">
            <input :id="f" v-model.number="form[f]" type="text" inputmode="numeric" :min="limit(f)?.min" :max="limit(f)?.max" class="field-sizing-content min-w-[2ch] border-0 bg-transparent p-0 text-[13px] outline-none" :disabled="!editable" />
            <span>{{ NUMBERS[f] }}</span>
          </label>
        </FormField>
        <FormField label="Count per" for="lockoutPerAddress">
          <select id="lockoutPerAddress" v-model="form.lockoutPerAddress" class="erp-input" :disabled="!editable">
            <option :value="true">Account and network address</option>
            <option :value="false">Account only</option>
          </select>
        </FormField>
      </div>
      <span class="text-xs text-erp-muted">Counting per address too stops someone from locking a colleague out on purpose.</span>
    </section>

    <!-- Staying signed in -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Staying signed in</h2>
      <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5 max-md:grid-cols-1">
        <FormField
          v-for="f in ['idleMinutes', 'refreshDays', 'linkMinutes'] as const"
          :key="f"
          :label="{ idleMinutes: 'Sign out after no activity for', refreshDays: 'A device stays signed in for', linkMinutes: 'Reset and set-password links last' }[f]"
          :for="f"
          :error="errors[f]"
        >
          <label class="erp-input flex items-center gap-1.5 focus-within:outline-2 focus-within:outline-[var(--mod-line)]">
            <input :id="f" v-model.number="form[f]" type="text" inputmode="numeric" :min="limit(f)?.min" :max="limit(f)?.max" class="field-sizing-content min-w-[2ch] border-0 bg-transparent p-0 text-[13px] outline-none" :disabled="!editable" />
            <span>{{ NUMBERS[f] }}</span>
          </label>
        </FormField>
      </div>
    </section>

    <!-- Two-factor -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Two-factor sign-in</h2>
      <div class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted">
        <span>Required for these roles</span>
        <div class="flex flex-wrap items-center gap-2">
          <span v-for="code in form.twoFactorRoles" :key="code" class="inline-flex items-center gap-1.5 rounded-full bg-erp-track px-2.5 py-1 text-xs font-semibold text-erp-text">
            {{ roleName(code) }}
            <button v-if="editable" type="button" class="cursor-pointer border-0 bg-transparent p-0 text-erp-muted hover:text-note-error-text" :aria-label="`Remove ${roleName(code)}`" @click="form.twoFactorRoles = form.twoFactorRoles.filter((r) => r !== code)">
              <X :size="12" />
            </button>
          </span>
          <span v-if="!form.twoFactorRoles.length" class="text-[13px] font-normal">No role: two-factor is up to each person.</span>
          <template v-if="editable && addable.length">
            <select v-model="adding" class="erp-input h-8 w-auto py-0 text-xs" aria-label="Add role" @change="addRole">
              <option value="" disabled>+ Add role</option>
              <option v-for="r in addable" :key="r.code" :value="r.code">{{ r.name }}</option>
            </select>
          </template>
        </div>
        <span v-if="errors.twoFactorRoles" class="font-medium text-note-error-text" role="alert">{{ errors.twoFactorRoles }}</span>
      </div>
      <span class="text-xs text-erp-muted">Roles with admin or finance authority (SRS FR-SEC-061). Anyone else may turn it on for themselves.</span>
    </section>

    <!-- New users -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">New users</h2>
      <label class="flex items-center gap-2.5 text-[13px] font-medium">
        <SwitchToggle v-model="form.emailSetPasswordLink" label="Email a set-password link when a user is added" :disabled="!editable" />
        Email a set-password link when a user is added
      </label>
      <span class="text-xs text-erp-muted">Passwords are never sent. Until real email is connected, the link is written to the email log.</span>
    </section>
  </div>
</template>
