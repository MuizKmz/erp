<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Building2, Check, ChevronDown } from '@lucide/vue'
import { useSession } from '@/composables/useSession'

/**
 * The branch in the top bar (SRS FR-SEC-021, CfgCompany.html): what every home, list and report shows, and where new
 * documents go. "All my branches" adds the person's branches together; new documents then go to their default branch.
 * One branch narrows everything to it and new documents carry it. Pages reload their data after a switch.
 */
const { state, switchBranch, showAllBranches } = useSession()
const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const branches = computed(() => state.me?.branches ?? [])
const active = computed(() => branches.value.find((b) => b.code === state.me?.branchCode) ?? null)

const several = computed(() => branches.value.length > 1)
const showingAll = computed(() => several.value && state.viewAll)

async function pick(code: string | null) {
  open.value = false
  busy.value = true
  try {
    await (code ? switchBranch(code) : showAllBranches())
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
      :class="several ? 'cursor-pointer' : 'cursor-default'"
      :aria-expanded="several ? open : undefined"
      :aria-haspopup="several ? 'menu' : undefined"
      :title="several ? (showingAll ? `Showing all your branches · new documents go to ${active.name}` : 'Showing and working in this branch') : 'The branch you work in'"
      @click="several && (open = !open)"
    >
      <Building2 :size="13" class="text-erp-muted" aria-hidden="true" />
      {{ showingAll ? 'All my branches' : active.name }}
      <ChevronDown v-if="several" :size="12" class="text-erp-muted" :class="{ 'animate-pulse': busy }" aria-hidden="true" />
    </button>
    <div v-if="open" role="menu" class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-erp-border bg-erp-card shadow-lg">
      <div class="border-b border-erp-row bg-erp-head px-4 py-2.5 text-xs text-erp-muted">Show and work in · new documents carry the branch</div>
      <ul class="m-0 list-none p-1">
        <li>
          <button
            type="button"
            role="menuitemradio"
            :aria-checked="showingAll"
            class="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-[13px] hover:bg-erp-head"
            @click="pick(null)"
          >
            <span class="min-w-0 flex-1">
              <strong>All my branches</strong>
              <span class="block text-xs text-erp-muted">New documents go to {{ branches[0]?.name }}</span>
            </span>
            <Check v-if="showingAll" :size="16" class="text-mod-accent" aria-hidden="true" />
          </button>
        </li>
        <li class="mx-2 my-1 border-t border-erp-row" role="separator"></li>
        <li v-for="b in branches" :key="b.code">
          <button
            type="button"
            role="menuitemradio"
            :aria-checked="!showingAll && b.code === active.code"
            class="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-[13px] hover:bg-erp-head"
            @click="pick(b.code)"
          >
            <span class="min-w-0 flex-1"><strong>{{ b.code }}</strong> · {{ b.name }}</span>
            <Check v-if="!showingAll && b.code === active.code" :size="16" class="text-mod-accent" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
