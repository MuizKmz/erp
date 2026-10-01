<script setup lang="ts">
/** A row of list filters, equal width (PoList.html). Put inputs/selects in the default slot. */
withDefaults(defineProps<{ columns?: number }>(), { columns: 4 })
</script>

<template>
  <div class="grid gap-3" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <slot />
  </div>
</template>
