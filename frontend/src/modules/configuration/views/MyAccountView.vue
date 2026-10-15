<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { Monitor, Smartphone } from '@lucide/vue'
import { ApiError } from '@/api/http'
import { accountApi, type Account, type TwoFactorSetup } from '@/api/session'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import { useSession } from '@/composables/useSession'
import RecoveryCodes from '@/modules/auth/RecoveryCodes.vue'
import { formatDateTime } from '@/utils/format'

/** A11 · My account (CfgMyAccount.html): everyone signed in may open it (choice 20). */
const toast = useToast()
const session = useSession()

const account = ref<Account | null>(null)
const loading = ref(true)
onMounted(async () => {
  try {
    account.value = await accountApi.get()
  } finally {
    loading.value = false
  }
})

// Password
const pw = reactive({ current: '', next: '', again: '' })
const pwErrors = ref<Record<string, string>>({})
const pwBusy = ref(false)
async function changePassword() {
  pwErrors.value = {}
  if (pw.next !== pw.again) {
    pwErrors.value = { again: 'The two new passwords are not the same.' }
    return
  }
  pwBusy.value = true
  try {
    const before = account.value?.sessions.length ?? 0
    account.value = await accountApi.changePassword(pw.current, pw.next)
    Object.assign(pw, { current: '', next: '', again: '' })
    const ended = before - account.value.sessions.length
    toast.add({ severity: 'success', summary: 'Password changed', detail: ended > 0 ? `Signed out on ${ended} other device${ended === 1 ? '' : 's'}.` : undefined, life: 4000 })
  } catch (error) {
    if (error instanceof ApiError) pwErrors.value = { current: error.fieldErrors.currentPassword ?? '', next: error.fieldErrors.newPassword ?? '' }
  } finally {
    pwBusy.value = false
  }
}

// Two-factor
type TwoFactorStep = 'idle' | 'setup' | 'codes' | 'off' | 'renew'
const tfStep = ref<TwoFactorStep>('idle')
const setup = ref<TwoFactorSetup | null>(null)
const tfCode = ref('')
const tfPassword = ref('')
const tfError = ref('')
const tfBusy = ref(false)
const freshCodes = ref<string[]>([])

const twoFactorText = computed(() => {
  const t = account.value?.twoFactor
  if (!t) return ''
  const left = `${t.recoveryCodesLeft} recovery code${t.recoveryCodesLeft === 1 ? '' : 's'} left.`
  if (t.enabled && t.required) return `On. Your roles need it, so it stays on. ${left}`
  if (t.enabled) return `On: a code from your phone at each sign-in. ${left}`
  if (t.required) return 'Off. Your roles need it: you set it up at your next sign-in.'
  return 'Off. Your roles do not need it, but you can turn it on: a code from your phone at each sign-in.'
})

function resetTwoFactorForm(step: TwoFactorStep = 'idle') {
  tfStep.value = step
  tfCode.value = ''
  tfPassword.value = ''
  tfError.value = ''
}

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  tfBusy.value = true
  tfError.value = ''
  try {
    return await action()
  } catch (error) {
    if (error instanceof ApiError) tfError.value = error.body.errors?.[0]?.message ?? error.message
    return undefined
  } finally {
    tfBusy.value = false
  }
}

async function startSetup() {
  const answer = await run(() => accountApi.startTwoFactor())
  if (!answer) return
  setup.value = answer
  resetTwoFactorForm('setup')
}

async function enable() {
  const answer = await run(() => accountApi.enableTwoFactor(tfCode.value))
  if (!answer) return
  account.value = answer.account
  freshCodes.value = answer.recoveryCodes
  setup.value = null
  resetTwoFactorForm('codes')
}

async function disable() {
  const answer = await run(() => accountApi.disableTwoFactor(tfPassword.value))
  if (!answer) return
  account.value = answer
  resetTwoFactorForm()
  toast.add({ severity: 'success', summary: 'Two-factor is off', life: 3000 })
}

async function renew() {
  const answer = await run(() => accountApi.newRecoveryCodes(tfPassword.value))
  if (!answer) return
  account.value = answer.account
  freshCodes.value = answer.recoveryCodes
  resetTwoFactorForm('codes')
}

