<script setup lang="ts">
/** On/off switch as in the Operation Policies mockups. */
defineProps<{ label: string; disabled?: boolean }>()
const on = defineModel<boolean>({ required: true })
</script>

<template>
  <button type="button" role="switch" class="erp-switch" :class="{ on }" :aria-checked="on" :aria-label="label" :disabled="disabled" @click="on = !on"><i /></button>
</template>
