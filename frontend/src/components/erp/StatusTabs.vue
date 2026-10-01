<script setup lang="ts">
/** "All · 11  Draft · 2  Pending approval · 1 …" — the status tabs of a list, counts from statusCounts. */
defineProps<{
  tabs: { key: string; label: string; hideWhenEmpty?: boolean }[]
  counts: Record<string, number> | null | undefined
  active: string
}>()
defineEmits<{ select: [key: string] }>()
</script>

<template>
  <div class="flex flex-wrap gap-6 border-b border-erp-border" role="tablist">
    <template v-for="tab in tabs" :key="tab.key">
      <button
        v-if="!tab.hideWhenEmpty || (counts?.[tab.key] ?? 0) > 0"
        type="button"
        role="tab"
        :aria-selected="active === tab.key"
        class="-mb-px border-0 border-b-2 border-solid bg-transparent px-0 pb-2.5 font-[inherit] text-[13px] font-semibold whitespace-nowrap"
        :class="active === tab.key ? 'border-mod-line text-mod-accent' : 'border-transparent text-erp-muted hover:text-erp-text'"
        @click="$emit('select', tab.key)"
      >
        {{ tab.label }} · {{ counts?.[tab.key] ?? 0 }}
      </button>
    </template>
  </div>
</template>
