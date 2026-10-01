<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import type { ModuleDef } from '@/modules/registry'

/** "Search pages, modules..." in the top bar: jumps to a menu page by name. */
const props = defineProps<{ module: ModuleDef }>()
const router = useRouter()
const query = ref('')
const focused = ref(false)

const pages = computed(() => [
  { label: `${props.module.label} home`, group: 'Module', to: props.module.home },
  { label: 'Approvals', group: 'Top bar', to: props.module.approvalsTo },
  { label: 'All modules', group: 'Launcher', to: '/' },
  ...props.module.menu.flatMap((g) => g.items.map((i) => ({ label: i.label, group: g.title, to: i.to }))),
])

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return pages.value.filter((p) => p.label.toLowerCase().includes(q) || p.group.toLowerCase().includes(q)).slice(0, 8)
})

function go(to: string) {
  query.value = ''
  void router.push(to)
}

function onEnter() {
  const first = results.value[0]
  if (first) go(first.to)
}
</script>

<template>
  <div class="relative w-[380px] max-w-full">
    <div class="flex h-[34px] items-center gap-2 rounded-full bg-mod-pill px-3.5">
      <Search :size="15" class="text-erp-on-dark" aria-hidden="true" />
      <input
        v-model="query"
        aria-label="Search pages and modules"
        placeholder="Search pages, modules..."
        class="min-w-0 flex-1 border-0 bg-transparent font-[inherit] text-[13px] text-erp-on-dark placeholder:text-erp-on-dark/60 outline-none"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="query = ''"
      />
    </div>
    <ul
      v-if="focused && results.length"
      class="absolute top-10 right-0 left-0 z-50 m-0 list-none overflow-hidden rounded-xl border border-erp-border bg-erp-card p-1 text-erp-text shadow-lg"
    >
      <li v-for="r in results" :key="r.to">
        <button
          type="button"
          class="flex w-full justify-between rounded-lg border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-[13px] hover:bg-erp-head"
          @mousedown.prevent="go(r.to)"
        >
          <span class="font-semibold">{{ r.label }}</span><span class="text-xs text-erp-muted">{{ r.group }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
