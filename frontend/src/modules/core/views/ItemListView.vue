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
import { coreItemsApi, coreLookupsApi } from '../api/core'
import type { ItemListItem } from '../types'
import { ITEM_STATUS_GROUP, ITEM_TYPE_OPTIONS } from './items'

/** C02 · List of Items (CoreItemList.html) */
const { can, today } = useSession()
const list = useListPage({ filterKeys: ['group', 'type', 'use'], pageSize: 14, fetch: coreItemsApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'discontinued', label: 'Discontinued' },
]

const groups = ref<string[]>([])
onMounted(async () => {
  groups.value = (await coreLookupsApi.itemForm()).itemGroups
})

// Search as you type, a moment after the last key.
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
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} items`
})
const pages = computed(() => {
  const d = list.data.value
  return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1
})

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: ItemListItem[] = []
  for (let page = 1; ; page++) {
    const result = await coreItemsApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Item code', 'Name', 'Group', 'Type', 'Unit', 'Buy', 'Sell', 'Preferred supplier', 'Barcode', 'Status'].map(cell).join(','),
    ...all.map((i) =>
      [i.code, i.name, i.itemGroup, i.typeLabel, i.baseUom, i.isPurchasable ? 'Yes' : 'No', i.isSellable ? 'Yes' : 'No', i.preferredSupplier?.name ?? '', i.barcode ?? '', i.statusLabel].map(cell).join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `items-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Items" subtitle="Everything Purchase buys and Sales sells. A code never changes once it is saved." />

    <FilterBar>
      <input class="erp-input" type="search" placeholder="Search code, name or barcode" aria-label="Search code, name or barcode" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Item group" :value="list.params.value.group" @change="list.setFilter('group', ($event.target as HTMLSelectElement).value)">
        <option value="">Item group: all</option>
        <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
      </select>
      <select class="erp-input" aria-label="Type" :value="list.params.value.type" @change="list.setFilter('type', ($event.target as HTMLSelectElement).value)">
        <option value="">Type: all</option>
        <option v-for="t in ITEM_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <select class="erp-input" aria-label="Buy or sell" :value="list.params.value.use" @change="list.setFilter('use', ($event.target as HTMLSelectElement).value)">
        <option value="">Buy or sell: all</option>
        <option value="buy">Can be bought</option>
        <option value="sell">Can be sold</option>
        <option value="both">Bought and sold</option>
      </select>
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('core.item.edit')" to="/core/items/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new item</RouterLink>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/core/import" class="erp-btn erp-btn-import">Import</RouterLink>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </div>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No items match these filters.">
      <Column header="Item code">
        <template #body="{ data }: { data: ItemListItem }">
          <RouterLink :to="`/core/items/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.code }}</RouterLink>
        </template>
      </Column>
      <Column header="Name" field="name" />
      <Column header="Group" field="itemGroup" />
      <Column header="Type" field="typeLabel" />
      <Column header="Unit" field="baseUom" />
      <Column header="Buy">
        <template #body="{ data }: { data: ItemListItem }">
          <span v-if="data.isPurchasable" class="font-bold text-chip-done-text" aria-label="Yes">✓</span><span v-else class="text-erp-muted" aria-label="No">—</span>
        </template>
      </Column>
      <Column header="Sell">
        <template #body="{ data }: { data: ItemListItem }">
          <span v-if="data.isSellable" class="font-bold text-chip-done-text" aria-label="Yes">✓</span><span v-else class="text-erp-muted" aria-label="No">—</span>
        </template>
      </Column>
      <Column header="Preferred supplier">
        <template #body="{ data }: { data: ItemListItem }">
          <span v-if="data.preferredSupplier">{{ data.preferredSupplier.name }}</span><span v-else class="text-erp-muted">—</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: ItemListItem }"><StatusChip :status="data.status" :label="data.statusLabel" :group="ITEM_STATUS_GROUP[data.status]" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-between pt-2">
      <span class="text-xs text-erp-muted">{{ list.data.value ? `Page ${list.data.value.page} of ${pages}` : '' }}</span>
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
