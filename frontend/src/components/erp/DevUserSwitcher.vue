<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'
import { roleLabel, useSession } from '@/composables/useSession'
import { initials } from '@/utils/format'

/**
 * Dev user switcher (AUTH_MODE=dev, sign-in off). Shows who you are; click to act as another seeded user — this is
 * how approvals are tested (e.g. Lim Mei Ying sends, Ahmad Zaki approves). The choice is kept in localStorage.
 *
 * variant: "module" = floating module top bar, "home" = white module home header, "launcher" = launcher top bar.
 */
const props = withDefaults(defineProps<{ variant?: 'module' | 'home' | 'launcher'; subtitle?: string }>(), {
  variant: 'module',
})

const { state, user, switchUser } = useSession()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const switching = ref(false)

const userInitials = computed(() => initials(user.value?.name ?? ''))

async function pick(code: string) {
  open.value = false
  switching.value = true
  try {
    await switchUser(code)
  } finally {
    switching.value = false
  }
}

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

const avatarClass = computed(
  () =>
    ({
      module: 'bg-mod-chip-bg text-mod-chip-text',
      home: 'bg-mod-chip-bg text-mod-chip-text',
      launcher: 'bg-launcher-avatar text-launcher-bar',
    })[props.variant],
)
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border-0 bg-transparent p-1 text-left font-[inherit] text-[13px] text-erp-text"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Dev user switcher: act as another user"
      @click="open = !open"
    >
      <template v-if="variant === 'home'">
        <span class="text-right leading-tight">
          <span class="block text-[13px] font-semibold">{{ user?.email }}</span>
          <span class="block text-xs text-erp-muted">{{ subtitle }}</span>
        </span>
      </template>
      <template v-else-if="variant === 'launcher'">
        <span class="text-xs">Welcome <strong>{{ user?.name }}</strong></span>
        <span class="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold" :class="avatarClass">{{ userInitials }}</span>
      </template>
      <template v-else>
        <span class="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold" :class="avatarClass">{{ userInitials }}</span>
        <span>{{ user?.email }}</span>
      </template>
      <ChevronDown :size="14" class="opacity-70" :class="{ 'animate-pulse': switching }" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-erp-border bg-erp-card text-erp-text shadow-lg"
    >
      <div class="border-b border-erp-row bg-erp-head px-4 py-2.5 text-xs text-erp-muted">
        <strong class="text-erp-text">Dev user switcher</strong> · sign-in is off. Act as:
      </div>
      <ul class="m-0 max-h-[420px] list-none overflow-y-auto p-1">
        <li v-for="u in state.users" :key="u.code">
          <button
            type="button"
            role="menuitemradio"
            :aria-checked="u.code === state.userCode"
            class="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] hover:bg-erp-head"
            @click="pick(u.code)"
          >
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-erp-track text-[11px] font-bold text-erp-subtle">
              {{ initials(u.name) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[13px] font-semibold">{{ u.name }}</span>
              <span class="block truncate text-xs text-erp-muted">
                {{ u.roles.map(roleLabel).join(', ') }}<template v-if="u.branchCodes.length === 1"> · {{ u.branchCodes[0] }}</template>
              </span>
            </span>
            <Check v-if="u.code === state.userCode" :size="16" class="text-mod-accent" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <div class="border-t border-erp-row p-1">
        <RouterLink to="/account" role="menuitem" class="block rounded-lg px-3 py-2 text-[13px] text-erp-text hover:bg-erp-head" @click="open = false">My account</RouterLink>
      </div>
    </div>
  </div>
</template>
