<script setup lang="ts">
/** A labelled field: 12px label above, the input in the slot, the server's validation message below. */
defineProps<{ label: string; error?: string | null; for?: string }>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
    <label :for="$props.for">{{ label }}</label>
    <slot />
    <span v-if="error" class="text-xs font-medium text-note-error-text" role="alert">{{ error }}</span>
  </div>
</template>
