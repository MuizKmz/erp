<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/http'
import { authApi, type LinkInfo } from '@/api/session'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import AuthShell from '../AuthShell.vue'

/** The emailed link (FR-SEC-063, 064): set a first password, or reset a forgotten one. It works once and runs out. */
const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const link = ref<LinkInfo | null>(null)
const gone = ref('')
const loading = ref(true)
const form = reactive({ password: '', again: '' })
const errors = ref<Record<string, string>>({})
const problem = ref('')
const busy = ref(false)
const done = ref(false)

const isSet = computed(() => link.value?.kind === 'SET_PASSWORD')
const hint = computed(() => (link.value ? `At least ${link.value.passwordMinLength} characters.${link.value.refuseCommonPasswords ? ' Common passwords are refused.' : ''}` : ''))

onMounted(async () => {
  try {
    if (!token.value) throw new ApiError(410, { code: 'LINK_GONE', message: 'This link is not complete. Open it again from the email.' })
    link.value = await authApi.link(token.value)
  } catch (error) {
    gone.value = error instanceof ApiError ? error.message : 'Cannot reach the server. Try again in a moment.'
  } finally {
    loading.value = false
  }
})

async function submit() {
  errors.value = {}
  problem.value = ''
  if (form.password !== form.again) {
    errors.value = { again: 'The two passwords are not the same.' }
    return
  }
  busy.value = true
  try {
    await authApi.reset(token.value, form.password)
    done.value = true
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) gone.value = error.message
    else if (error instanceof ApiError && error.body.errors?.length) errors.value = { password: error.fieldErrors.newPassword ?? error.message }
    else problem.value = error instanceof ApiError ? error.message : 'Cannot reach the server. Try again in a moment.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell>
    <p v-if="loading" class="m-0 text-[13px] text-erp-muted">Checking the link…</p>

    <template v-else-if="gone">
      <h1 class="m-0 text-xl font-bold">Password link</h1>
      <NoticeBanner kind="warning">{{ gone }}</NoticeBanner>
      <RouterLink to="/sign-in/forgot" class="erp-btn erp-btn-primary h-9 justify-center">Ask for a new link</RouterLink>
      <RouterLink to="/sign-in" class="erp-link text-[13px] font-semibold">‹ Back to sign in</RouterLink>
    </template>

    <template v-else-if="done">
      <h1 class="m-0 text-xl font-bold">{{ isSet ? 'Your password is set' : 'Your password is changed' }}</h1>
      <p class="m-0 text-[13px] leading-relaxed text-erp-muted">
        Sign in with {{ link?.user.email }} or {{ link?.user.code }} and your new password.{{ isSet ? '' : ' Every device that was signed in has been signed out.' }}
      </p>
      <RouterLink to="/sign-in" class="erp-btn erp-btn-primary h-9 justify-center">Sign in</RouterLink>
    </template>

    <template v-else-if="link">
      <div>
        <h1 class="m-0 text-xl font-bold">{{ isSet ? 'Set your password' : 'Reset your password' }}</h1>
        <p class="mt-1 mb-0 text-[13px] text-erp-muted">{{ link.user.name }} · {{ link.user.email }}</p>
      </div>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <NoticeBanner v-if="problem" kind="error">{{ problem }}</NoticeBanner>
        <input type="text" class="hidden" autocomplete="username" :value="link.user.email" readonly aria-hidden="true" tabindex="-1" />
        <FormField label="New password" for="password" :error="errors.password">
          <input id="password" v-model="form.password" type="password" class="erp-input" autocomplete="new-password" maxlength="200" autofocus />
        </FormField>
        <FormField label="New password again" for="again" :error="errors.again">
          <input id="again" v-model="form.again" type="password" class="erp-input" autocomplete="new-password" maxlength="200" />
        </FormField>
        <span class="text-xs text-erp-muted">{{ hint }}</span>
        <button type="submit" class="erp-btn erp-btn-primary h-9 justify-center" :disabled="busy || !form.password || !form.again">
          {{ busy ? 'Saving…' : isSet ? 'Set password' : 'Reset password' }}
        </button>
      </form>
    </template>
  </AuthShell>
</template>
