<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useListPage } from '@/composables/useListPage'
import { formatQty } from '@/utils/format'
import { wmsApi } from '../api/wms'
import WmsPage from '../components/WmsPage.vue'
import type { InventoryRow } from '../types'

/** W01 · Inventory (WmsInventory.html) */
const list = useListPage({ filterKeys: ['warehouse', 'group', 'show'], fetch: wmsApi.inventory })
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
</script>

<template>
  <WmsPage title="Inventory" subtitle="How much of each item is in each warehouse, counted from the RFID tags scanned in." :source="answer?.source" :failed="list.failed.value">
    <div class="grid grid-cols-4 gap-3">
      <KpiCard label="Items" :value="answer?.summary.items ?? '—'" :loading="list.loading.value && !answer" compact />
      <KpiCard label="Units on hand" :value="answer?.summary.units ?? '—'" :loading="list.loading.value && !answer" compact />
      <KpiCard label="Below reorder level" :value="answer?.summary.belowReorder ?? '—'" :loading="list.loading.value && !answer" compact />
      <KpiCard label="Out of stock" :value="answer?.summary.outOfStock ?? '—'" :loading="list.loading.value && !answer" compact />
    </div>

    <FilterBar>
      <select class="erp-input" aria-label="Warehouse" :value="list.params.value.warehouse" @change="list.setFilter('warehouse', ($event.target as HTMLSelectElement).value)">
        <option value="">Warehouse: all</option>
        <option v-for="w in answer?.options.warehouses ?? []" :key="w" :value="w">{{ w }}</option>
      </select>
      <select class="erp-input" aria-label="Item group" :value="list.params.value.group" @change="list.setFilter('group', ($event.target as HTMLSelectElement).value)">
        <option value="">Item group: all</option>
        <option v-for="g in answer?.options.groups ?? []" :key="g" :value="g">{{ g }}</option>
      </select>
      <input class="erp-input" type="search" placeholder="Item code or name" aria-label="Item code or name" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
      <select class="erp-input" aria-label="Show" :value="list.params.value.show" @change="list.setFilter('show', ($event.target as HTMLSelectElement).value)">
        <option value="">Show: all items</option>
        <option value="low">Low</option>
        <option value="out">Out of stock</option>
        <option value="notInErp">Not in ERP</option>
      </select>
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No items match these filters.">
      <Column header="Item" footer="Total units">
        <template #body="{ data }: { data: InventoryRow }"><span class="font-semibold whitespace-nowrap">{{ data.itemCode }}</span></template>
      </Column>
      <Column header="Name" field="name" />
      <Column header="Group" field="group" />
      <Column v-for="w in answer?.warehouses ?? []" :key="w" :header="w" class="erp-col-num" :footer="String(answer?.totals.byWarehouse[w] ?? 0)">
        <template #body="{ data }: { data: InventoryRow }">{{ data.byWarehouse[w] ?? 0 }}</template>
      </Column>
      <Column header="Total" class="erp-col-num" :footer="String(answer?.totals.total ?? 0)">
        <template #body="{ data }: { data: InventoryRow }"><span class="font-semibold">{{ data.total }}</span></template>
      </Column>
      <Column header="Reorder level" class="erp-col-num">
        <template #body="{ data }: { data: InventoryRow }">{{ data.reorderLevel === null ? '—' : formatQty(data.reorderLevel) }}</template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: InventoryRow }"><StatusChip :status="data.state" :label="data.stateLabel" :group="data.stateGroup" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="answer" :page="answer.page" :page-size="answer.pageSize" :total="answer.total" @change="list.setPage" />
    </div>
  </WmsPage>
</template>
