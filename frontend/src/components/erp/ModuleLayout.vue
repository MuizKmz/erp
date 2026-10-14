<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, House, LayoutGrid, LogOut } from '@lucide/vue'
import { useApprovalsCount } from '@/composables/useApprovalsCount'
import { useModuleTheme } from '@/composables/useModuleTheme'
import { useCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { moduleDef } from '@/modules/registry'
import type { MenuGroup } from '@/modules/purchase/menu'
import { formatTime, formatTopBarDate } from '@/utils/format'
import DevUserSwitcher from './DevUserSwitcher.vue'
import PageSearch from './PageSearch.vue'

/**
 * Frame for every module screen except the module home (PoList.html): a floating icon rail with one icon per
 * menu group, a floating panel with that group's pages, and a floating top bar. Colours come from data-module.
 * Reads everything from route meta: module, menuGroup, menuItem, title, parent.
 */
const route = useRoute()
const router = useRouter()
const { today, now } = useSession()

const module = computed(() => moduleDef(route.meta.module))
useModuleTheme(() => module.value.key)
const group = computed(() => module.value.menu.find((g) => g.key === route.meta.menuGroup) ?? module.value.menu[0]!)
const { count: approvals } = useApprovalsCount(() => module.value)
const pageCrumb = useCrumb()

// The panel shows the current page's group; clicking that group's icon again folds it away for more room.
const openGroupKey = ref<string | null>(group.value.key)
watch(
  () => group.value.key,
  (key) => (openGroupKey.value = key),
)
const openGroup = computed(() => module.value.menu.find((g) => g.key === openGroupKey.value) ?? null)

function onGroupClick(g: MenuGroup) {
  if (openGroupKey.value === g.key) {
    openGroupKey.value = null
    return
  }
  openGroupKey.value = g.key
  if (g.key !== group.value.key) void router.push(g.to)
}

// Rail tooltips are teleported to body: the rail clips its overflow, which would cut them off.
const tip = ref<{ label: string; top: number } | null>(null)
function showTip(event: Event, label: string) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tip.value = { label, top: rect.top + rect.height / 2 }
}
function hideTip() {
  tip.value = null
}

// Breadcrumb: Home › group › list title, or Home › list › document (pages may set the last crumb).
const crumbs = computed(() => {
  const items: { label: string; to?: string }[] = [{ label: 'Home', to: module.value.home }]
  if (route.meta.parent) {
    items.push({ label: route.meta.parent.title, to: route.meta.parent.to })
  } else if (route.meta.code !== 'P02') {
    items.push({ label: group.value.title })
  }
  items.push({ label: pageCrumb.value ?? route.meta.title ?? '' })
  return items
})

const clock = ref(formatTime(now()))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (clock.value = formatTime(now())), 15_000)
})
onBeforeUnmount(() => clearInterval(timer))

const railButton = 'mx-auto flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200'
const railIdle = 'text-erp-on-dark/60 hover:bg-erp-on-dark/10 hover:text-erp-on-dark'
const railActive = 'bg-erp-on-dark/20 text-erp-on-dark ring-1 ring-erp-on-dark/10'
</script>

