<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Column from 'primevue/column'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { formatDate } from '@/utils/format'
import { wmsApi } from '../api/wms'
import WmsPage from '../components/WmsPage.vue'
import type { ReceivingRow } from '../types'

/** W04 · Receiving (WmsReceiving.html) */
const list = useListPage({ filterKeys: ['warehouse', 'supplier'], fetch: wmsApi.receiving })
const answer = computed(() => list.data.value)
const rows = computed(() => answer.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
]

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
  <WmsPage title="Receiving" subtitle="Goods received into the warehouse, and how many tags have been scanned in." :source="answer?.source" :failed="list.failed.value">
    <StatusTabs :tabs="TABS" :counts="answer?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <FilterBar>
      <select class="erp-input" aria-label="Warehouse" :value="list.params.value.warehouse" @change="list.setFilter('warehouse', ($event.target as HTMLSelectElement).value)">
        <option value="">Warehouse: all</option>
        <option v-for="w in answer?.options.warehouses ?? []" :key="w" :value="w">{{ w }}</option>
      </select>
      <select class="erp-input" aria-label="Supplier" :value="list.params.value.supplier" @change="list.setFilter('supplier', ($event.target as HTMLSelectElement).value)">
        <option value="">Supplier: all</option>
        <option v-for="s in answer?.options.suppliers ?? []" :key="s.code" :value="s.code">{{ s.name }}</option>
      </select>
      <label class="flex items-center gap-2 text-xs font-medium whitespace-nowrap text-erp-muted">Received from<input class="erp-input min-w-0 grow" type="date" :value="list.params.value.dateFrom" @change="list.setFilter('dateFrom', ($event.target as HTMLInputElement).value)" /></label>
      <input class="erp-input" type="search" placeholder="Receiving, DO or PO number" aria-label="Receiving, DO or PO number" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No receivings match these filters.">
      <Column header="Receiving">
        <template #body="{ data }: { data: ReceivingRow }"><span class="font-semibold whitespace-nowrap">{{ data.receivingCode }}</span></template>
      </Column>
      <Column header="Supplier DO">
        <template #body="{ data }: { data: ReceivingRow }">{{ data.supplierDo ?? '—' }}</template>
      </Column>
      <Column header="PO">
        <template #body="{ data }: { data: ReceivingRow }">{{ data.po ?? '—' }}</template>
      </Column>
      <Column header="Supplier">
        <template #body="{ data }: { data: ReceivingRow }">{{ data.supplierName ?? '—' }}</template>
      </Column>
      <Column header="Warehouse">
        <template #body="{ data }: { data: ReceivingRow }">{{ data.warehouse ?? '—' }}</template>
      </Column>
      <Column header="Date">
        <template #body="{ data }: { data: ReceivingRow }"><span class="whitespace-nowrap">{{ formatDate(data.date) }}</span></template>
      </Column>
      <Column header="Received" field="received" class="erp-col-num" />
      <Column header="Scanned in" field="scannedIn" class="erp-col-num" />
      <Column header="Status">
        <template #body="{ data }: { data: ReceivingRow }"><StatusChip :status="data.statusKey" :label="data.statusLabel" :group="data.statusGroup" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="answer" :page="answer.page" :page-size="answer.pageSize" :total="answer.total" @change="list.setPage" />
    </div>
  </WmsPage>
</template>
