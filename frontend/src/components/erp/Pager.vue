<script setup lang="ts">
import { computed } from 'vue'

/** "‹ 1 2 3 ›" under a list. Shows at most 7 page buttons around the current page. */
const props = defineProps<{ page: number; pageSize: number; total: number }>()
const emit = defineEmits<{ change: [page: number] }>()

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const visible = computed(() => {
  const start = Math.max(1, Math.min(props.page - 3, pages.value - 6))
  return Array.from({ length: Math.min(7, pages.value) }, (_, i) => start + i)
})

function go(page: number) {
  if (page >= 1 && page <= pages.value && page !== props.page) emit('change', page)
}
</script>

<template>
  <nav class="flex items-center gap-1.5" aria-label="Pages">
    <button type="button" class="erp-page" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)">‹</button>
    <button
      v-for="n in visible"
      :key="n"
      type="button"
      class="erp-page"
      :class="{ 'erp-page-on': n === page }"
      :aria-current="n === page ? 'page' : undefined"
      @click="go(n)"
    >
      {{ n }}
    </button>
    <button type="button" class="erp-page" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)">›</button>
  </nav>
</template>

<style scoped>
.erp-page {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--erp-input-border);
  background: var(--erp-card);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--erp-text);
}
.erp-page:disabled {
  opacity: 0.5;
  cursor: default;
}
.erp-page-on {
  background: var(--erp-text);
  border-color: var(--erp-text);
  color: var(--erp-on-dark);
}
</style>
