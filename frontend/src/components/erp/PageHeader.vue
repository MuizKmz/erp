<script setup lang="ts">
/**
 * Title row of a page. Lists: 18px title + one-line description. Documents: 20px title with the number and
 * status chip (slot "chip"), the line below names the supplier and where it came from. Actions on the right;
 * only one filled module-colour button per screen.
 */
withDefaults(defineProps<{ title: string; subtitle?: string; document?: boolean }>(), { document: false })
</script>

<template>
  <div class="flex items-end justify-between gap-4">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2.5">
        <h1 class="m-0 font-bold" :class="document ? 'text-xl' : 'text-lg'">{{ title }}</h1>
        <slot name="chip" />
      </div>
      <p v-if="subtitle || $slots.subtitle" class="mt-1 mb-0 text-xs text-erp-muted">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
