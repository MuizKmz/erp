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
import { coreSuppliersApi } from '../api/core'
import type { SupplierListItem } from '../types'
import { SUPPLIER_STATUS_GROUP } from './suppliers'

/** C06 · List of Suppliers (CoreSupplierList.html) */
const { can, today } = useSession()
const list = useListPage({ filterKeys: ['supplies', 'walkIn'], fetch: coreSuppliersApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'blocked', label: 'Blocked' },
]

const supplies = ref<string[]>([])
onMounted(async () => {
  supplies.value = (await coreSuppliersApi.supplies()).items
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
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} suppliers`
})

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: SupplierListItem[] = []
  for (let page = 1; ; page++) {
    const result = await coreSuppliersApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Code', 'Name', 'Short name', 'Supplies', 'Walk-in shop', 'TIN', 'Sales tax no', 'Payment term', 'Email', 'Status'].map(cell).join(','),
    ...all.map((s) =>
      [s.code, s.name, s.shortName ?? '', s.category ?? '', s.isWalkIn ? 'Yes' : 'No', s.tin ?? '', s.sstNo ?? '', s.paymentTerm, s.email ?? '', s.statusLabel].map(cell).join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `suppliers-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Suppliers" subtitle="Who Purchase buys from. Only active suppliers can be picked on a purchase order." />

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search code, name or TIN" aria-label="Search code, name or TIN" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Supplies" :value="list.params.value.supplies" @change="list.setFilter('supplies', ($event.target as HTMLSelectElement).value)">
        <option value="">Supplies: all</option>
        <option v-for="s in supplies" :key="s" :value="s">{{ s }}</option>
      </select>
      <select class="erp-input" aria-label="Walk-in shops" :value="list.params.value.walkIn" @change="list.setFilter('walkIn', ($event.target as HTMLSelectElement).value)">
        <option value="">Walk-in shops: shown</option>
        <option value="hidden">Walk-in shops: hidden</option>
        <option value="only">Walk-in shops only</option>
      </select>
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('core.supplier.edit')" to="/core/suppliers/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new supplier</RouterLink>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/core/import" class="erp-btn erp-btn-import">Import</RouterLink>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </div>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No suppliers match these filters.">
      <Column header="Code">
        <template #body="{ data }: { data: SupplierListItem }">
          <RouterLink :to="`/core/suppliers/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.code }}</RouterLink>
        </template>
      </Column>
      <Column header="Name">
        <template #body="{ data }: { data: SupplierListItem }">
          {{ data.name }}
          <StatusChip v-if="data.isWalkIn" status="WALK_IN" label="Walk-in shop" group="draft" class="ml-1" />
        </template>
      </Column>
      <Column header="Supplies">
        <template #body="{ data }: { data: SupplierListItem }">{{ data.category ?? '—' }}</template>
      </Column>
      <Column header="TIN">
        <template #body="{ data }: { data: SupplierListItem }">
          <span v-if="data.tin">{{ data.tin }}</span>
          <span v-else-if="data.isWalkIn" class="text-erp-muted">—</span>
          <span v-else class="text-attention">Missing</span>
        </template>
      </Column>
      <Column header="Sales tax no">
        <template #body="{ data }: { data: SupplierListItem }">{{ data.sstNo ?? '—' }}</template>
      </Column>
      <Column header="Payment term" field="paymentTerm" />
      <Column header="Email">
        <template #body="{ data }: { data: SupplierListItem }">{{ data.email ?? '—' }}</template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: SupplierListItem }"><StatusChip :status="data.status" :label="data.statusLabel" :group="SUPPLIER_STATUS_GROUP[data.status]" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
