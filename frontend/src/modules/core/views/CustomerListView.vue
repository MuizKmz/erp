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
import { formatMoney } from '@/utils/format'
import { coreCustomersApi, coreLookupsApi } from '../api/core'
import type { CustomerFormOptions, CustomerListItem } from '../types'
import { CUSTOMER_STATUS_GROUP } from './customers'

/** C04 · List of Customers (CoreCustomerList.html) */
const { can, today } = useSession()
const list = useListPage({ filterKeys: ['branch', 'category', 'agent'], fetch: coreCustomersApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'blocked', label: 'Blocked' },
]

const options = ref<CustomerFormOptions | null>(null)
onMounted(async () => {
  options.value = await coreLookupsApi.customerForm()
})

const search = ref(list.params.value.q)
watch(() => list.params.value.q, (q) => (search.value = q))
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('q', value.trim()), 300)
}

const limit = (v: string | null) => (v === null ? 'No limit' : formatMoney(v))
const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} customers`
})

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: CustomerListItem[] = []
  for (let page = 1; ; page++) {
    const result = await coreCustomersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Code', 'Name', 'Category', 'Area', 'Branch', 'Sales agent', 'Price list', 'Credit term', 'Credit limit (RM)', 'Overdue limit (RM)', 'TIN', 'Status'].map(cell).join(','),
    ...all.map((c) =>
      [c.code, c.name, c.category ?? '', c.area ?? '', c.branchCode, c.agentName ?? '', c.priceListName, c.creditTerm, c.creditLimit ?? '', c.overdueLimit ?? '', c.tin ?? '', c.statusLabel].map(cell).join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `customers-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Customers" subtitle="Who Sales sells to. A prospect from an enquiry becomes a customer here before it can be quoted." />

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search code, name or TIN" aria-label="Search code, name or TIN" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Branch" :value="list.params.value.branch" @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)">
        <option value="">Branch: all</option>
        <option v-for="b in options?.branches ?? []" :key="b.code" :value="b.code">{{ b.name }}</option>
      </select>
      <select class="erp-input" aria-label="Category" :value="list.params.value.category" @change="list.setFilter('category', ($event.target as HTMLSelectElement).value)">
        <option value="">Category: all</option>
        <option v-for="c in options?.categories ?? []" :key="c" :value="c">{{ c }}</option>
      </select>
      <select class="erp-input" aria-label="Sales agent" :value="list.params.value.agent" @change="list.setFilter('agent', ($event.target as HTMLSelectElement).value)">
        <option value="">Sales agent: all</option>
        <option v-for="a in options?.agents ?? []" :key="a.code" :value="a.code">{{ a.name }}</option>
      </select>
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('core.customer.edit')" to="/core/customers/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new customer</RouterLink>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/core/import" class="erp-btn erp-btn-import">Import</RouterLink>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </div>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No customers match these filters.">
      <Column header="Code">
        <template #body="{ data }: { data: CustomerListItem }">
          <RouterLink :to="`/core/customers/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.code }}</RouterLink>
        </template>
      </Column>
      <Column header="Name" field="name" />
      <Column header="Category · area">
        <template #body="{ data }: { data: CustomerListItem }">{{ data.category ?? '—' }}<template v-if="data.area"> · {{ data.area }}</template></template>
      </Column>
      <Column header="Branch" field="branchCode" />
      <Column header="Sales agent">
        <template #body="{ data }: { data: CustomerListItem }"><span v-if="data.agentName">{{ data.agentName }}</span><span v-else class="text-erp-muted">—</span></template>
      </Column>
      <Column header="Price list" field="priceListName" />
      <Column header="Credit term" field="creditTerm" />
      <Column header="Credit limit (RM)" class="erp-col-num">
        <template #body="{ data }: { data: CustomerListItem }"><span class="whitespace-nowrap">{{ limit(data.creditLimit) }}</span></template>
      </Column>
      <Column header="Overdue limit (RM)" class="erp-col-num">
        <template #body="{ data }: { data: CustomerListItem }"><span class="whitespace-nowrap">{{ limit(data.overdueLimit) }}</span></template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: CustomerListItem }"><StatusChip :status="data.status" :label="data.statusLabel" :group="CUSTOMER_STATUS_GROUP[data.status]" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
