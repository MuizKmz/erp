<script setup lang="ts">
/**
 * A card of numbered steps ("Next step for the buyer", "When you award"). Put each step in an <li> with its
 * text wrapped in one element: <li><span><strong>Order directly</strong> from …</span></li>.
 * Extra content (a link, totals) goes in the "footer" slot.
 */
defineProps<{ title: string }>()
</script>

<template>
  <section class="erp-card flex flex-col gap-3 px-5 py-4">
    <h2 class="m-0 text-[15px] font-bold">{{ title }}</h2>
    <ol class="erp-steps">
      <slot />
    </ol>
    <slot name="footer" />
  </section>
</template>