<template>
  <div :data-module="module.key" class="min-h-screen bg-erp-bg">
    <!-- Floating icon rail: one icon per menu group -->
    <nav
      :aria-label="`${module.label} menu`"
      class="fixed top-3 bottom-3 left-3 z-40 flex w-14 flex-col overflow-hidden rounded-2xl border border-erp-on-dark/5 bg-mod-side text-erp-on-dark shadow-2xl"
    >
      <div class="flex justify-center py-3">
        <RouterLink
          to="/"
          aria-label="All modules"
          :class="[railButton, railIdle]"
          @mouseenter="showTip($event, 'All modules')"
          @mouseleave="hideTip"
          @focus="showTip($event, 'All modules')"
          @blur="hideTip"
        >
          <LayoutGrid :size="18" aria-hidden="true" />
        </RouterLink>
      </div>

      <div class="mx-3 border-t border-erp-on-dark/10" />

      <ul class="m-0 flex flex-1 list-none flex-col gap-1 overflow-y-auto p-0 py-2">
        <li v-for="g in module.menu" :key="g.key">
          <button
            type="button"
            :aria-label="g.title"
            :aria-expanded="openGroupKey === g.key"
            :class="[railButton, 'border-0', openGroupKey === g.key || (!openGroupKey && group.key === g.key) ? railActive : `bg-transparent ${railIdle}`]"
            @click="onGroupClick(g)"
            @mouseenter="showTip($event, g.title)"
            @mouseleave="hideTip"
            @focus="showTip($event, g.title)"
            @blur="hideTip"
          >
            <component :is="g.icon" :size="20" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <div class="mx-3 border-t border-erp-on-dark/10" />

      <div class="flex flex-col gap-1 py-3">
        <RouterLink
          :to="module.home"
          :aria-label="`${module.label} home`"
          :class="[railButton, railIdle]"
          @mouseenter="showTip($event, `${module.label} home`)"
          @mouseleave="hideTip"
          @focus="showTip($event, `${module.label} home`)"
          @blur="hideTip"
        >
          <House :size="18" aria-hidden="true" />
        </RouterLink>
        <RouterLink
          to="/"
          aria-label="Sign out"
          :class="[railButton, railIdle]"
          @mouseenter="showTip($event, 'Sign out')"
          @mouseleave="hideTip"
          @focus="showTip($event, 'Sign out')"
          @blur="hideTip"
        >
          <LogOut :size="18" class="rotate-180" aria-hidden="true" />
        </RouterLink>
      </div>
    </nav>

    <Teleport to="body">
      <div
        v-if="tip"
        class="pointer-events-none fixed left-[76px] z-[60] -translate-y-1/2 rounded-md border border-erp-on-dark/10 bg-brand-dark px-2.5 py-1.5 text-xs whitespace-nowrap text-erp-on-dark shadow-lg"
        :style="{ top: `${tip.top}px` }"
      >
        {{ tip.label }}
      </div>
    </Teleport>

    <!-- Floating panel: pages of the open group -->
    <aside
      class="fixed top-3 bottom-3 left-[76px] z-30 flex w-[210px] flex-col overflow-hidden rounded-2xl border border-erp-border bg-erp-card shadow-sm transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      :class="openGroup ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-4 opacity-0'"
      :aria-hidden="!openGroup"
    >
      <Transition name="swap" mode="out-in">
        <div v-if="openGroup" :key="openGroup.key" class="flex min-h-0 flex-1 flex-col">
          <div class="border-b border-erp-row px-4 py-3">
            <p class="m-0 mb-0.5 text-[10px] font-semibold tracking-widest text-erp-muted uppercase">{{ module.label }}</p>
            <h2 class="m-0 text-sm leading-tight font-semibold text-erp-text">{{ openGroup.title }}</h2>
          </div>
          <ul class="m-0 flex flex-1 list-none flex-col gap-0.5 overflow-y-auto px-2 py-2">
            <li v-for="item in openGroup.items" :key="item.key">
              <RouterLink
                :to="item.to"
                class="group flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150"
                :class="
                  route.meta.menuItem === item.key
                    ? 'bg-mod-light font-semibold text-mod-primary'
                    : 'text-erp-subtle hover:bg-erp-head hover:text-erp-text'
                "
                :aria-current="route.meta.menuItem === item.key ? 'page' : undefined"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="route.meta.menuItem === item.key ? 'bg-mod-primary' : 'bg-erp-input group-hover:bg-erp-muted'"
                  aria-hidden="true"
                />
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </Transition>
    </aside>

    <div
      class="flex min-h-screen min-w-0 flex-col transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      :class="openGroup ? 'ml-[286px]' : 'ml-[68px]'"
    >
      <!-- Floating top bar; the strip around it blurs content scrolling underneath -->
      <div class="sticky top-0 z-20 px-4 pt-3 pb-2 backdrop-blur-sm md:px-6">
        <header class="flex h-12 items-center gap-4 rounded-2xl border border-erp-border bg-erp-card/95 px-5 shadow-sm">
          <div class="w-[180px] shrink-0 truncate text-xs font-medium text-erp-muted">{{ today ? formatTopBarDate(today) : '' }}</div>
          <div class="flex grow justify-center"><PageSearch :module="module" /></div>
          <div class="flex shrink-0 items-center gap-4">
            <RouterLink
              v-if="module.approvalsTo"
              :to="module.approvalsTo"
              :aria-label="`Approvals, ${approvals ?? 0} waiting`"
              class="flex items-center gap-1.5 text-[13px] font-semibold text-mod-chip-text"
            >
              <Bell :size="16" aria-hidden="true" />Approvals
              <span v-if="approvals" class="rounded-[10px] bg-mod-side px-[7px] py-px text-[11px] font-bold text-erp-on-dark">{{ approvals }}</span>
            </RouterLink>
            <div class="erp-num text-xs text-erp-muted">{{ clock }}</div>
            <div class="h-4 w-px bg-erp-border" aria-hidden="true" />
            <DevUserSwitcher variant="module" />
          </div>
        </header>
      </div>

      <main class="flex min-h-0 grow flex-col gap-3.5 px-4 pt-2 pb-6 md:px-6">
        <div class="flex gap-1.5 text-xs text-erp-muted" aria-label="Breadcrumb">
          <template v-for="(crumb, i) in crumbs" :key="i">
            <span v-if="i > 0" aria-hidden="true">›</span>
            <RouterLink v-if="crumb.to" :to="crumb.to" class="erp-link">{{ crumb.label }}</RouterLink>
            <span v-else :class="{ 'font-medium text-erp-text': i === crumbs.length - 1 }">{{ crumb.label }}</span>
          </template>
        </div>
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* Panel content slides when switching group */
.swap-enter-active,
.swap-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.swap-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
