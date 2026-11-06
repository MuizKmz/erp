<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import Pager from '@/components/erp/Pager.vue'
import { useListPage } from '@/composables/useListPage'
import { wmsApi } from '../api/wms'
import WmsPage from '../components/WmsPage.vue'
import type { LocationRow } from '../types'

/** W02 · Stock Location (WmsStockLocation.html) */
const list = useListPage({ filterKeys: ['warehouse', 'location', 'rack'], fetch: wmsApi.stockLocations })
const answer = computed(() => list.data.value)
const rows = computed(() => answer.value?.items ?? [])

const search = ref(list.params.value.q)
watch(() => list.params.value.q, (q) => (search.value = q))
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(value: string) {
  search.value = value
  clearTimeout(timer)
  timer = setTimeout(() => list.setFilter('q', value.trim()), 300)
}
const pick = (key: string, event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  // A narrower choice no longer applies once the wider one changes.
  if (key === 'warehouse') list.setFilters({ warehouse: value, location: undefined, rack: undefined })
  else if (key === 'location') list.setFilters({ location: value, rack: undefined })
  else list.setFilter(key, value)
}
</script>

<template>
  <WmsPage title="Stock Location" subtitle="Which location and rack holds each item right now." :source="answer?.source" :failed="list.failed.value">
    <FilterBar>
      <select class="erp-input" aria-label="Warehouse" :value="list.params.value.warehouse" @change="pick('warehouse', $event)">
        <option value="">Warehouse: all</option>
        <option v-for="w in answer?.options.warehouses ?? []" :key="w" :value="w">{{ w }}</option>
      </select>
      <select class="erp-input" aria-label="Location" :value="list.params.value.location" @change="pick('location', $event)">
        <option value="">Location: all</option>
        <option v-for="l in answer?.options.locations ?? []" :key="l" :value="l">{{ l }}</option>
      </select>
      <select class="erp-input" aria-label="Rack" :value="list.params.value.rack" @change="pick('rack', $event)">
        <option value="">Rack: all</option>
        <option v-for="r in answer?.options.racks ?? []" :key="r" :value="r">{{ r }}</option>
      </select>
      <input class="erp-input" type="search" placeholder="Item code or name" aria-label="Item code or name" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="Nothing is stored in these places.">
      <Column header="Warehouse" field="warehouse" />
      <Column header="Location" field="location" />
      <Column header="Rack">
        <template #body="{ data }: { data: LocationRow }">{{ data.rack ?? '—' }}</template>
      </Column>
      <Column header="Item">
        <template #body="{ data }: { data: LocationRow }"><span class="font-semibold whitespace-nowrap">{{ data.itemCode }}</span></template>
      </Column>
      <Column header="Name" field="name" />
      <Column header="Units" field="units" class="erp-col-num" />
      <Column header="Available" field="available" class="erp-col-num" />
      <Column header="Reserved" field="reserved" class="erp-col-num" />
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="answer" :page="answer.page" :page-size="answer.pageSize" :total="answer.total" @change="list.setPage" />
    </div>
  </WmsPage>
</template>
