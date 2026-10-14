<script setup lang="ts">
import { computed } from 'vue'
import Column from 'primevue/column'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { corePriceListsApi } from '../api/core'
import type { PriceListListItem } from '../types'
import { PRICE_LIST_STATUS_GROUP } from './priceLists'

/** C08 · List of Price Lists (CorePriceLists.html) */
const { can, today } = useSession()
const list = useListPage({ filterKeys: [], fetch: corePriceListsApi.list })
const rows = computed(() => list.data.value?.items ?? [])
const paged = computed(() => (list.data.value?.total ?? 0) > (list.data.value?.pageSize ?? Infinity))

async function exportCsv() {
  const all: PriceListListItem[] = []
  for (let page = 1; ; page++) {
    const result = await corePriceListsApi.list({ page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Code', 'Name', 'Currency', 'Prices', 'Tax', 'Valid from', 'Valid to', 'Used by', 'Status'].map(cell).join(','),
    ...all.map((l) => [l.code, l.name, l.currency, String(l.prices), l.taxText, l.validFrom, l.validTo ?? '', l.usedBy, l.statusLabel].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `price-lists-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Price Lists" subtitle="What Sales charges. Each customer has one price list; prices exclude tax unless the list says otherwise." />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('core.price_list.edit')" to="/core/price-lists/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new price list</RouterLink>
      </div>
      <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
    </div>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No price lists yet.">
      <Column header="Code">
        <template #body="{ data }: { data: PriceListListItem }">
          <RouterLink :to="`/core/price-lists/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.code }}</RouterLink>
        </template>
      </Column>
      <Column header="Name" field="name" />
      <Column header="Currency" field="currency" />
      <Column header="Prices" class="erp-col-num">
        <template #body="{ data }: { data: PriceListListItem }">{{ data.prices }}</template>
      </Column>
      <Column header="Tax" field="taxText" />
      <Column header="Valid from">
        <template #body="{ data }: { data: PriceListListItem }"><span class="whitespace-nowrap">{{ formatDate(data.validFrom) }}</span></template>
      </Column>
      <Column header="Valid to">
        <template #body="{ data }: { data: PriceListListItem }"><span class="whitespace-nowrap">{{ data.validTo ? formatDate(data.validTo) : 'No end' }}</span></template>
      </Column>
      <Column header="Used by" field="usedBy" />
      <Column header="Status">
        <template #body="{ data }: { data: PriceListListItem }"><StatusChip :status="data.status" :label="data.statusLabel" :group="PRICE_LIST_STATUS_GROUP[data.status]" /></template>
      </Column>
    </DataList>

    <div v-if="paged" class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
