<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Bell, House, LogOut } from 'lucide-vue-next'
import { useApprovalsCount } from '@/composables/useApprovalsCount'
import { useSession } from '@/composables/useSession'
import { moduleDef } from '@/modules/registry'
import { formatTime, formatTopBarDate } from '@/utils/format'
import DevUserSwitcher from './DevUserSwitcher.vue'
import PageSearch from './PageSearch.vue'

/**
 * Sidebar + top bar + breadcrumb for every module screen except the module home (PoList.html).
 * The sidebar shows the menu group of the current page; colours come from data-module.
 * Reads everything from route meta: module, menuGroup, menuItem, title, parent.
 */
const route = useRoute()
const { today, now } = useSession()

const module = computed(() => moduleDef(route.meta.module))
const group = computed(() => module.value.menu.find((g) => g.key === route.meta.menuGroup) ?? module.value.menu[0]!)
const { count: approvals } = useApprovalsCount(() => module.value)

// Breadcrumb: Home › group › list title, or Home › list › document (pages may set the last crumb).
const crumbs = computed(() => {
  const items: { label: string; to?: string }[] = [{ label: 'Home', to: module.value.home }]
  if (route.meta.parent) {
    items.push({ label: route.meta.parent.title, to: route.meta.parent.to })
  } else if (route.meta.code !== 'P02') {
    items.push({ label: group.value.title })
  }
  items.push({ label: route.meta.title ?? '' })
  return items
})

const clock = ref(formatTime(now()))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (clock.value = formatTime(now())), 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div :data-module="module.key" class="flex min-h-screen bg-erp-bg">
    <nav
      :aria-label="group.title"
      class="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col gap-1 bg-mod-side px-3 py-5"
    >
      <div class="flex flex-col items-center gap-2.5 pt-1 pb-[18px]">
        <div class="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-erp-on-dark">
          <component :is="group.icon" :size="26" class="text-mod-side" aria-hidden="true" />
        </div>
        <div class="text-center text-[15px] font-bold text-erp-on-dark">{{ group.title }}</div>
      </div>

      <RouterLink
        v-for="item in group.items"
        :key="item.key"
        :to="item.to"
        class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium whitespace-nowrap text-erp-on-dark hover:bg-mod-hover"
        :class="{ '!bg-mod-active font-bold': route.meta.menuItem === item.key }"
        :aria-current="route.meta.menuItem === item.key ? 'page' : undefined"
      >
        <component :is="item.icon" :size="16" aria-hidden="true" />{{ item.label }}
      </RouterLink>

      <div class="grow" />

      <RouterLink
        :to="module.home"
        class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium text-erp-on-dark hover:bg-mod-hover"
      >
        <House :size="16" aria-hidden="true" />{{ module.label }} home
      </RouterLink>
      <RouterLink to="/" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium text-erp-on-dark hover:bg-mod-hover">
        <LogOut :size="16" class="rotate-180" aria-hidden="true" />Sign out
      </RouterLink>
    </nav>

    <div class="flex min-w-0 grow flex-col">
      <header class="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-5 bg-mod-side px-6 text-erp-on-dark">
        <div class="w-[200px] text-[13px] font-semibold">{{ today ? formatTopBarDate(today) : '' }}</div>
        <div class="flex grow justify-center"><PageSearch :module="module" /></div>
        <RouterLink
          :to="module.approvalsTo"
          :aria-label="`Approvals, ${approvals ?? 0} waiting`"
          class="flex items-center gap-1.5 text-[13px] font-semibold text-erp-on-dark"
        >
          <Bell :size="17" aria-hidden="true" />Approvals
          <span v-if="approvals" class="rounded-[10px] bg-erp-on-dark px-[7px] py-px text-[11px] font-bold text-mod-accent">{{ approvals }}</span>
        </RouterLink>
        <div class="text-[13px] erp-num">{{ clock }}</div>
        <DevUserSwitcher variant="module" />
      </header>

      <main class="flex min-h-0 grow flex-col gap-3.5 px-7 pt-[18px] pb-6">
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
