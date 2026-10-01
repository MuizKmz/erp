<script setup lang="ts">
/** A card in a document's right panel: title, optional chip on the right, content. */
defineProps<{ title: string }>()
</script>

<template>
  <section class="erp-card flex flex-col gap-2.5 px-5 py-[18px]">
    <div class="flex items-center justify-between gap-3">
      <h2 class="m-0 text-[15px] font-bold">{{ title }}</h2>
      <slot name="chip" />
    </div>
    <slot />
  </section>
</template>
