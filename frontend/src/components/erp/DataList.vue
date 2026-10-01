<script setup lang="ts" generic="T extends { id: string }">
import DataTable from 'primevue/datatable'

/**
 * The list table of every list page: a PrimeVue DataTable styled like the mockups (11px uppercase headers,
 * 13px rows, module-coloured selection). Columns go in the default slot as PrimeVue <Column>s.
 * Paging and sorting stay on the server (useListPage + Pager).
 */
defineProps<{
  rows: T[]
  loading?: boolean
  emptyText?: string
  selectable?: boolean
}>()
const selection = defineModel<T[]>('selection', { default: () => [] })
</script>

<template>
  <DataTable
    v-model:selection="selection"
    :value="rows"
    data-key="id"
    :loading="loading"
    :selection-mode="selectable ? 'multiple' : undefined"
    :meta-key-selection="false"
    class="erp-datalist"
    table-class="erp-datalist-table"
  >
    <slot />
    <template #empty>
      <div class="py-8 text-center text-[13px] text-erp-muted">{{ emptyText ?? 'Nothing to show for these filters.' }}</div>
    </template>
  </DataTable>
</template>
