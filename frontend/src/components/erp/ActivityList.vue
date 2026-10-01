<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime } from '@/utils/format'

/** "Activity": who did what, oldest first like the mockups, comments under the line. */
const props = defineProps<{
  items: { id: string; message: string; comment: string | null; userName: string; at: string }[]
}>()
const ordered = computed(() => [...props.items].sort((a, b) => a.at.localeCompare(b.at)))
</script>

<template>
  <section class="erp-card flex flex-col px-5 py-[18px]">
    <h2 class="m-0 mb-1.5 text-[15px] font-bold">Activity</h2>
    <p v-if="!ordered.length" class="m-0 text-[13px] text-erp-muted">Nothing yet.</p>
    <div v-for="e in ordered" :key="e.id" class="flex gap-3 border-b border-erp-row py-2 text-[13px] last:border-b-0">
      <time class="w-[124px] shrink-0 text-xs text-erp-muted" :datetime="e.at">{{ formatDateTime(e.at) }}</time>
      <div class="min-w-0">
        <div>{{ e.message }}</div>
        <div v-if="e.comment" class="mt-0.5 text-xs whitespace-pre-line text-erp-muted">“{{ e.comment }}”</div>
      </div>
    </div>
  </section>
</template>
