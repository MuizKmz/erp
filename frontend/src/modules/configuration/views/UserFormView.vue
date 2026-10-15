<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { KeyRound, Lock, Mail, Pencil, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { formatDate, formatDateTime } from '@/utils/format'
import { configUsersApi } from '../api/config'
import type { UserAction, UserDetail, UserInput, UserLookups } from '../types'

/** A07 · New user / user with roles, branches and sign-in (CfgUserForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const user = ref<UserDetail | null>(null)
const lookups = ref<UserLookups | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

/** A role on the form: read as a table row until someone changes its dates. */
interface RoleLine {
  key: number
  roleCode: string
  validFrom: string
  validUntil: string
  editing: boolean
}
let nextKey = 1

const form = reactive({
  code: '',
  name: '',
  email: '',
  jobTitle: '',
  department: '',
  roles: [] as RoleLine[],
  branches: [] as string[],
  defaultBranch: '',
})
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, roles: form.roles.map((r) => [r.roleCode, r.validFrom, r.validUntil]) })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: UserAction) => Boolean(user.value?.allowedActions.includes(a))
const editable = computed(() => (isNew.value ? Boolean(lookups.value?.canEdit) : can('edit')))
const STATUS_GROUP = { active: 'done', locked: 'pending', inactive: 'draft' } as const

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

