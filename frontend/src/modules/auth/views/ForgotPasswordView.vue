<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiError } from '@/api/http'
import { authApi } from '@/api/session'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'
import AuthShell from '../AuthShell.vue'

/** Forgot password (FR-SEC-063): a single-use link by email. The answer is the same whether or not the account exists. */
const session = useSession()
const tenantName = computed(() => session.state.tenantName || 'CLB Groups')

const identifier = ref('')
const sent = ref('')
const problem = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  problem.value = ''
  try {
    sent.value = (await authApi.forgot(identifier.value.trim())).message
  } catch (error) {
    problem.value = error instanceof ApiError ? error.message : 'Cannot reach the server. Try again in a moment.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell>
    <div>
      <h1 class="m-0 text-xl font-bold">Forgot password</h1>
      <p class="mt-1 mb-0 text-[13px] text-erp-muted">{{ tenantName }} · Zora Pro ERP</p>
    </div>
    <template v-if="sent">
      <NoticeBanner kind="info">{{ sent }}</NoticeBanner>
      <p class="m-0 text-xs leading-relaxed text-erp-muted">
        The link works once. Until real email is connected, the email is kept in the email log, where the Administrator can see it on
        your user page.
      </p>
    </template>
    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <NoticeBanner v-if="problem" kind="error">{{ problem }}</NoticeBanner>
      <p class="m-0 text-[13px] leading-relaxed text-erp-muted">Type the email or user code you sign in with. We send a link to choose a new password.</p>
      <FormField label="Email or user code" for="identifier">
        <input id="identifier" v-model="identifier" class="erp-input" autocomplete="username" autofocus maxlength="150" />
      </FormField>
      <button type="submit" class="erp-btn erp-btn-primary h-9 justify-center" :disabled="busy || !identifier.trim()">{{ busy ? 'Sending…' : 'Send reset link' }}</button>
    </form>
    <RouterLink to="/sign-in" class="erp-link text-[13px] font-semibold">‹ Back to sign in</RouterLink>
  </AuthShell>
</template>
