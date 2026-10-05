<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Column from 'primevue/column'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus } from '@lucide/vue'
import DataList from '@/components/erp/DataList.vue'
import FilterBar from '@/components/erp/FilterBar.vue'
import MoneyText from '@/components/erp/MoneyText.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import Pager from '@/components/erp/Pager.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import StatusTabs from '@/components/erp/StatusTabs.vue'
import { useListPage } from '@/composables/useListPage'
import { useSession } from '@/composables/useSession'
import { formatDate } from '@/utils/format'
import { salesEnquiriesApi, salesLookupsApi } from '../api/sales'
import type { EnquiryListItem } from '../types'

/** S06 · List of Enquiry (EnquiryList.html) */
const toast = useToast()
const confirm = useConfirm()
const { can, today } = useSession()

const list = useListPage({ filterKeys: ['type', 'agent', 'branch'], fetch: salesEnquiriesApi.list })
const rows = computed(() => list.data.value?.items ?? [])

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'forwarded', label: 'Forwarded' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'lost', label: 'Lost' },
]
const GROUP: Record<string, 'draft' | 'released' | 'done' | 'cancelled'> = { NEW: 'draft', FORWARDED: 'released', QUOTED: 'done', LOST: 'cancelled' }

const types = ref<{ code: string; name: string }[]>([])
const agents = ref<{ code: string; name: string }[]>([])
const branches = ref<{ code: string; name: string }[]>([])
onMounted(async () => {
  const [t, a, b] = await Promise.all([salesLookupsApi.enquiryTypes(), salesLookupsApi.agents(), salesLookupsApi.branches()])
  types.value = t.types
  agents.value = a.items
  branches.value = b.items
})

const selection = ref<EnquiryListItem[]>([])
watch(rows, () => (selection.value = selection.value.filter((s) => rows.value.some((r) => r.id === s.id))))
const deletable = computed(() => selection.value.filter((s) => s.canDelete))

const showing = computed(() => {
  const d = list.data.value
  if (!d || !d.total) return ''
  const from = (d.page - 1) * d.pageSize + 1
  return `Showing ${from}–${Math.min(d.page * d.pageSize, d.total)} of ${d.total} enquiries`
})

function deleteSelected() {
  const items = deletable.value
  if (!items.length) return
  confirm.require({
    header: items.length === 1 ? `Delete ${items[0]!.docNo}?` : `Delete ${items.length} enquiries?`,
    message: 'Only new enquiries without a quotation can be deleted. Their numbers are not used again.',
    acceptLabel: 'Delete',
    rejectLabel: 'Keep',
    acceptClass: 'p-button-danger',
    accept: async () => {
      for (const e of items) await salesEnquiriesApi.remove(e.id, e.version)
      toast.add({ severity: 'success', summary: `${items.map((e) => e.docNo).join(', ')} deleted`, life: 3000 })
      selection.value = []
      void list.reload()
    },
  })
}

function importLater() {
  toast.add({ severity: 'info', summary: 'Import', detail: 'Bulk upload of enquiries comes later.', life: 3000 })
}

