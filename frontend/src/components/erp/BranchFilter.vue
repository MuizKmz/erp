<script setup lang="ts">
import { useViewBranch } from '@/composables/useViewBranch'

/**
 * Picks one of the person's own branches for a home or a list ("All my branches" when empty). Hidden for someone with
 * a single branch. Lists keep the mockups' "Filter by branch" wording.
 */
withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), { placeholder: 'Filter by branch' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { branches, several } = useViewBranch()
</script>

<template>
  <select
    v-if="several"
    class="erp-input"
    aria-label="Filter by branch"
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option value="">{{ placeholder }}</option>
    <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
  </select>
</template>
