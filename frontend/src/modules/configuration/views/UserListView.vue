<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Column from 'primevue/column'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDateTime } from '@/utils/format'
import { configUsersApi } from '../api/config'
import type { UserListItem, UserLookups } from '../types'

/** A06 · Users (CfgUserList.html) */
const { today } = useSession()
const list = useListPage({ filterKeys: ['role', 'branch', 'twoFactor'], fetch: configUsersApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'locked', label: 'Locked' },
  { key: 'inactive', label: 'Inactive' },
]
const STATUS_GROUP = { active: 'done', locked: 'pending', inactive: 'draft' } as const

const lookups = ref<UserLookups | null>(null)
onMounted(async () => {
  lookups.value = await configUsersApi.lookups()
})

const search = ref(list.params.value.q)
watch(() => list.params.value.q, (q) => (search.value = q))
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('q', value.trim()), 300)
}

const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} users`
})

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: UserListItem[] = []
  for (let page = 1; ; page++) {
    const result = await configUsersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Code', 'Name', 'Job title', 'Email', 'Roles', 'Branches', 'Two-factor', 'Last sign-in', 'Status'].map(cell).join(','),
    ...all.map((u) =>
      [u.code, u.name, u.jobTitle ?? '', u.email, u.roles.map((r) => r.name).join('; '), u.branches.join(', '), u.twoFactorText, u.lastSignInAt ? formatDateTime(u.lastSignInAt) : 'Never', u.statusLabel]
        .map(cell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `users-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="Users" subtitle="Who can sign in, with which roles and in which branches. A user code never changes." />

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search name, code or email" aria-label="Search name, code or email" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Role" :value="list.params.value.role" @change="list.setFilter('role', ($event.target as HTMLSelectElement).value)">
        <option value="">Role: all</option>
        <option v-for="r in lookups?.roles ?? []" :key="r.code" :value="r.code">{{ r.name }}</option>
      </select>
      <select class="erp-input" aria-label="Branch" :value="list.params.value.branch" @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)">
        <option value="">Branch: all</option>
        <option v-for="b in lookups?.branches ?? []" :key="b.code" :value="b.code">{{ b.code }} · {{ b.name }}</option>
      </select>
      <select class="erp-input" aria-label="Two-factor" :value="list.params.value.twoFactor" @change="list.setFilter('twoFactor', ($event.target as HTMLSelectElement).value)">
        <option value="">Two-factor: all</option>
        <option value="missing">Required · not set up</option>
        <option value="set">Set up</option>
        <option value="notRequired">Not required</option>
      </select>
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="lookups?.canEdit" to="/config/users/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new user</RouterLink>
      </div>
      <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No users match these filters.">
      <Column header="Code">
        <template #body="{ data }: { data: UserListItem }">
          <RouterLink :to="`/config/users/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.code }}</RouterLink>
        </template>
      </Column>
      <Column header="Name">
        <template #body="{ data }: { data: UserListItem }">
          <div class="whitespace-nowrap">{{ data.name }}</div>
          <div v-if="data.jobTitle" class="text-xs whitespace-nowrap text-erp-muted">{{ data.jobTitle }}</div>
        </template>
      </Column>
      <Column header="Email" field="email" />
      <Column header="Roles">
        <template #body="{ data }: { data: UserListItem }">
          <div class="flex flex-wrap gap-1.5">
            <span v-for="r in data.roles" :key="r.code" class="rounded-xl bg-chip-draft-bg px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap text-chip-draft-text">{{ r.name }}</span>
          </div>
        </template>
      </Column>
      <Column header="Branches">
        <template #body="{ data }: { data: UserListItem }"><span class="whitespace-nowrap">{{ data.branches.join(', ') }}</span></template>
      </Column>
      <Column header="Two-factor">
        <template #body="{ data }: { data: UserListItem }">
          <span class="whitespace-nowrap" :class="data.twoFactor === 'REQUIRED_MISSING' ? 'font-semibold text-note-warn-strong' : data.twoFactor === 'NOT_REQUIRED' ? 'text-erp-muted' : ''">{{ data.twoFactorText }}</span>
        </template>
      </Column>
      <Column header="Last sign-in">
        <template #body="{ data }: { data: UserListItem }">
          <span class="whitespace-nowrap" :class="{ 'text-erp-muted': !data.lastSignInAt }">{{ data.lastSignInAt ? formatDateTime(data.lastSignInAt) : 'Never' }}</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: UserListItem }"><StatusChip :status="data.status.toUpperCase()" :label="data.statusLabel" :group="STATUS_GROUP[data.status]" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