function fill(u: UserDetail | null) {
  Object.assign(form, {
    code: u?.code ?? '',
    name: u?.name ?? '',
    email: u?.email ?? '',
    jobTitle: u?.jobTitle ?? '',
    department: u?.department ?? '',
    roles: (u?.roles ?? []).map((r) => ({ key: nextKey++, roleCode: r.roleCode, validFrom: r.validFrom ?? '', validUntil: r.validUntil ?? '', editing: false })),
    branches: [...(u?.branches ?? [])],
    defaultBranch: u?.defaultBranch ?? '',
  })
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    lookups.value = await configUsersApi.lookups()
    user.value = isNew.value ? null : await configUsersApi.get(id.value)
    fill(user.value)
    setCrumb(user.value?.code ?? 'New user')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const role = (code: string) => lookups.value?.roles.find((r) => r.code === code)
const roleChoices = (line: RoleLine) => (lookups.value?.roles ?? []).filter((r) => r.code === line.roleCode || !form.roles.some((x) => x.roleCode === r.code))
function addRole() {
  form.roles.push({ key: nextKey++, roleCode: '', validFrom: '', validUntil: '', editing: true })
}

/** Active branches, and an inactive one the user still has. */
const branchChoices = computed(() => (lookups.value?.branches ?? []).filter((b) => b.isActive || form.branches.includes(b.code)))
function toggleBranch(code: string, on: boolean) {
  form.branches = on ? [...form.branches, code].sort() : form.branches.filter((b) => b !== code)
  if (!form.branches.includes(form.defaultBranch)) form.defaultBranch = form.branches[0] ?? ''
}

const blankToNull = (v: string) => v.trim() || null
const body = (): UserInput => ({
  name: form.name.trim(),
  email: form.email.trim(),
  jobTitle: blankToNull(form.jobTitle),
  department: blankToNull(form.department),
  roles: form.roles.map((r) => ({ roleCode: r.roleCode, validFrom: r.validFrom || null, validUntil: r.validUntil || null })),
  branches: form.branches,
  defaultBranch: form.defaultBranch || null,
})

function show(u: UserDetail) {
  user.value = u
  fill(u)
  setCrumb(u.code)
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      const created = await configUsersApi.create({ ...body(), code: form.code.trim().toUpperCase() })
      toast.add({ severity: 'success', summary: `User ${created.code} created`, life: 3000 })
      await router.replace(`/config/users/${created.id}`)
      show(created)
    } else {
      show(await configUsersApi.update(id.value, { ...body(), version: user.value!.version }))
      toast.add({ severity: 'success', summary: 'User saved', life: 3000 })
    }
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

/** A07 · Sign-in card (A6): links by email, sessions, two-factor and lockout. */
const SIGN_IN_ACTIONS = {
  'send-link': {
    header: (u: UserDetail) => (u.signIn.hasPassword ? `Send ${u.name} a reset link?` : `Send ${u.name} a set-password link?`),
    message: (u: UserDetail) => `A single-use link goes to ${u.email}. Their current password keeps working until they use it.`,
    accept: 'Send link',
    done: (u: UserDetail) => `Link sent to ${u.email}`,
  },
  'revoke-sessions': {
    header: (u: UserDetail) => `Sign ${u.name} out everywhere?`,
    message: (u: UserDetail) => `Every device they are signed in on (${u.signIn.openSessions}) asks them to sign in again.`,
    accept: 'Sign out everywhere',
    done: (u: UserDetail) => `${u.name} signed out everywhere`,
  },
  'reset-two-factor': {
    header: (u: UserDetail) => `Reset the two-factor of ${u.name}?`,
    message: () => 'For a lost phone: their authenticator and recovery codes stop working and they are signed out. If their roles need two-factor, they set it up again at their next sign-in.',
    accept: 'Reset two-factor',
    done: (u: UserDetail) => `Two-factor of ${u.name} reset`,
  },
  unlock: {
    header: (u: UserDetail) => `Unlock ${u.name}?`,
    message: () => 'The wrong-password count goes back to 0 and they can sign in again now.',
    accept: 'Unlock',
    done: (u: UserDetail) => `${u.name} unlocked`,
  },
} as const

function signInAction(action: keyof typeof SIGN_IN_ACTIONS) {
  const u = user.value!
  const def = SIGN_IN_ACTIONS[action]
  confirm.require({
    header: def.header(u),
    message: def.message(u),
    acceptLabel: def.accept,
    rejectLabel: 'Cancel',
    accept: async () => {
      show(await configUsersApi.signInAction(u.id, action))
      toast.add({ severity: 'success', summary: def.done(u), life: 3000 })
    },
  })
}
const openEmail = ref('')

function setActive(action: 'deactivate' | 'activate') {
  const u = user.value!
  const run = async () => {
    show(await configUsersApi.setActive(u.id, action, u.version))
    toast.add({ severity: 'success', summary: `${u.name} ${action === 'activate' ? 'activated' : 'deactivated'}`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({
    header: `Deactivate ${u.name}?`,
    message: 'They can no longer sign in, and any session they have ends. Documents they made keep their name. You can activate them again.',
    acceptLabel: 'Deactivate',
    rejectLabel: 'Keep them',
    acceptClass: 'p-button-danger',
    accept: run,
  })
}
</script>

<template>
  <div v-if="loading && !lookups" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="lookups">
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New user' : `User ${user?.code ?? ''}`" :subtitle="isNew ? 'They get a link by email to set their password.' : user?.subtitle" document>
        <template v-if="user" #chip>
          <StatusChip :status="user.status.toUpperCase()" :label="user.statusLabel" :group="STATUS_GROUP[user.status]" />
        </template>
        <template #actions>
          <template v-if="user">
            <button
              v-if="can('deactivate')"
              type="button"
              class="erp-btn erp-btn-danger"
              :disabled="saving || dirty || !!user.refusals.deactivate"
              :title="user.refusals.deactivate ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setActive('deactivate')"
            >
              Deactivate
            </button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setActive('activate')">Activate</button>
          </template>
          <RouterLink v-if="isNew" to="/config/users" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
          <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">{{ isNew ? 'Create user' : 'Save changes' }}</button>
        </template>
      </PageHeader>
    </section>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- Person -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Person</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField v-if="isNew" label="User code" for="code" :error="errors.code">
              <input id="code" v-model="form.code" class="erp-input uppercase" maxlength="20" placeholder="LMY" />
            </FormField>
            <div v-else class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span class="flex justify-between gap-2">
                <label for="code">User code</label>
                <span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ user?.code }}</div>
            </div>
            <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
              <input id="name" v-model="form.name" class="erp-input" maxlength="100" :disabled="!editable" />
            </FormField>
            <FormField label="Email · sign-in and reset links go here" for="email" :error="errors.email" class="col-span-2">
              <input id="email" v-model="form.email" type="email" class="erp-input" maxlength="150" :disabled="!editable" />
            </FormField>
            <FormField label="Job title" for="jobTitle" :error="errors.jobTitle">
              <input id="jobTitle" v-model="form.jobTitle" class="erp-input" maxlength="50" :disabled="!editable" />
            </FormField>
            <FormField label="Department" for="department" :error="errors.department">
              <input id="department" v-model="form.department" class="erp-input" maxlength="50" :disabled="!editable" />
            </FormField>
          </div>
        </section>

        <!-- Roles -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Roles</h2>
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="addRole"><Plus :size="14" aria-hidden="true" />Add role</button>
          </div>
          <p v-if="!form.roles.length" class="m-0 text-[13px] text-erp-muted">No roles yet. A user needs at least one.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>Role</th>
                <th class="w-[150px]">From</th>
                <th class="w-[150px]">Until</th>
                <th>Gives</th>
                <th v-if="editable" class="w-[60px]"><span class="sr-only">Change</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(r, n) in form.roles" :key="r.key">
                <tr v-if="!r.editing">
                  <td class="font-semibold whitespace-nowrap">{{ role(r.roleCode)?.name ?? r.roleCode }}</td>
                  <td class="whitespace-nowrap" :class="{ 'text-erp-muted': !r.validFrom }">{{ r.validFrom ? formatDate(r.validFrom) : '—' }}</td>
                  <td class="whitespace-nowrap" :class="{ 'text-erp-muted': !r.validUntil }">{{ r.validUntil ? formatDate(r.validUntil) : 'No end' }}</td>
                  <td>
                    <RouterLink v-if="role(r.roleCode)" :to="`/config/roles/${role(r.roleCode)!.id}`" class="erp-link">{{ role(r.roleCode)!.permissions }} permissions</RouterLink>
                  </td>
                  <td v-if="editable" class="whitespace-nowrap text-right">
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-erp-text" :aria-label="`Change the dates of ${role(r.roleCode)?.name}`" @click="r.editing = true"><Pencil :size="14" /></button>
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove ${role(r.roleCode)?.name}`" @click="form.roles.splice(n, 1)"><X :size="15" /></button>
                  </td>
                </tr>
                <tr v-else>
                  <td>
                    <select v-model="r.roleCode" class="erp-input" :aria-label="`Role ${n + 1}`">
                      <option value="" disabled>Pick the role</option>
                      <option v-for="c in roleChoices(r)" :key="c.code" :value="c.code">{{ c.name }}</option>
                    </select>
                  </td>
                  <td>
                    <DatePicker
                      :model-value="isoToDate(r.validFrom)"
                      date-format="d M yy"
                      placeholder="—"
                      show-button-bar
                      fluid
                      class="erp-date"
                      :input-id="`role-from-${n}`"
                      @update:model-value="r.validFrom = dateToIso($event)"
                      @clear-click="r.validFrom = ''"
                    />
                  </td>
                  <td>
                    <DatePicker
                      :model-value="isoToDate(r.validUntil)"
                      date-format="d M yy"
                      placeholder="No end"
                      show-button-bar
                      fluid
                      class="erp-date"
                      :input-id="`role-until-${n}`"
                      @update:model-value="r.validUntil = dateToIso($event)"
                      @clear-click="r.validUntil = ''"
                    />
                  </td>
                  <td class="text-erp-muted">{{ role(r.roleCode) ? `${role(r.roleCode)!.permissions} permissions` : '' }}</td>
                  <td class="text-right">
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove role ${n + 1}`" @click="form.roles.splice(n, 1)"><X :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="errors[`roles[${n}]`]">
                  <td :colspan="editable ? 5 : 4" class="pt-0 text-xs font-medium text-note-error-text" role="alert">{{ errors[`roles[${n}]`] }}</td>
                </tr>
              </template>
            </tbody>
          </table>
          <span v-if="errors.roles" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.roles }}</span>
          <span class="text-xs text-erp-muted">{{ user?.rolesNote ?? 'Permissions are the sum of all roles. A role can end on a date for temporary access.' }}</span>
        </section>

        <!-- Branches -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Branches</h2>
          <div class="flex flex-wrap gap-x-6 gap-y-2.5">
            <label v-for="b in branchChoices" :key="b.code" class="flex items-center gap-2.5 text-[13px] font-medium">
              <SwitchToggle :model-value="form.branches.includes(b.code)" :label="`${b.code} · ${b.name}`" :disabled="!editable" @update:model-value="toggleBranch(b.code, $event)" />
              {{ b.code }} · {{ b.name }}<span v-if="!b.isActive" class="text-xs font-normal text-erp-muted">(inactive)</span>
            </label>
          </div>
          <span v-if="errors.branches" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.branches }}</span>
          <div class="grid grid-cols-3 gap-x-[18px]">
            <FormField label="Default branch at sign-in" for="defaultBranch" :error="errors.defaultBranch">
              <select id="defaultBranch" v-model="form.defaultBranch" class="erp-input" :disabled="!editable || !form.branches.length">
                <option value="" disabled>Pick a branch first</option>
                <option v-for="b in branchChoices.filter((x) => form.branches.includes(x.code))" :key="b.code" :value="b.code">{{ b.code }} · {{ b.name }}</option>
              </select>
            </FormField>
          </div>
          <span class="text-xs text-erp-muted">{{ user && !dirty ? user.branchNote : 'A user with no branch cannot make documents.' }}</span>
        </section>

        <!-- Sign-in -->
        <section v-if="user" class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Sign-in</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Two-factor" for="twoFactor">
              <div id="twoFactor" class="erp-input-ro" :class="{ 'font-semibold text-note-warn-strong': user.signIn.twoFactor === 'REQUIRED_MISSING' }">{{ user.signIn.twoFactorText }}</div>
            </FormField>
            <FormField label="Last sign-in" for="lastSignIn">
              <div id="lastSignIn" class="erp-input-ro">{{ user.signIn.lastSignInAt ? formatDateTime(user.signIn.lastSignInAt) : 'Never' }}</div>
            </FormField>
            <FormField label="Failed attempts" for="failed">
              <div id="failed" class="erp-input-ro">{{ user.signIn.failedSignIns }}</div>
            </FormField>
          </div>
          <div v-if="user.status === 'locked' && user.signIn.lockedUntil" class="text-[13px] font-semibold text-note-warn-strong">
            Locked until {{ formatDateTime(user.signIn.lockedUntil) }} after too many wrong passwords.
          </div>
          <div v-if="can('send-link') || can('revoke-sessions')" class="flex flex-wrap items-center gap-2">
            <button v-if="can('send-link')" type="button" class="erp-btn erp-btn-secondary" :disabled="dirty" @click="signInAction('send-link')">
              <KeyRound :size="14" aria-hidden="true" />{{ user.signIn.hasPassword ? 'Send a reset link' : 'Send a set-password link' }}
            </button>
            <button v-if="can('revoke-sessions')" type="button" class="erp-btn erp-btn-secondary" :disabled="dirty || !user.signIn.openSessions" :title="user.signIn.openSessions ? undefined : 'Not signed in anywhere'" @click="signInAction('revoke-sessions')">
              Revoke all sessions
            </button>
            <button v-if="can('unlock')" type="button" class="erp-btn erp-btn-secondary" :disabled="dirty" @click="signInAction('unlock')">Unlock</button>
            <button v-if="can('reset-two-factor')" type="button" class="erp-btn erp-btn-secondary" :disabled="dirty" @click="signInAction('reset-two-factor')">Reset two-factor</button>
            <span class="text-xs text-erp-muted">
              {{ user.signIn.openSessions ? `Signed in on ${user.signIn.openSessions} device${user.signIn.openSessions === 1 ? '' : 's'}.` : 'Not signed in anywhere.' }}
              {{ user.signIn.hasPassword ? '' : 'No password yet: they set one with the link.' }}
            </span>
          </div>
          <div v-if="user.signIn.emails.length" class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-erp-muted">Sign-in emails · in the email log until real email is connected</span>
            <ul class="m-0 flex list-none flex-col p-0">
              <li v-for="e in user.signIn.emails" :key="e.id" class="border-t border-erp-row py-2 first:border-t-0">
                <button type="button" class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-[13px]" :aria-expanded="openEmail === e.id" @click="openEmail = openEmail === e.id ? '' : e.id">
                  <Mail :size="14" class="shrink-0 text-erp-muted" aria-hidden="true" />
                  <span class="font-semibold">{{ e.subject }}</span>
                  <span class="text-erp-muted">to {{ e.to }} · {{ formatDateTime(e.at) }}</span>
                </button>
                <pre v-if="openEmail === e.id" class="mt-2 mb-0 rounded-lg bg-erp-bg px-3 py-2.5 font-sans text-xs leading-relaxed break-all whitespace-pre-wrap">{{ e.body }}</pre>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <SideCard v-if="user" title="Effective permissions">
          <p class="m-0 text-[13px] text-erp-muted">{{ user.effective.text }}</p>
          <RouterLink :to="{ path: '/config/permissions', query: { user: user.code } }" class="erp-link text-[13px] font-semibold">See what they can do</RouterLink>
        </SideCard>
        <template v-if="user">
          <ActivityList v-if="user.activity.length" :items="user.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
        </template>
        <SideCard v-else title="Who gets in">
          <p class="m-0 text-[13px] text-erp-muted">
            A user needs at least one role and one branch. They get a single-use link by email to set their own password; nobody ever sends a password.
          </p>
        </SideCard>
      </div>
    </div>
  </template>
</template>
