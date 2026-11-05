<script setup lang="ts">
/**
 * One filter of a report's filter row, read as "Branch: all" or "Branch: HQ Shah Alam" (SalesReports.html).
 * Without `all`, one of the options is always picked.
 */
defineProps<{ label: string; modelValue: string; options: { value: string; label: string }[]; all?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <select class="erp-input" :aria-label="label" :value="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
    <option v-if="all !== undefined" value="">{{ label }}: {{ all }}</option>
    <option v-for="o in options" :key="o.value" :value="o.value">{{ label }}: {{ o.label }}</option>
  </select>
</template>