// Devices
const phone = (device: string) => /iphone|android|ipad|mobile/i.test(device)
async function endSession(id: string) {
  account.value = await accountApi.endSession(id)
  toast.add({ severity: 'success', summary: 'Signed out on that device', life: 3000 })
}
async function endOthers() {
  account.value = await accountApi.endOthers()
  toast.add({ severity: 'success', summary: 'Signed out everywhere else', life: 3000 })
}
const others = computed(() => (account.value?.sessions ?? []).filter((s) => !s.current).length)
</script>

<template>
  <section class="erp-card px-6 py-[18px]">
    <PageHeader title="My account" subtitle="Your password, two-factor and the devices you are signed in on." />
  </section>

  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <div v-else-if="account" class="flex max-w-[1000px] flex-col gap-4">
    <NoticeBanner v-if="!account.signInOn">
      Sign-in is off on this server (AUTH_MODE=dev): the user switcher picks who you are. Your password and two-factor apply once sign-in is on.
    </NoticeBanner>
    <NoticeBanner v-if="account.password.changeDue" kind="warning">It is time to change your password: the sign-in settings ask for a new one regularly.</NoticeBanner>

    <!-- Me -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Me</h2>
      <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5 max-md:grid-cols-1">
        <FormField label="Name" for="name"><div id="name" class="erp-input-ro">{{ account.me.name }}</div></FormField>
        <FormField label="Email" for="email"><div id="email" class="erp-input-ro">{{ account.me.email }}</div></FormField>
        <FormField label="Roles" for="roles"><div id="roles" class="erp-input-ro">{{ account.me.roles.join(' · ') }}</div></FormField>
      </div>
      <span class="text-xs text-erp-muted">Your name, email and roles are kept by the Administrator.</span>
    </section>

    <!-- Password -->
    <form class="erp-card flex flex-col gap-3.5 px-[18px] py-4" novalidate @submit.prevent="changePassword">
      <h2 class="m-0 text-[15px] font-bold">Password</h2>
      <input type="text" class="hidden" autocomplete="username" :value="account.me.email" readonly aria-hidden="true" tabindex="-1" />
      <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5 max-md:grid-cols-1">
        <FormField label="Current password" for="current" :error="pwErrors.current">
          <input id="current" v-model="pw.current" type="password" class="erp-input" autocomplete="current-password" maxlength="200" />
        </FormField>
        <FormField label="New password" for="next" :error="pwErrors.next">
          <input id="next" v-model="pw.next" type="password" class="erp-input" autocomplete="new-password" maxlength="200" />
        </FormField>
        <FormField label="New password again" for="again" :error="pwErrors.again">
          <input id="again" v-model="pw.again" type="password" class="erp-input" autocomplete="new-password" maxlength="200" />
        </FormField>
      </div>
      <div class="flex items-center justify-between gap-4">
        <span class="text-xs text-erp-muted">{{ account.password.hint }}</span>
        <button type="submit" class="erp-btn erp-btn-primary" :disabled="pwBusy || !pw.current || !pw.next || !pw.again">{{ pwBusy ? 'Changing…' : 'Change password' }}</button>
      </div>
    </form>

    <!-- Two-factor -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <h2 class="m-0 text-[15px] font-bold">Two-factor sign-in</h2>

      <div v-if="tfStep === 'idle'" class="flex items-center justify-between gap-4">
        <span class="text-[13px] text-erp-muted">{{ twoFactorText }}</span>
        <div class="flex shrink-0 gap-2">
          <button v-if="!account.twoFactor.enabled" type="button" class="erp-btn erp-btn-secondary" :disabled="tfBusy" @click="startSetup">Set up two-factor</button>
          <template v-else>
            <button type="button" class="erp-btn erp-btn-secondary" @click="resetTwoFactorForm('renew')">New recovery codes</button>
            <button v-if="!account.twoFactor.required" type="button" class="erp-btn erp-btn-danger" @click="resetTwoFactorForm('off')">Turn off</button>
          </template>
        </div>
      </div>
      <NoticeBanner v-if="tfStep === 'idle' && tfError" kind="error">{{ tfError }}</NoticeBanner>

      <!-- Set-up, as on CfgTwoFactor.html -->
      <form v-if="tfStep === 'setup' && setup" class="flex flex-col gap-4" novalidate @submit.prevent="enable">
        <div class="grid grid-cols-[170px_minmax(0,1fr)] items-start gap-5 max-sm:grid-cols-1">
          <div class="flex h-[170px] w-[170px] items-center justify-center rounded-[10px] border border-erp-border bg-erp-card">
            <img :src="setup.qr" alt="QR code to scan with the authenticator app" width="150" height="150" />
          </div>
          <ol class="m-0 flex list-decimal flex-col gap-2.5 pl-5 text-[13px] leading-relaxed">
            <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator …).</li>
            <li>
              Scan the code, or type this key:
              <code class="mt-1.5 block w-fit rounded border border-erp-border bg-erp-bg px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide select-all">{{ setup.key }}</code>
            </li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
        </div>
        <div class="grid grid-cols-3 gap-x-[18px] max-md:grid-cols-1">
          <FormField label="Code from the app" for="tfCode" :error="tfError">
            <input id="tfCode" v-model="tfCode" class="erp-input font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="7" />
          </FormField>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-xs text-erp-muted">Next you get 8 recovery codes. Keep them safe: each one signs you in once if you lose your phone.</span>
          <div class="flex shrink-0 gap-2">
            <button type="button" class="erp-btn erp-btn-secondary" @click="resetTwoFactorForm()">Cancel</button>
            <button type="submit" class="erp-btn erp-btn-primary" :disabled="tfBusy || !tfCode.trim()">Turn on two-factor</button>
          </div>
        </div>
      </form>

      <!-- New recovery codes, once -->
      <div v-if="tfStep === 'codes'" class="flex flex-col gap-3">
        <span class="text-[13px] text-erp-muted">Keep these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They are not shown again.</span>
        <RecoveryCodes :codes="freshCodes" :name="account.me.code" />
        <div class="flex justify-end">
          <button type="button" class="erp-btn erp-btn-primary" @click="(freshCodes = []), resetTwoFactorForm()">I have kept them</button>
        </div>
      </div>

      <!-- Turn off, or new codes: the password says it is really you -->
      <form v-if="tfStep === 'off' || tfStep === 'renew'" class="flex flex-col gap-3" novalidate @submit.prevent="tfStep === 'off' ? disable() : renew()">
        <span class="text-[13px] text-erp-muted">
          {{ tfStep === 'off' ? 'Type your password to turn two-factor off. Sign-in then asks only for your password.' : 'Type your password to make 8 new recovery codes. The old ones stop working.' }}
        </span>
        <div class="grid grid-cols-3 gap-x-[18px] max-md:grid-cols-1">
          <FormField label="Password" for="tfPassword" :error="tfError">
            <input id="tfPassword" v-model="tfPassword" type="password" class="erp-input" autocomplete="current-password" maxlength="200" />
          </FormField>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="erp-btn erp-btn-secondary" @click="resetTwoFactorForm()">Cancel</button>
          <button type="submit" class="erp-btn" :class="tfStep === 'off' ? 'erp-btn-danger' : 'erp-btn-primary'" :disabled="tfBusy || !tfPassword">
            {{ tfStep === 'off' ? 'Turn off two-factor' : 'Make new codes' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Devices -->
    <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-bold">Where you are signed in</h2>
        <button type="button" class="erp-btn erp-btn-secondary" :disabled="!others" @click="endOthers">Sign out everywhere else</button>
      </div>
      <table v-if="account.sessions.length" class="erp-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Place</th>
            <th>Last active</th>
            <th class="w-[120px]"><span class="sr-only">Sign out</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in account.sessions" :key="s.id">
            <td>
              <div class="flex items-center gap-2.5">
                <component :is="phone(s.device) ? Smartphone : Monitor" :size="15" class="shrink-0 text-erp-muted" aria-hidden="true" />
                <div class="flex flex-col">
                  <span class="font-semibold">{{ s.device }}</span>
                  <span v-if="s.current" class="text-xs text-erp-muted">This device</span>
                </div>
              </div>
            </td>
            <td>{{ s.ipAddress?.replace(/^::ffff:/, '') ?? '—' }}</td>
            <td class="whitespace-nowrap">{{ s.current ? 'Now' : formatDateTime(s.lastActivityAt) }}</td>
            <td>
              <span v-if="s.current" class="text-erp-muted">—</span>
              <button v-else type="button" class="erp-btn erp-btn-secondary h-8" @click="endSession(s.id)">Sign out</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="m-0 text-[13px] text-erp-muted">
        {{ session.isJwt.value ? 'No devices.' : 'No devices: with the user switcher nobody signs in, so there are no sessions.' }}
      </p>
      <span class="text-xs text-erp-muted">A device stays signed in for {{ account.refreshDays }} days, or until {{ account.idleMinutes }} minutes without activity.</span>
    </section>
  </div>
</template>
