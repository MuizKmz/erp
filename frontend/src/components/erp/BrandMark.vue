<script setup lang="ts">
/** The Zora Pro ERP logo (the same image as the WMS), in the launcher, module homes, sign-in and no-access pages. */
withDefaults(defineProps<{ size?: number }>(), { size: 36 })
</script>

<template>
  <img
    src="/zora-logo.png"
    alt=""
    aria-hidden="true"
    class="shrink-0 rounded-lg object-cover shadow-sm"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>