async function exportCsv() {
  const { status, ...filters } = list.params.value
  const all: EnquiryListItem[] = []
  for (let page = 1; ; page++) {
    const result = await salesEnquiriesApi.list({ ...filters, status: status === 'all' ? undefined : status, page, pageSize: 100 })
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) break
  }
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['Enq no', 'Company', 'Contact', 'Status', 'Sales agent', 'Type', 'From', 'Branch', 'Budget (RM)', 'Quotation', 'Created'].map(cell).join(','),
    ...all.map((e) => [e.docNo, e.customerName, e.contactName ?? '', e.statusLabel, e.agentName, e.typeName, e.sourceName, e.branchName, e.budget ?? '', e.quotation?.no ?? '', e.docDate].map(cell).join(',')),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `enquiries-${today.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="List of Enquiry" subtitle="Every customer request before a quotation. Existing customers come from Master Data; new prospects are allowed." />

    <FilterBar>
      <select class="erp-input" aria-label="Filter by enquiry type" :value="list.params.value.type" @change="list.setFilter('type', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by enquiry type</option>
        <option v-for="t in types" :key="t.code" :value="t.code">{{ t.name }}</option>
      </select>
      <select class="erp-input" aria-label="Filter by status" :value="list.params.value.status === 'all' ? '' : list.params.value.status" @change="list.setStatus(($event.target as HTMLSelectElement).value || 'all')">
        <option value="">Filter by status</option>
        <option v-for="t in TABS.slice(1)" :key="t.key" :value="t.key">{{ t.label }}</option>
      </select>
      <select class="erp-input" aria-label="Filter by sales agent" :value="list.params.value.agent" @change="list.setFilter('agent', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by sales agent</option>
        <option v-for="a in agents" :key="a.code" :value="a.code">{{ a.name }}</option>
      </select>
      <select class="erp-input" aria-label="Filter by branch" :value="list.params.value.branch" @change="list.setFilter('branch', ($event.target as HTMLSelectElement).value)">
        <option value="">Filter by branch</option>
        <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
      </select>
    </FilterBar>

    <StatusTabs :tabs="TABS" :counts="list.data.value?.statusCounts" :active="list.params.value.status" @select="list.setStatus" />

    <div class="flex items-center justify-between gap-3">
      <div class="flex gap-2">
        <RouterLink v-if="can('sales.enquiry.edit')" to="/sales/enquiries/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new enquiry</RouterLink>
        <button type="button" class="erp-btn erp-btn-delete" :disabled="!deletable.length" @click="deleteSelected">Delete</button>
      </div>
      <div class="flex gap-2">
        <button type="button" class="erp-btn erp-btn-import" @click="importLater">Import</button>
        <button type="button" class="erp-btn erp-btn-export" @click="exportCsv">Export</button>
      </div>
    </div>
    <span class="text-xs text-erp-muted">{{ showing }}</span>

    <DataList v-model:selection="selection" :rows="rows" :loading="list.loading.value" selectable empty-text="No enquiries match these filters.">
      <Column selection-mode="multiple" header-style="width: 44px" />
      <Column header="Enq no">
        <template #body="{ data }: { data: EnquiryListItem }">
          <span v-if="data.isMigrated" class="font-semibold whitespace-nowrap">{{ data.docNo }}</span>
          <RouterLink v-else :to="`/sales/enquiries/${data.id}`" class="erp-link font-semibold whitespace-nowrap">{{ data.docNo }}</RouterLink>
        </template>
      </Column>
      <Column header="Company · contact">
        <template #body="{ data }: { data: EnquiryListItem }">
          <div>
            {{ data.customerName }}
            <span v-if="data.isProspect" class="ml-1 rounded-md bg-note-warn-bg px-1.5 py-px text-[11px] font-semibold text-attention">Prospect</span>
          </div>
          <div class="text-xs text-erp-muted">{{ data.contactName }}</div>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }: { data: EnquiryListItem }"><StatusChip :status="data.status" :label="data.statusLabel" :group="GROUP[data.status]" /></template>
      </Column>
      <Column header="Sales agent" field="agentName" />
      <Column header="Type · from">
        <template #body="{ data }: { data: EnquiryListItem }">
          <div class="whitespace-nowrap">{{ data.typeName }}</div>
          <div class="text-xs text-erp-muted">{{ data.sourceName }}</div>
        </template>
      </Column>
      <Column header="Branch" field="branchName" />
      <Column header="Budget (RM)" class="erp-col-num">
        <template #body="{ data }: { data: EnquiryListItem }"><MoneyText :value="data.budget" /></template>
      </Column>
      <Column header="Quotation">
        <template #body="{ data }: { data: EnquiryListItem }">
          <RouterLink v-if="data.quotation?.id" :to="`/sales/quotations/${data.quotation.id}`" class="erp-link whitespace-nowrap">{{ data.quotation.no }}</RouterLink>
          <span v-else-if="data.quotation" class="whitespace-nowrap text-erp-muted">{{ data.quotation.no }}</span>
          <span v-else class="text-erp-muted">—</span>
        </template>
      </Column>
      <Column header="Created">
        <template #body="{ data }: { data: EnquiryListItem }"><span class="whitespace-nowrap">{{ formatDate(data.docDate) }}</span></template>
      </Column>
    </DataList>

    <div class="mt-auto flex items-center justify-end pt-2">
      <Pager v-if="list.data.value" :page="list.data.value.page" :page-size="list.data.value.pageSize" :total="list.data.value.total" @change="list.setPage" />
    </div>
  </section>
</template>
