<script setup lang="ts">
import { computed, onMounted, reactive, ref, type Component } from 'vue'
import { useToast } from 'primevue/usetoast'
import { ArrowRight, ChartLine, ClipboardCheck, Database, Factory, Star, Sun, Warehouse } from '@lucide/vue'
import { accountApi, sessionApi, type ModuleTile } from '@/api/session'
import AccountMenu from '@/components/erp/AccountMenu.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'
import { MODULES } from '@/modules/registry'
import { formatLongDate, greeting } from '@/utils/format'

/** 00 · Choose a module. A tile opens only when its module is built in this app; the rest say "Coming soon". */
const toast = useToast()
const { state, user, today, now, isJwt } = useSession()

/** Tile colour (a theme token), icon and one-line purpose per module. */
const TILE_STYLE: Record<ModuleTile['code'], { icon: Component; color: string; description: string }> = {
  core: { icon: Database, color: 'var(--tile-core)', description: 'Items, customers, suppliers, tax and price lists.' },
  purchase: { icon: ClipboardCheck, color: 'var(--tile-purchase)', description: 'Requests, quotes, orders, goods receipt and supplier bills.' },
  sales: { icon: ChartLine, color: 'var(--tile-sales)', description: 'Enquiries, quotations, sales orders and delivery.' },
  mes: { icon: Factory, color: 'var(--tile-mes)', description: 'Production orders and shop-floor tracking.' },
  wms: { icon: Warehouse, color: 'var(--tile-wms)', description: 'Warehouse locations, picking and stock moves.' },
  config: { icon: Sun, color: 'var(--tile-config)', description: 'Users, roles and company settings.' },
}

const FALLBACK: ModuleTile[] = [
  { code: 'core', name: 'Core', tag: '', state: 'OPEN', route: '/core' },
  { code: 'purchase', name: 'Purchase', tag: '', state: 'OPEN', route: '/purchase' },
  { code: 'sales', name: 'Sales', tag: '', state: 'OPEN', route: '/sales' },
  { code: 'mes', name: 'MES', tag: '', state: 'LATER', route: null },
  { code: 'wms', name: 'WMS', tag: '', state: 'EXISTING', route: null },
  { code: 'config', name: 'Configuration', tag: '', state: 'OPEN', route: '/config' },
]

const tiles = ref<ModuleTile[]>(FALLBACK)

/** Built modules first, keeping the server's order within each group. */
const isBuilt = (t: ModuleTile) => !!t.route && t.code in MODULES
const sortedTiles = computed(() => [...tiles.value.filter(isBuilt), ...tiles.value.filter((t) => !isBuilt(t))])
const builtTiles = computed(() => tiles.value.filter(isBuilt))

// Approvals waiting for the current user, per built module (shown on its tile).
const waiting = reactive<Record<string, number>>({})
async function loadWaiting() {
  for (const t of builtTiles.value) {
    const fetchCount = MODULES[t.code as keyof typeof MODULES].approvalsCount
    if (!fetchCount) continue
    try {
      waiting[t.code] = (await fetchCount()).waitingForMe
    } catch {
      /* the tile just shows no count */
    }
  }
}

// A14 "Ask to change regularly": the password is old enough to ask for a new one (sign-in mode only).
const passwordDue = ref(false)

onMounted(async () => {
  try {
    tiles.value = (await sessionApi.modules()).items
  } catch {
    /* keep the static list; the error toast already explains */
  }
  if (isJwt.value) {
    accountApi
      .get(true)
      .then((a) => (passwordDue.value = a.password.changeDue))
      .catch(() => undefined)
  }
  await loadWaiting()
})

// Default module: remembered for when login exists (then the app opens straight into it).
const DEFAULT_KEY = 'zora.defaultModule'
const ADMIN_MODULES: string[] = ['core', 'config']
const storedDefault = ref(readDefault())
// Without a choice, the first module for daily work: Core and Configuration are for administrators, so never the fallback.
const defaultModule = computed(() =>
  builtTiles.value.some((t) => t.code === storedDefault.value)
    ? storedDefault.value
    : (builtTiles.value.find((t) => !ADMIN_MODULES.includes(t.code))?.code ?? builtTiles.value[0]?.code ?? ''),
)
function readDefault(): string {
  try {
    return localStorage.getItem(DEFAULT_KEY) ?? ''
  } catch {
    return ''
  }
}
function setDefault(tile: ModuleTile) {
  if (tile.code === defaultModule.value) return
  storedDefault.value = tile.code
  try {
    localStorage.setItem(DEFAULT_KEY, tile.code)
  } catch {
    /* private mode: the choice lasts until reload */
  }
  toast.add({ severity: 'success', summary: 'Default module saved', detail: `${tile.name} will open first after you sign in.`, life: 3000 })
}

const hello = computed(() => `${greeting(now())}, ${user.value?.name ?? ''}`)
const year = computed(() => today.value.slice(0, 4))
</script>

