<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useToast } from 'primevue/usetoast'
import { ChartLine, ClipboardCheck, Database, Factory, Sun, Warehouse } from '@lucide/vue'
import { sessionApi, type ModuleTile } from '@/api/session'
import DevUserSwitcher from '@/components/erp/DevUserSwitcher.vue'

/** 00 · Choose a module (Launcher.html). Only Purchase and Sales open in phase 1. */
const toast = useToast()

/** Tile colour (a theme token) and icon per module. */
const TILE_STYLE: Record<ModuleTile['code'], { icon: Component; color: string }> = {
  core: { icon: Database, color: 'var(--tile-core)' },
  purchase: { icon: ClipboardCheck, color: 'var(--tile-purchase)' },
  sales: { icon: ChartLine, color: 'var(--tile-sales)' },
  mes: { icon: Factory, color: 'var(--tile-mes)' },
  wms: { icon: Warehouse, color: 'var(--tile-wms)' },
  config: { icon: Sun, color: 'var(--tile-config)' },
}

const FALLBACK: ModuleTile[] = [
  { code: 'core', name: 'Core', tag: 'Master Data · existing', state: 'EXISTING', route: null },
  { code: 'purchase', name: 'Purchase', tag: 'Designed · open', state: 'OPEN', route: '/purchase' },
  { code: 'sales', name: 'Sales', tag: 'Designed · open', state: 'OPEN', route: '/sales' },
  { code: 'mes', name: 'MES', tag: 'Later', state: 'LATER', route: null },
  { code: 'wms', name: 'WMS', tag: 'Existing', state: 'EXISTING', route: null },
  { code: 'config', name: 'Configuration', tag: 'Users · settings', state: 'EXISTING', route: null },
]

const tiles = ref<ModuleTile[]>(FALLBACK)
onMounted(async () => {
  try {
    tiles.value = (await sessionApi.modules()).items
  } catch {
    /* keep the static list; the error toast already explains */
  }
})

// Default module: remembered for when login exists (then the app opens straight into it).
const DEFAULT_KEY = 'zora.defaultModule'
const openable = computed(() => tiles.value.filter((t) => t.state === 'OPEN'))
const defaultModule = ref(readDefault())
function readDefault(): string {
  try {
    return localStorage.getItem(DEFAULT_KEY) ?? 'sales'
  } catch {
    return 'sales'
  }
}
function applyDefault() {
  try {
    localStorage.setItem(DEFAULT_KEY, defaultModule.value)
  } catch {
    /* ignore */
  }
  const name = openable.value.find((t) => t.code === defaultModule.value)?.name ?? defaultModule.value
  toast.add({ severity: 'success', summary: 'Default module saved', detail: `${name} will open first after you sign in.`, life: 3000 })
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-launcher-bg">
    <header class="flex h-[52px] shrink-0 items-center justify-between bg-launcher-bar px-6 text-erp-on-dark">
      <div class="flex items-center gap-3">
        <div class="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-erp-on-dark text-[15px] font-extrabold text-launcher-bar">Z</div>
        <span class="text-[13px] font-extrabold tracking-[0.06em]">ZORA PRO ERP</span>
      </div>
      <div class="flex items-center gap-3 text-xs">
        <label class="flex items-center gap-2">
          <span>Default module</span>
          <select
            v-model="defaultModule"
            class="h-[30px] rounded-md border border-launcher-line bg-launcher-control px-2 font-[inherit] text-xs text-erp-on-dark"
          >
            <option v-for="t in openable" :key="t.code" :value="t.code">{{ t.name }}</option>
          </select>
        </label>
        <button
          type="button"
          class="h-[30px] rounded-md border border-launcher-line bg-launcher-control px-3.5 font-[inherit] text-xs font-semibold text-erp-on-dark"
          @click="applyDefault"
        >
          Apply
        </button>
        <span class="h-5 w-px bg-launcher-line" aria-hidden="true" />
        <DevUserSwitcher variant="launcher" />
      </div>
    </header>

    <main class="flex grow flex-col items-center justify-center gap-10 px-[120px] py-10">
      <div class="flex flex-col gap-2 text-center">
        <h1 class="m-0 text-[26px] font-bold">Choose a module</h1>
        <p class="m-0 text-sm text-erp-subtle">Each module is its own app with its own menu. They share one log-in and the Core master data.</p>
      </div>

      <div class="grid grid-cols-[repeat(3,180px)] gap-x-16 gap-y-10">
        <component
          :is="tile.route ? 'RouterLink' : 'div'"
          v-for="tile in tiles"
          :key="tile.code"
          :to="tile.route ?? undefined"
          class="flex h-[180px] w-[180px] flex-col items-center justify-center gap-3 rounded-[14px] p-4 text-center text-erp-on-dark"
          :class="{ 'launcher-open-tile': tile.route }"
          :style="{ '--tile-color': TILE_STYLE[tile.code].color, background: 'var(--tile-color)' }"
          :aria-disabled="tile.route ? undefined : 'true'"
        >
          <span class="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-erp-on-dark">
            <component :is="TILE_STYLE[tile.code].icon" :size="28" :style="{ color: 'var(--tile-color)' }" aria-hidden="true" />
          </span>
          <span class="text-base font-bold">{{ tile.name }}</span>
          <span class="rounded-[10px] bg-erp-on-dark/20 px-2.5 py-[3px] text-[11px] font-bold tracking-[0.03em]">{{ tile.tag }}</span>
        </component>
      </div>

      <div class="flex w-full gap-5">
        <div class="flex flex-1 flex-col gap-1.5 rounded-xl border border-launcher-note bg-erp-card px-5 py-[18px]">
          <b class="text-sm">Core feeds every module</b>
          <span class="text-[13px] leading-normal text-erp-subtle">Items, customers, suppliers, tax and price lists live in Core. Sales and Purchase only read them.</span>
        </div>
        <div class="flex flex-1 flex-col gap-1.5 rounded-xl border border-launcher-note bg-erp-card px-5 py-[18px]">
          <b class="text-sm">Sales and Purchase are separate</b>
          <span class="text-[13px] leading-normal text-erp-subtle">Each has its own menu, screens and data. Neither reads the other's tables.</span>
        </div>
        <div class="flex flex-1 flex-col gap-1.5 rounded-xl border border-launcher-note bg-erp-card px-5 py-[18px]">
          <b class="text-sm">They talk through events</b>
          <span class="text-[13px] leading-normal text-erp-subtle">Example: “sales order released” lets Purchase draft a PO for a buy-to-order item.</span>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Open modules: white gap, then a ring in the module colour (Launcher.html) */
.launcher-open-tile {
  box-shadow:
    0 0 0 4px var(--erp-on-dark),
    0 0 0 7px var(--tile-color);
}
</style>
