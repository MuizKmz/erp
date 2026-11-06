<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ExternalLink } from '@lucide/vue'
import DashboardBoard from '@/components/erp/DashboardBoard.vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { wmsApi } from '../api/wms'
import { WMS_MENU } from '../menu'
import type { WmsDashboard } from '../types'

/** W00 · WMS home: a tile per screen, the KPI cards and the person's charts, like the other module homes. */
const data = ref<WmsDashboard | null>(null)
const loading = ref(true)
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    data.value = await wmsApi.dashboard()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const TILES = WMS_MENU[0]!.items
const TILE_SHADES = ['bg-mod-tile-1', 'bg-mod-tile-2', 'bg-mod-tile-3', 'bg-mod-tile-4', 'bg-mod-tile-5']
const TILE_TEXT = ['text-mod-tile-1', 'text-mod-tile-2', 'text-mod-tile-3', 'text-mod-tile-4', 'text-mod-tile-5']

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const subs = computed(() => {
  const k = data.value?.kpis
  if (!k) return null
  return {
    units: `Across ${plural(k.units.warehouses, 'warehouse', 'warehouses')} · ${plural(k.units.items, 'item', 'items')}`,
    reorder: k.reorder.outOfStock ? `${k.reorder.outOfStock} out of stock` : 'None out of stock',
    scan: k.toScan.count ? `${plural(k.toScan.units, 'unit', 'units')} still to scan in` : 'Everything received is scanned in',
    ship: k.toShip.count ? `${plural(k.toShip.units, 'unit', 'units')} still to send` : 'Nothing waiting to ship',
  }
})
const updated = computed(() => (data.value?.source.stale ? 'These are the last figures it gave.' : ''))
</script>

<template>
  <!-- A tile per screen -->
  <div class="flex items-start justify-between gap-4">
    <div class="flex flex-wrap gap-4">
      <RouterLink
        v-for="(item, i) in TILES"
        :key="item.key"
        :to="item.to"
        class="flex h-[100px] w-[132px] flex-col items-center justify-center gap-2 rounded-xl p-2 text-center text-xs font-semibold text-erp-on-dark"
        :class="TILE_SHADES[i]"
      >
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-erp-on-dark">
          <component :is="item.icon" :size="18" :class="TILE_TEXT[i]" aria-hidden="true" />
        </span>
        {{ item.label }}
      </RouterLink>
    </div>
    <a v-if="data?.source.webUrl" :href="data.source.webUrl" target="_blank" rel="noopener" class="erp-btn erp-btn-secondary shrink-0"><ExternalLink :size="14" aria-hidden="true" />Open in WMS</a>
  </div>

  <NoticeBanner v-if="failed || data?.source.stale" kind="warning">The WMS cannot be reached right now. {{ updated }}</NoticeBanner>
  <NoticeBanner v-else kind="info"><strong>Read only.</strong> This comes from the WMS. Changes are made there, by scan or on its website.</NoticeBanner>

  <DashboardBoard path="/wms/dashboard/board">
    <template #kpis>
      <div v-if="failed" class="erp-card flex items-center justify-between px-5 py-4 text-[13px]">
        <span>The cards could not be loaded.</span>
        <button type="button" class="erp-btn erp-btn-secondary" @click="load">Try again</button>
      </div>
      <div class="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <KpiCard label="Units on hand" :value="data?.kpis.units.count ?? ''" :sub="subs?.units" to="/wms/inventory" :loading="loading" />
        <KpiCard label="Below reorder level" :value="data?.kpis.reorder.count ?? ''" :sub="subs?.reorder" to="/wms/inventory" tone="warning" :loading="loading" />
        <KpiCard label="Receiving to scan in" :value="data?.kpis.toScan.count ?? ''" :sub="subs?.scan" to="/wms/receiving" :loading="loading" />
        <KpiCard label="Waiting to ship" :value="data?.kpis.toShip.count ?? ''" :sub="subs?.ship" to="/wms/shipping?status=pending" :loading="loading" />
      </div>
    </template>
  </DashboardBoard>
</template>
