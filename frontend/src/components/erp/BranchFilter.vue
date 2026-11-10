<script setup lang="ts">
import { useViewBranch } from '@/composables/useViewBranch'

/**
 * Narrows one list to one of the person's own branches. Shown only while the top bar shows all their branches (hidden
 * for someone with a single branch, and when the top bar already shows one). Lists keep the mockups' wording.
 */
withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), { placeholder: 'Filter by branch' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { branches, canFilter } = useViewBranch()
</script>

<template>
  <select
    v-if="canFilter"
    class="erp-input"
    aria-label="Filter by branch"
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option value="">{{ placeholder }}</option>
    <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
  </select>
</template>
