<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Building2, Check, ChevronDown } from '@lucide/vue'
import { useSession } from '@/composables/useSession'

/**
 * The active branch in the top bar (SRS FR-SEC-021, CfgCompany.html). New documents are stamped with it. Switching asks
 * the server for a new access token in sign-in mode, or sends x-branch in dev mode; pages then reload their data.
 */
const { state, switchBranch } = useSession()
const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const branches = computed(() => state.me?.branches ?? [])
const active = computed(() => branches.value.find((b) => b.code === state.me?.branchCode) ?? null)

async function pick(code: string) {
  open.value = false
  busy.value = true
  try {
    await switchBranch(code)
  } finally {
    busy.value = false
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
</script>

<template>
  <div v-if="active" ref="root" class="relative">
    <button
      type="button"
      class="flex h-[30px] items-center gap-1.5 rounded-full border border-erp-border bg-erp-card px-2.5 font-[inherit] text-xs font-semibold text-erp-text"
      :class="branches.length > 1 ? 'cursor-pointer' : 'cursor-default'"
      :aria-expanded="branches.length > 1 ? open : undefined"
      :aria-haspopup="branches.length > 1 ? 'menu' : undefined"
      :title="branches.length > 1 ? 'Switch the branch you work in' : 'The branch you work in'"
      @click="branches.length > 1 && (open = !open)"
    >
      <Building2 :size="13" class="text-erp-muted" aria-hidden="true" />
      {{ active.name }}
      <ChevronDown v-if="branches.length > 1" :size="12" class="text-erp-muted" :class="{ 'animate-pulse': busy }" aria-hidden="true" />
    </button>
    <div v-if="open" role="menu" class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-erp-border bg-erp-card shadow-lg">
      <div class="border-b border-erp-row bg-erp-head px-4 py-2.5 text-xs text-erp-muted">Work in branch · new documents carry it</div>
      <ul class="m-0 list-none p-1">
        <li v-for="b in branches" :key="b.code">
          <button
            type="button"
            role="menuitemradio"
            :aria-checked="b.code === active.code"
            class="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-[13px] hover:bg-erp-head"
            @click="pick(b.code)"
          >
            <span class="min-w-0 flex-1"><strong>{{ b.code }}</strong> · {{ b.name }}</span>
            <Check v-if="b.code === active.code" :size="16" class="text-mod-accent" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
