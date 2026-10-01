<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, Info, TriangleAlert } from 'lucide-vue-next'

/**
 * Info: policy hints (module colour). Warning: "Inventory is not connected yet…". Error: blocked actions.
 */
const props = withDefaults(defineProps<{ kind?: 'info' | 'warning' | 'error' }>(), { kind: 'info' })

const styles = computed(
  () =>
    ({
      info: { box: 'bg-mod-light border-mod-light-border text-erp-text', icon: Info, iconClass: 'text-mod-accent' },
      warning: { box: 'bg-note-warn-bg border-note-warn-border text-note-warn-text', icon: TriangleAlert, iconClass: 'text-note-warn-strong' },
      error: { box: 'bg-note-error-bg border-note-error-border text-note-error-text', icon: CircleAlert, iconClass: 'text-note-error-text' },
    })[props.kind],
)
</script>

<template>
  <div class="flex items-start gap-2.5 rounded-[10px] border px-3.5 py-[11px] text-[13px] leading-normal" :class="styles.box" role="status">
    <component :is="styles.icon" :size="16" class="mt-0.5 shrink-0" :class="styles.iconClass" aria-hidden="true" />
    <div class="min-w-0 flex-1"><slot /></div>
  </div>
</template>
