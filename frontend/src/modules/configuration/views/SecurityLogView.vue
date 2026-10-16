<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import { downloadFile } from '@/api/http'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useListPage } from '@/composables/useListPage'
import { formatDateTime } from '@/utils/format'
import { configLogsApi } from '../api/config'
import type { SecurityEventRow } from '../types'
import { PERIOD_OPTIONS } from './logs'

/** A12 · Security log (CfgSecurityLog.html): read only, newest first. */
const list = useListPage({ filterKeys: ['kind', 'user', 'period'], fetch: configLogsApi.securityEvents })
const rows = computed(() => list.data.value?.items ?? [])
const filters = computed(() => list.data.value?.filters)
const period = computed(() => list.params.value.period || 'week')

const search = ref(list.params.value.q)
watch(() => list.params.value.q, (q) => (search.value = q))
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('q', value.trim()), 300)
}

function exportCsv() {
  const { q, kind, user } = list.params.value
  void downloadFile('/config/security-events/export', { q, kind, user, period: period.value }, 'security-log.csv')
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader
      title="Security log"
      subtitle="Sign-ins, failures, lockouts, password and two-factor changes, and every change to a role or a user's roles. Kept for at least a year; nobody can change or delete it."
    >
      <template #actions>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search person or detail" aria-label="Search person or detail" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Event" :value="list.params.value.kind" @change="list.setFilter('kind', ($event.target as HTMLSelectElement).value)">
        <option value="">Event: all</option>
        <option v-for="k in filters?.kinds ?? []" :key="k.kind" :value="k.kind">{{ k.label }}</option>
      </select>
      <select class="erp-input" aria-label="Person" :value="list.params.value.user" @change="list.setFilter('user', ($event.target as HTMLSelectElement).value)">
        <option value="">Person: all</option>
        <option v-for="p in filters?.people ?? []" :key="p.code" :value="p.code">{{ p.name }}</option>
      </select>
      <select class="erp-input" aria-label="Period" :value="period" @change="list.setFilter('period', ($event.target as HTMLSelectElement).value)">
        <option v-for="p in PERIOD_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="Nothing in the security log for these filters.">
      <Column header="When">
        <template #body="{ data }: { data: SecurityEventRow }"><span class="whitespace-nowrap">{{ formatDateTime(data.at) }}</span></template>
      </Column>
      <Column header="Event">
        <template #body="{ data }: { data: SecurityEventRow }"><StatusChip :status="data.kind" :label="data.label" :group="data.group" /></template>
      </Column>
      <Column header="Who">
        <template #body="{ data }: { data: SecurityEventRow }">
          <div class="whitespace-nowrap">{{ data.who }}</div>
          <div v-if="data.by" class="text-xs whitespace-nowrap text-erp-muted">by {{ data.by }}</div>
        </template>
      </Column>
      <Column header="Detail" field="detail" />
      <Column header="Branch">
        <template #body="{ data }: { data: SecurityEventRow }"><span :class="{ 'text-erp-muted': !data.branchCode }">{{ data.branchCode ?? '—' }}</span></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
