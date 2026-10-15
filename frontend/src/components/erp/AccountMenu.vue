<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, LogOut, UserRound } from '@lucide/vue'
import { useSession } from '@/composables/useSession'
import { initials } from '@/utils/format'
import DevUserSwitcher from './DevUserSwitcher.vue'

/**
 * Who you are, in every top bar (choice 20). Sign-in mode: a menu with My account and Sign out. Dev mode: the Dev user
 * switcher, as before.
 *
 * variant: "module" = floating module top bar, "home" = white module home header, "launcher" = launcher top bar.
 */
const props = withDefaults(defineProps<{ variant?: 'module' | 'home' | 'launcher'; subtitle?: string }>(), { variant: 'module' })

const router = useRouter()
const { isJwt, user, signOut } = useSession()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const userInitials = computed(() => initials(user.value?.name ?? ''))
const avatarClass = computed(() => (props.variant === 'launcher' ? 'bg-launcher-avatar text-launcher-bar' : 'bg-mod-chip-bg text-mod-chip-text'))

async function leave() {
  open.value = false
  await signOut()
  await router.push('/sign-in')
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
</script>

<template>
  <DevUserSwitcher v-if="!isJwt" :variant="variant" :subtitle="subtitle" />
  <div v-else ref="root" class="relative">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border-0 bg-transparent p-1 text-left font-[inherit] text-[13px] text-erp-text"
      :aria-expanded="open"
      aria-haspopup="menu"
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
      <ChevronDown :size="14" class="opacity-70" aria-hidden="true" />
    </button>

    <div v-if="open" role="menu" class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-erp-border bg-erp-card text-erp-text shadow-lg">
      <div class="border-b border-erp-row bg-erp-head px-4 py-2.5 text-xs text-erp-muted">
        Signed in as <strong class="text-erp-text">{{ user?.name }}</strong> ({{ user?.code }})
      </div>
      <div class="flex flex-col p-1">
        <RouterLink to="/account" role="menuitem" class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-erp-text hover:bg-erp-head" @click="open = false">
          <UserRound :size="15" aria-hidden="true" />My account
        </RouterLink>
        <button type="button" role="menuitem" class="flex items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-[13px] text-erp-text hover:bg-erp-head" @click="leave">
          <LogOut :size="15" class="rotate-180" aria-hidden="true" />Sign out
        </button>
      </div>
    </div>
  </div>
</template>
