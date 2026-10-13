<script setup lang="ts">
import { onMounted, ref } from 'vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import { formatDateTime } from '@/utils/format'
import { coreApi } from '../api/core'
import { CORE_MENU } from '../menu'
import { recordRoute } from '../routes'
import type { CoreDashboard, CoreDashboardCard } from '../types'

/** C01 · Core home: the kinds of master data with their counts by status, and the latest changes. */
const TILE_SHADES = ['bg-mod-tile-1', 'bg-mod-tile-2', 'bg-mod-tile-3', 'bg-mod-tile-4']
const TILE_TEXT = ['text-mod-tile-1', 'text-mod-tile-2', 'text-mod-tile-3', 'text-mod-tile-4']

const data = ref<CoreDashboard | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await coreApi.dashboard()
  } finally {
    loading.value = false
  }
})

/** "14 active · 1 blocked", leaving out statuses nobody has. */
const breakdown = (c: CoreDashboardCard) =>
  [...c.parts.filter((p) => p.count > 0).map((p) => `${p.count} ${p.label.toLowerCase()}`), ...(c.note ? [c.note] : [])].join(' · ') || 'None yet'
</script>

<template>
  <!-- Group tiles -->
  <div class="flex gap-4">
    <RouterLink
      v-for="(g, i) in CORE_MENU"
      :key="g.key"
      :to="g.to"
      class="flex h-[100px] w-[132px] flex-col items-center justify-center gap-2 rounded-xl p-2 text-center text-xs font-semibold text-erp-on-dark"
      :class="TILE_SHADES[i]"
    >
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-erp-on-dark">
        <component :is="g.icon" :size="18" :class="TILE_TEXT[i]" aria-hidden="true" />
      </span>
      {{ g.title }}
    </RouterLink>
  </div>

  <section class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-4">
      <h2 class="m-0 text-[15px] font-bold">Master data</h2>
      <span class="text-xs text-erp-muted">Purchase and Sales read these. A change applies to new documents; released documents keep what they had.</span>
    </div>
    <div class="grid grid-cols-4 gap-4">
      <template v-if="loading && !data">
        <KpiCard v-for="n in 7" :key="n" label="" value="" loading />
      </template>
      <KpiCard v-for="c in data?.cards ?? []" :key="c.key" :label="c.label" :value="c.total" :sub="breakdown(c)" :to="c.to" />
    </div>
  </section>

  <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
    <h2 class="m-0 text-[15px] font-bold">Recently changed</h2>
    <p v-if="data && !data.recent.length" class="m-0 text-[13px] text-erp-muted">
      Nothing has been changed in Core yet. Every change made here shows up in this list, with who made it and what changed.
    </p>
    <table v-else-if="data" class="erp-table">
      <thead>
        <tr><th>When</th><th>Who</th><th>Record</th><th>What changed</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in data.recent" :key="`${r.entityId}-${r.at}`">
          <td class="whitespace-nowrap">{{ formatDateTime(r.at) }}</td>
          <td class="whitespace-nowrap">{{ r.userName }}</td>
          <td class="whitespace-nowrap">
            <RouterLink v-if="recordRoute(r.entityType, r.entityId)" :to="recordRoute(r.entityType, r.entityId)!" class="erp-link font-semibold">{{ r.code ?? 'Open' }}</RouterLink>
            <span v-else>{{ r.code }}</span>
          </td>
          <td>{{ r.message }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
