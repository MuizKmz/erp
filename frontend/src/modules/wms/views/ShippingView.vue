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
import type { ShippingRow } from '../types'

/** W05 · Shipping (WmsShipping.html). A WMS shipment does not name a warehouse, so there is no warehouse filter. */
const list = useListPage({ filterKeys: ['customer'], fetch: wmsApi.shipping })
const answer = computed(() => list.data.value)
const rows = computed(() => answer.value?.items ?? [])
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'cancelled', label: 'Cancelled' },
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
  <WmsPage title="Shipping" subtitle="Shipments leaving the warehouse, and what is still waiting to go." :source="answer?.source" :failed="list.failed.value">
    <StatusTabs :tabs="TABS" :counts="answer?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <FilterBar :columns="3">
      <select class="erp-input" aria-label="Customer" :value="list.params.value.customer" @change="list.setFilter('customer', ($event.target as HTMLSelectElement).value)">
        <option value="">Customer: all</option>
        <option v-for="c in answer?.options.customers ?? []" :key="c.code" :value="c.code">{{ c.name }}</option>
      </select>
      <label class="flex items-center gap-2 text-xs font-medium whitespace-nowrap text-erp-muted">Ship date from<input class="erp-input min-w-0 grow" type="date" :value="list.params.value.dateFrom" @change="list.setFilter('dateFrom', ($event.target as HTMLInputElement).value)" /></label>
      <input class="erp-input" type="search" placeholder="Tracking or order number" aria-label="Tracking or order number" :value="search" @input="onSearch(($event.target as HTMLInputElement).value)" />
    </FilterBar>

    <DataList :rows="rows" :loading="list.loading.value" empty-text="No shipments match these filters.">
      <Column header="Tracking">
        <template #body="{ data }: { data: ShippingRow }"><span class="font-semibold whitespace-nowrap">{{ data.trackingCode }}</span></template>
      </Column>
      <Column header="Order">
        <template #body="{ data }: { data: ShippingRow }">{{ data.order ?? '—' }}</template>
      </Column>
      <Column header="Customer">
        <template #body="{ data }: { data: ShippingRow }">{{ data.customerName ?? '—' }}</template>
      </Column>
      <Column header="Destination">
        <template #body="{ data }: { data: ShippingRow }">{{ data.destination ?? '—' }}</template>
      </Column>
      <Column header="Ship date">
        <template #body="{ data }: { data: ShippingRow }"><span class="whitespace-nowrap">{{ data.shipDate ? formatDate(data.shipDate) : 'Not shipped' }}</span></template>
      </Column>
      <Column header="Units" field="units" class="erp-col-num" />
      <Column header="Status">
        <template #body="{ data }: { data: ShippingRow }"><StatusChip :status="data.statusKey" :label="data.statusLabel" :group="data.statusGroup" /></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="answer" :page="answer.page" :page-size="answer.pageSize" :total="answer.total" @change="list.setPage" />
    </div>
  </WmsPage>
</template>
