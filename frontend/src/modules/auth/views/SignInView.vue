<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'
import AuthShell from '../AuthShell.vue'

/** A02 · Sign in (CfgSignIn.html): email or user code and password. Outside the module layout. */
const route = useRoute()
const router = useRouter()
const session = useSession()

const form = reactive({ identifier: '', password: '' })
const errors = ref<Record<string, string>>({})
const problem = ref('')
const busy = ref(false)

const tenantName = computed(() => session.state.tenantName || 'CLB Groups')
const rules = computed(() => session.state.info?.signIn ?? { lockoutAttempts: 5, lockoutMinutes: 15, refreshDays: 30, idleMinutes: 30 })
const next = computed(() => (typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('/sign-in') ? route.query.next : '/'))

async function submit() {
  busy.value = true
  errors.value = {}
  problem.value = ''
  try {
    const step = await session.signIn(form.identifier, form.password)
    // A role that needs two-factor: the code from the app (or setting it up) comes next.
    if (step === 'TWO_FACTOR') await router.push({ path: '/sign-in/two-factor', query: route.query })
    else await router.replace(next.value)
  } catch (error) {
    if (error instanceof ApiError) {
      errors.value = error.fieldErrors
      if (!error.body.errors?.length) problem.value = error.message
    } else problem.value = 'Cannot reach the server. Try again in a moment.'
    form.password = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell>
    <div>
      <h1 class="m-0 text-xl font-bold">Sign in</h1>
      <p class="mt-1 mb-0 text-[13px] text-erp-muted">{{ tenantName }} · Zora Pro ERP</p>
    </div>

    <template v-if="!session.isJwt.value">
      <NoticeBanner kind="info">Sign-in is off: this server runs with the dev user switcher (AUTH_MODE=dev).</NoticeBanner>
      <RouterLink to="/" class="erp-btn erp-btn-primary justify-center">Open the app</RouterLink>
    </template>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <NoticeBanner v-if="problem" kind="error">{{ problem }}</NoticeBanner>
      <NoticeBanner v-else-if="session.state.signedOutMessage" kind="info">{{ session.state.signedOutMessage }}</NoticeBanner>
      <FormField label="Email or user code" for="identifier" :error="errors.identifier">
        <input id="identifier" v-model="form.identifier" class="erp-input" autocomplete="username" autofocus maxlength="150" />
      </FormField>
      <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
        <span class="flex items-baseline justify-between gap-2">
          <label for="password">Password</label>
          <RouterLink to="/sign-in/forgot" class="erp-link text-xs font-semibold">Forgot password?</RouterLink>
        </span>
        <input id="password" v-model="form.password" type="password" class="erp-input" autocomplete="current-password" maxlength="200" />
        <span v-if="errors.password" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.password }}</span>
      </div>
      <button type="submit" class="erp-btn erp-btn-primary h-9 justify-center" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      <p class="m-0 text-xs leading-relaxed text-erp-muted">
        After {{ rules.lockoutAttempts }} wrong passwords the account waits {{ rules.lockoutMinutes }} minutes. You stay signed in on this device for
        {{ rules.refreshDays }} days unless you sign out or stay away for {{ rules.idleMinutes }} minutes.
      </p>
    </form>
  </AuthShell>
</template>
