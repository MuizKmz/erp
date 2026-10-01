<script setup lang="ts">
import { computed } from 'vue'
import { formatQty, percentOf } from '@/utils/format'

/** A thin bar and "95 / 100" — received or billed against ordered. */
const props = withDefaults(defineProps<{ done: string; total: string; width?: string; showBar?: boolean }>(), {
  width: '64px',
  showBar: true,
})
const percent = computed(() => percentOf(props.done, props.total))
</script>

<template>
  <span class="inline-flex items-center gap-2 erp-num">
    <span v-if="showBar" class="inline-block h-1.5 overflow-hidden rounded-[3px] bg-erp-track" :style="{ width }" aria-hidden="true">
      <span class="block h-1.5 bg-mod-side" :style="{ width: `${percent}%` }" />
    </span>
    <span>{{ formatQty(done) }} / {{ formatQty(total) }}</span>
  </span>
</template>
