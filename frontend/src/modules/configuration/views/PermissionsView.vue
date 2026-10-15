<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check } from '@lucide/vue'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import { configPermissionsApi, configRolesApi, configUsersApi } from '../api/config'
import type { PersonPermissions, RoleComparison, RoleListItem, UserListItem } from '../types'

/**
 * A10 · Who can do what (CfgPermissions.html): a person's permissions from all their roles, or two roles side by side.
 * Read only. State in the URL: ?tab=person&user=AR or ?tab=compare&a=SALES_AGENT&b=SALES_MANAGER&show=all.
 */
const route = useRoute()
const router = useRouter()

const users = ref<UserListItem[]>([])
const roles = ref<RoleListItem[]>([])
const person = ref<PersonPermissions | null>(null)
const comparison = ref<RoleComparison | null>(null)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const tab = computed(() => (q('tab') === 'compare' ? 'compare' : 'person'))
const userCode = computed(() => q('user'))
const roleA = computed(() => q('a') || 'SALES_AGENT')
const roleB = computed(() => q('b') || 'SALES_MANAGER')
const showAll = computed(() => q('show') === 'all')
const setQuery = (patch: Record<string, string | undefined>) => router.replace({ query: { ...route.query, ...patch } })

onMounted(async () => {
  const [u, r] = await Promise.all([configUsersApi.list({ page: 1, pageSize: 100 }), configRolesApi.list()])
  users.value = u.items
  roles.value = r.items
  await load()
})

async function load() {
  if (tab.value === 'person') {
    const user = users.value.find((u) => u.code === userCode.value)
    person.value = user ? await configPermissionsApi.person(user.id) : null
  } else if (roles.value.some((r) => r.code === roleA.value) && roles.value.some((r) => r.code === roleB.value)) {
    comparison.value = await configPermissionsApi.compare(roleA.value, roleB.value)
  }
}
watch(() => `${tab.value}|${userCode.value}|${roleA.value}|${roleB.value}`, load)

const comparedRows = computed(() => (comparison.value?.rows ?? []).filter((r) => showAll.value || r.a !== r.b))
const TABS = [
  { key: 'person', label: 'A person' },
  { key: 'compare', label: 'Compare two roles' },
] as const
</script>

<template>
  <section class="erp-card flex grow flex-col gap-4 px-6 py-[18px]">
    <PageHeader title="Who can do what" subtitle="What a person can do from all their roles, or how two roles differ. Read only: change permissions on the role." />

    <div class="flex gap-6 border-b border-erp-border" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        class="-mb-px border-0 border-b-2 border-solid bg-transparent px-0 pb-2.5 font-[inherit] text-[13px] font-semibold whitespace-nowrap"
        :class="tab === t.key ? 'border-mod-line text-mod-accent' : 'border-transparent text-erp-muted hover:text-erp-text'"
        @click="setQuery({ tab: t.key })"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- A person -->
    <template v-if="tab === 'person'">
      <div class="grid grid-cols-3 gap-x-[18px]">
        <FormField label="Person" for="user">
          <select id="user" class="erp-input" :value="userCode" @change="setQuery({ user: ($event.target as HTMLSelectElement).value })">
            <option value="" disabled>Pick a person</option>
            <option v-for="u in users" :key="u.code" :value="u.code">{{ u.code }} · {{ u.name }}</option>
          </select>
        </FormField>
      </div>
      <p v-if="!person" class="m-0 text-[13px] text-erp-muted">Pick a person to see everything they can do, and which of their roles gives it.</p>
      <template v-else>
        <NoticeBanner kind="info">
          {{ person.text }}
          <template v-if="person.roles.some((r) => !r.counts)"> Roles that have ended or not started yet give nothing today: {{ person.roles.filter((r) => !r.counts).map((r) => r.name).join(', ') }}.</template>
        </NoticeBanner>
        <table class="erp-table">
          <thead>
            <tr><th>Module</th><th>What</th><th>Action</th><th>Permission</th><th>From</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in person.rows" :key="r.key">
              <td>{{ r.module }}</td>
              <td>{{ r.object }}</td>
              <td>{{ r.action }}</td>
              <td><span class="font-mono text-xs text-erp-muted">{{ r.key }}</span></td>
              <td>{{ r.roles.join(', ') }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <!-- Compare two roles -->
    <template v-else>
      <div class="grid grid-cols-3 gap-x-[18px]">
        <FormField label="Role" for="roleA">
          <select id="roleA" class="erp-input" :value="roleA" @change="setQuery({ a: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }}</option>
          </select>
        </FormField>
        <FormField label="Compared with" for="roleB">
          <select id="roleB" class="erp-input" :value="roleB" @change="setQuery({ b: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }}</option>
          </select>
        </FormField>
        <FormField label="Show" for="show">
          <select id="show" class="erp-input" :value="showAll ? 'all' : 'diff'" @change="setQuery({ show: ($event.target as HTMLSelectElement).value === 'all' ? 'all' : undefined })">
            <option value="diff">Only the differences</option>
            <option value="all">Everything either role gives</option>
          </select>
        </FormField>
      </div>
      <template v-if="comparison">
        <NoticeBanner kind="info">{{ comparison.text }}</NoticeBanner>
        <p v-if="!comparedRows.length" class="m-0 text-[13px] text-erp-muted">The two roles give exactly the same permissions.</p>
        <table v-else class="erp-table">
          <thead>
            <tr><th>Module</th><th>What</th><th>Action</th><th>Permission</th><th>{{ comparison.a.name }}</th><th>{{ comparison.b.name }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in comparedRows" :key="r.key">
              <td>{{ r.module }}</td>
              <td>{{ r.object }}</td>
              <td>{{ r.action }}</td>
              <td><span class="font-mono text-xs text-erp-muted">{{ r.key }}</span></td>
              <td>
                <Check v-if="r.a" :size="14" :stroke-width="3" class="text-chip-done-text" :aria-label="`${comparison.a.name} has it`" /><span v-else class="text-erp-muted">—</span>
              </td>
              <td>
                <Check v-if="r.b" :size="14" :stroke-width="3" class="text-chip-done-text" :aria-label="`${comparison.b.name} has it`" /><span v-else class="text-erp-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>
