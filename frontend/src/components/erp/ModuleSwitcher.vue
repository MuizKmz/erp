<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, LayoutGrid } from '@lucide/vue'
import { sessionApi, type ModuleTile } from '@/api/session'
import { useSession } from '@/composables/useSession'
import { MODULES, type ModuleDef } from '@/modules/registry'
import { isBuilt, TILE_STYLE } from '@/modules/tiles'

/**
 * Jump to another module in one click. `chip`: the "Purchase module" chip on a module home opens it. `rail`: the grid
 * icon at the top of a screen's icon rail opens it beside the rail. Lists only the modules the person can open (the
 * launcher's rule), with what is waiting for them; *All modules* at the bottom opens the launcher.
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{ module: ModuleDef; variant: 'chip' | 'rail'; triggerClass?: string | string[] }>()

const { state } = useSession()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

// The person's modules, loaded once per user (the session version bumps on a user or branch switch).
const tiles = ref<ModuleTile[]>([])
const waiting = reactive<Record<string, number>>({})
let loadedFor = -1
async function load() {
  if (loadedFor === state.version) return
  loadedFor = state.version
  try {
    tiles.value = (await sessionApi.modules()).items.filter(isBuilt)
  } catch {
    tiles.value = []
  }
}
watch(() => state.version, () => (open.value ? void load() : (loadedFor = -1)))

async function loadWaiting() {
  for (const t of tiles.value) {
    const fetchCount = MODULES[t.code as keyof typeof MODULES].approvalsCount
    if (!fetchCount) continue
    fetchCount()
      .then((c) => (waiting[t.code] = c.waitingForMe))
      .catch(() => undefined)
  }
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await load()
  void loadWaiting()
}

const items = computed(() => tiles.value.map((t) => ({ ...t, style: TILE_STYLE[t.code], current: t.code === props.module.key })))

function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" :class="variant === 'chip' ? 'relative' : ''">
    <button
      v-if="variant === 'chip'"
      type="button"
      v-bind="$attrs"
      class="inline-flex cursor-pointer items-center gap-1 rounded-xl border-0 bg-mod-chip-bg px-2.5 py-[3px] font-[inherit] text-xs font-semibold text-mod-chip-text"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Switch module"
      @click="toggle"
    >
      {{ module.label }} module
      <ChevronDown :size="12" class="transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true" />
    </button>
    <button v-else type="button" v-bind="$attrs" :class="triggerClass" aria-label="Switch module" :aria-expanded="open" aria-haspopup="menu" @click="toggle">
      <LayoutGrid :size="18" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="z-50 w-72 overflow-hidden rounded-xl border border-erp-border bg-erp-card text-erp-text shadow-lg"
      :class="variant === 'chip' ? 'absolute top-full left-0 mt-2' : 'fixed top-3 left-[76px]'"
    >
      <div class="border-b border-erp-row bg-erp-head px-4 py-2.5 text-xs text-erp-muted">Switch module</div>
      <ul class="m-0 list-none p-1">
        <li v-if="!items.length" class="px-3 py-2 text-[13px] text-erp-muted">Loading…</li>
        <li v-for="t in items" :key="t.code" :style="{ '--tile-color': t.style.color }">
          <RouterLink
            :to="t.route!"
            role="menuitem"
            :aria-current="t.current ? 'page' : undefined"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-erp-text no-underline hover:bg-erp-head"
            @click="open = false"
          >
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--tile-color) text-erp-on-dark">
              <component :is="t.style.icon" :size="15" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1 font-semibold">{{ t.name }}</span>
            <span v-if="waiting[t.code]" class="rounded-full bg-chip-pending-bg px-2 py-px text-[11px] font-semibold text-chip-pending-text">
              {{ waiting[t.code] }} waiting
            </span>
            <Check v-if="t.current" :size="16" class="text-mod-accent" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
      <div class="border-t border-erp-row p-1">
        <RouterLink
          to="/"
          role="menuitem"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold text-erp-subtle no-underline hover:bg-erp-head"
          @click="open = false"
        >
          <span class="flex h-7 w-7 items-center justify-center"><LayoutGrid :size="16" aria-hidden="true" /></span>
          All modules
        </RouterLink>
      </div>
    </div>
  </div>
</template>
