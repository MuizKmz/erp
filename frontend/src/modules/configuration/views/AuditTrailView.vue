<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import { downloadFile } from '@/api/http'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import { useListPage } from '@/composables/useListPage'
import { formatDateTime } from '@/utils/format'
import { configLogsApi } from '../api/config'
import type { AuditDetail, AuditRow } from '../types'
import { PERIOD_OPTIONS, recordLink } from './logs'

/** A13 · Audit trail (CfgAudit.html): every change in every module, read only. A row opens its before-and-after values. */
const list = useListPage({ filterKeys: ['module', 'user', 'period'], fetch: configLogsApi.audit })
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

const open = ref<AuditDetail | null>(null)
async function show(row: AuditRow) {
  open.value = open.value?.id === row.id ? null : await configLogsApi.change(row.id)
}
watch(() => list.params.value, () => (open.value = null))

function exportCsv() {
  const { q, module, user } = list.params.value
  void downloadFile('/config/audit/export', { q, module, user, period: period.value }, 'audit-trail.csv')
}
</script>

<template>
  <section class="erp-card flex flex-col gap-3 px-6 py-[18px]" :class="{ grow: !open }">
    <PageHeader title="Audit trail" subtitle="Every change in every module, with who made it and what changed. Read only; the Auditor role sees it too.">
      <template #actions>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </template>
    </PageHeader>

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search number or text" aria-label="Search number or text" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Module" :value="list.params.value.module" @change="list.setFilter('module', ($event.target as HTMLSelectElement).value)">
        <option value="">Module: all</option>
        <option v-for="m in filters?.modules ?? []" :key="m.key" :value="m.key">{{ m.label }}</option>
      </select>
      <select class="erp-input" aria-label="Person" :value="list.params.value.user" @change="list.setFilter('user', ($event.target as HTMLSelectElement).value)">
        <option value="">Person: all</option>
        <option v-for="p in filters?.people ?? []" :key="p.code" :value="p.code">{{ p.name }}</option>
      </select>
      <select class="erp-input" aria-label="Period" :value="period" @change="list.setFilter('period', ($event.target as HTMLSelectElement).value)">
        <option v-for="p in PERIOD_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No changes for these filters.">
      <Column header="When">
        <template #body="{ data }: { data: AuditRow }"><span class="whitespace-nowrap">{{ formatDateTime(data.at) }}</span></template>
      </Column>
      <Column header="Module" field="moduleLabel" />
      <Column header="Record">
        <template #body="{ data }: { data: AuditRow }">
          <RouterLink v-if="recordLink(data)" :to="recordLink(data)!" class="erp-link font-semibold whitespace-nowrap">{{ data.record }}</RouterLink>
          <span v-else class="font-semibold whitespace-nowrap">{{ data.record }}</span>
        </template>
      </Column>
      <Column header="What happened">
        <template #body="{ data }: { data: AuditRow }">
          <button
            v-if="data.hasChanges"
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-erp-text hover:underline"
            :aria-expanded="open?.id === data.id"
            @click="show(data)"
          >
            {{ data.message }}
          </button>
          <span v-else>{{ data.message }}</span>
          <div v-if="data.comment" class="text-xs text-erp-muted">“{{ data.comment }}”</div>
        </template>
      </Column>
      <Column header="Who">
        <template #body="{ data }: { data: AuditRow }"><span class="whitespace-nowrap">{{ data.who }}</span></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between gap-3 pt-2">
      <span class="text-xs text-erp-muted">Click a change with before-and-after values to see them.</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>

  <section v-if="open" class="erp-card flex flex-col gap-3 px-[18px] py-4">
    <h2 class="m-0 text-[15px] font-bold">Change {{ open.record }} · {{ formatDateTime(open.at) }}</h2>
    <table class="erp-table">
      <thead>
        <tr>
          <th>Field</th>
          <th class="text-right">Before</th>
          <th class="text-right">After</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in open.changes" :key="c.field">
          <td>{{ c.label }}</td>
          <td class="text-right" :class="{ 'text-erp-muted': c.from === null }">{{ c.from ?? '—' }}</td>
          <td class="text-right" :class="{ 'text-erp-muted': c.to === null }">{{ c.to ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
    <span class="text-xs text-erp-muted">
      {{ [open.who, open.jobTitle].filter(Boolean).join(' · ') }}
      <template v-if="open.request"> · request {{ open.request }} (every change one request made shares this number)</template>
    </span>
    <div v-if="open.sameRequest.length" class="flex flex-col gap-1 text-xs text-erp-muted">
      <span class="font-medium">Same request:</span>
      <span v-for="s in open.sameRequest" :key="s.id">{{ s.moduleLabel }} · {{ s.record }} · {{ s.message }}</span>
    </div>
  </section>
</template>
