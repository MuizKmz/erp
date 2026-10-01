<script setup lang="ts" generic="T extends { code: string; name: string }">
import { ref, watch } from 'vue'
import AutoComplete, { type AutoCompleteCompleteEvent } from 'primevue/autocomplete'

/**
 * Picks a code from Master Data (supplier, item, warehouse). Codes are never typed free: the value is only
 * set from a suggestion. Shows "CODE · Name" and searches as you type.
 */
const props = withDefaults(
  defineProps<{
    search: (q: string) => Promise<T[]>
    placeholder?: string
    invalid?: boolean
    inputId?: string
    /** What the box shows for the current value */
    display?: (item: T) => string
  }>(),
  { placeholder: 'Type a code or name', invalid: false },
)
const model = defineModel<T | null>({ default: null })
const emit = defineEmits<{ picked: [item: T] }>()

const suggestions = ref<T[]>([])
const text = ref<T | string | null>(model.value)
watch(model, (v) => (text.value = v))

const label = (item: T) => (props.display ? props.display(item) : `${item.code} · ${item.name}`)

async function complete(event: AutoCompleteCompleteEvent) {
  try {
    suggestions.value = await props.search(event.query)
  } catch {
    suggestions.value = []
  }
}

function onSelect(item: T) {
  model.value = item
  emit('picked', item)
}

// Leaving the box with free text puts the last picked value back (codes come from the list only).
function onBlur() {
  if (typeof text.value === 'string') text.value = model.value
}
</script>

<template>
  <AutoComplete
    v-model="text"
    :suggestions="suggestions"
    :option-label="(item: T) => label(item)"
    :placeholder="placeholder"
    :invalid="invalid"
    :input-id="inputId"
    force-selection
    complete-on-focus
    :delay="200"
    fluid
    class="erp-picker"
    @complete="complete"
    @option-select="onSelect($event.value as T)"
    @blur="onBlur"
  >
    <template #option="{ option }">
      <div class="flex flex-col">
        <span class="text-[13px]"><strong>{{ option.code }}</strong> · {{ option.name }}</span>
        <slot name="hint" :item="option as T" />
      </div>
    </template>
  </AutoComplete>
</template>