<template>
  <div class="flex min-h-screen flex-col bg-erp-bg">
    <!-- Floating top bar, same shape as the module screens -->
    <div class="sticky top-0 z-20 px-4 pt-3 pb-2 backdrop-blur-sm md:px-6">
      <header class="flex h-14 items-center justify-between gap-4 rounded-2xl border border-erp-border bg-erp-card/95 px-4 shadow-sm md:px-5">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-base font-extrabold text-erp-on-dark">Z</div>
          <div class="truncate text-[15px] font-bold">Zora <span class="text-erp-link">Pro</span> ERP</div>
          <span v-if="state.tenantName" class="hidden rounded-full bg-erp-track px-2.5 py-0.5 text-xs font-semibold text-erp-subtle sm:inline">
            {{ state.tenantName }}
          </span>
        </div>
        <AccountMenu variant="launcher" />
      </header>
    </div>

    <main class="mx-auto flex w-full max-w-[1040px] grow flex-col gap-8 px-4 pt-10 pb-10 md:px-6 md:pt-14">
      <div class="flex flex-col gap-1.5">
        <p class="m-0 text-xs font-semibold tracking-widest text-erp-muted uppercase">{{ today ? formatLongDate(today) : '' }}</p>
        <h1 class="m-0 text-[28px] leading-tight font-bold">{{ hello }}</h1>
        <p class="m-0 text-sm text-erp-subtle">Choose a module to start working.</p>
      </div>

      <NoticeBanner v-if="passwordDue" kind="warning">
        It is time to change your password. <RouterLink to="/account" class="erp-link font-semibold">Change it in My account</RouterLink>
      </NoticeBanner>

      <ul class="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="tile in sortedTiles" :key="tile.code" :style="{ '--tile-color': TILE_STYLE[tile.code].color }">
          <!-- Built module: the whole card is the link (stretched over it); the star sits above it -->
          <div
            v-if="isBuilt(tile)"
            class="group relative flex h-full flex-col gap-4 rounded-2xl border border-erp-border bg-erp-card p-5 shadow-sm transition-all duration-200 focus-within:ring-2 focus-within:ring-(--tile-color) hover:-translate-y-0.5 hover:border-(--tile-color) hover:shadow-lg"
          >
            <div class="flex items-start justify-between">
              <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-(--tile-color) text-erp-on-dark shadow-sm">
                <component :is="TILE_STYLE[tile.code].icon" :size="24" aria-hidden="true" />
              </span>
              <button
                type="button"
                class="relative z-10 flex items-center gap-1 rounded-lg border-0 bg-transparent px-2 py-1 font-[inherit] text-xs font-semibold transition-colors"
                :class="tile.code === defaultModule ? 'text-attention' : 'text-erp-muted opacity-0 group-hover:opacity-100 hover:bg-erp-head focus-visible:opacity-100'"
                :aria-pressed="tile.code === defaultModule"
                :title="tile.code === defaultModule ? 'Opens first after you sign in' : 'Set as default module'"
                @click="setDefault(tile)"
              >
                <Star :size="14" :fill="tile.code === defaultModule ? 'currentColor' : 'none'" aria-hidden="true" />
                {{ tile.code === defaultModule ? 'Default' : 'Set default' }}
              </button>
            </div>

            <div class="flex flex-col gap-1">
              <RouterLink
                :to="tile.route!"
                class="text-lg font-bold text-erp-text outline-none after:absolute after:inset-0 after:rounded-2xl"
              >
                {{ tile.name }}
              </RouterLink>
              <p class="m-0 text-[13px] leading-normal text-erp-muted">{{ TILE_STYLE[tile.code].description }}</p>
            </div>

            <div class="mt-auto flex items-center justify-between border-t border-erp-row pt-3.5 text-[13px]">
              <span v-if="waiting[tile.code]" class="rounded-full bg-chip-pending-bg px-2.5 py-0.5 text-xs font-semibold text-chip-pending-text">
                {{ waiting[tile.code] }} waiting for you
              </span>
              <span v-else class="text-xs text-erp-muted">Nothing waiting for you</span>
              <span class="flex items-center gap-1 font-semibold text-(--tile-color)">
                Open<ArrowRight :size="15" class="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </div>
          </div>

          <!-- Not in this app yet -->
          <div v-else class="flex h-full flex-col gap-4 rounded-2xl border border-dashed border-erp-input bg-erp-card/60 p-5" aria-disabled="true">
            <div class="flex items-start justify-between">
              <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-(--tile-color)/10 text-(--tile-color)">
                <component :is="TILE_STYLE[tile.code].icon" :size="24" aria-hidden="true" />
              </span>
              <span class="rounded-full bg-erp-track px-2.5 py-0.5 text-xs font-semibold text-erp-muted">Coming soon</span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-lg font-bold text-erp-subtle">{{ tile.name }}</span>
              <p class="m-0 text-[13px] leading-normal text-erp-muted">{{ TILE_STYLE[tile.code].description }}</p>
            </div>
          </div>
        </li>
      </ul>
    </main>

    <footer class="mx-auto flex w-full max-w-[1040px] items-center justify-between px-4 pb-6 text-xs text-erp-muted md:px-6">
      <span class="font-semibold text-erp-subtle">Zora Pro ERP<template v-if="state.tenantName"> · {{ state.tenantName }}</template></span>
      <span>© {{ year }} All rights reserved.</span>
    </footer>
  </div>
</template>
