<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'
import AuthShell from '../AuthShell.vue'
import RecoveryCodes from '../RecoveryCodes.vue'

/**
 * A03 · Two-factor (CfgTwoFactor.html), after a correct password: set-up when a role requires it and it is not set up
 * yet (scan, type a code, keep the recovery codes), otherwise the code from the app or a recovery code.
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const session = useSession()

const code = ref('')
const useRecovery = ref(false)
const problem = ref('')
const busy = ref(false)

const pending = computed(() => session.state.twoFactor)
const codes = computed(() => session.state.recoveryCodes)
const next = computed(() => (typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('/sign-in') ? route.query.next : '/'))

onMounted(() => {
  if (codes.value.length || pending.value) return
  // Nothing to do here: signed in already, or the page was reloaded and the ticket is gone.
  void router.replace(session.state.me && !session.state.signedOut ? next.value : { path: '/sign-in', query: route.query })
})

async function submit() {
  busy.value = true
  problem.value = ''
  try {
    if (pending.value?.stage === 'setup') {
      await session.completeTwoFactorSetup(code.value)
      return // the recovery codes show next
    }
    const left = await session.verifyTwoFactor(code.value)
    if (left !== undefined) {
      toast.add({ severity: 'warn', summary: 'Signed in with a recovery code', detail: `${left} left. Make new ones in My account.`, life: 8000 })
    }
    await router.replace(next.value)
  } catch (error) {
    code.value = ''
    if (error instanceof ApiError && error.status === 401 && error.body.code !== 'WRONG_CODE') {
      // The ticket ran out (10 minutes) or the account was locked: start again with the password.
      session.cancelTwoFactor()
      await router.replace({ path: '/sign-in', query: route.query })
      return
    }
    problem.value = error instanceof ApiError ? error.message : 'Cannot reach the server. Try again in a moment.'
  } finally {
    busy.value = false
  }
}

function done() {
  session.clearRecoveryCodes()
  void router.replace(next.value)
}

function back() {
  session.cancelTwoFactor()
  void router.replace({ path: '/sign-in', query: route.query })
}
</script>

<template>
  <!-- After set-up: the recovery codes, once -->
  <AuthShell v-if="codes.length" width="wide">
    <div>
      <h1 class="m-0 text-xl font-bold">Two-factor is on</h1>
      <p class="mt-1 mb-0 text-[13px] leading-relaxed text-erp-muted">
        Keep these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They are not shown again.
      </p>
    </div>
    <RecoveryCodes :codes="codes" :name="session.user.value?.code ?? 'zora'" />
    <button type="button" class="erp-btn erp-btn-primary h-9 justify-center" @click="done">I have kept them · continue</button>
  </AuthShell>

  <!-- Set-up -->
  <AuthShell v-else-if="pending?.stage === 'setup' && pending.setup" width="wide">
    <div>
      <h1 class="m-0 text-xl font-bold">Set up two-factor sign-in</h1>
      <p class="mt-1 mb-0 text-[13px] leading-snug text-erp-muted">{{ pending.reason }}</p>
    </div>
    <NoticeBanner v-if="pending.demoBypassCode" kind="warning">
      Demo Administrator: enter {{ pending.demoBypassCode }} below to continue without scanning. Other users must scan the code with an authenticator app.
    </NoticeBanner>
    <div class="grid grid-cols-[170px_minmax(0,1fr)] items-start gap-5 max-sm:grid-cols-1">
      <div class="flex h-[170px] w-[170px] items-center justify-center rounded-[10px] border border-erp-border bg-erp-card">
        <img :src="pending.setup.qr" alt="QR code to scan with the authenticator app" width="150" height="150" />
      </div>
      <ol class="m-0 flex list-decimal flex-col gap-2.5 pl-5 text-[13px] leading-relaxed">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator …).</li>
        <li>
          Scan the code, or type this key:
          <code class="mt-1.5 block w-fit rounded border border-erp-border bg-erp-bg px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide select-all">{{ pending.setup.key }}</code>
        </li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
    </div>
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <NoticeBanner v-if="problem" kind="error">{{ problem }}</NoticeBanner>
      <FormField :label="pending.demoBypassCode ? 'Code from the app, or demo code' : 'Code from the app'" for="code">
        <input id="code" v-model="code" class="erp-input font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus />
      </FormField>
      <button type="submit" class="erp-btn erp-btn-primary h-9 justify-center" :disabled="busy || !code.trim()">{{ busy ? 'Checking…' : 'Turn on two-factor' }}</button>
    </form>
    <p class="m-0 text-xs leading-relaxed text-erp-muted">
      Next you get 8 recovery codes. Keep them safe: each one signs you in once if you lose your phone. The Administrator can also reset your two-factor.
    </p>
  </AuthShell>

  <!-- The code at each sign-in -->
  <AuthShell v-else-if="pending">
    <div>
      <h1 class="m-0 text-xl font-bold">Two-factor sign-in</h1>
      <p class="mt-1 mb-0 text-[13px] text-erp-muted">
        {{ useRecovery ? 'Type one of your recovery codes. Each one works once.' : 'Type the 6-digit code your authenticator app shows for Zora Pro ERP.' }}
      </p>
    </div>
    <NoticeBanner v-if="pending.demoBypassCode && !useRecovery" kind="warning">
      Demo Administrator: {{ pending.demoBypassCode }} is accepted here without an authenticator app.
    </NoticeBanner>
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <NoticeBanner v-if="problem" kind="error">{{ problem }}</NoticeBanner>
      <FormField v-if="!useRecovery" :label="pending.demoBypassCode ? 'Code from the app, or demo code' : 'Code from the app'" for="code">
        <input id="code" v-model="code" class="erp-input font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus />
      </FormField>
      <FormField v-else label="Recovery code" for="recovery">
        <input id="recovery" v-model="code" class="erp-input font-mono uppercase tracking-wider" autocomplete="off" maxlength="12" placeholder="ABCD-EFGH" autofocus />
      </FormField>
      <button type="submit" class="erp-btn erp-btn-primary h-9 justify-center" :disabled="busy || !code.trim()">{{ busy ? 'Checking…' : 'Sign in' }}</button>
    </form>
    <div class="flex items-center justify-between gap-3 text-[13px]">
      <button type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold" @click="(useRecovery = !useRecovery), (code = ''), (problem = '')">
        {{ useRecovery ? 'Use the code from the app' : 'Lost your phone? Use a recovery code' }}
      </button>
      <button type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold" @click="back">‹ Back to sign in</button>
    </div>
  </AuthShell>
</template>
