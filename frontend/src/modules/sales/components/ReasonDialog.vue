<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'

/** Asks for a short reason before an action that needs one ("Mark as lost"). */
const props = withDefaults(defineProps<{ title: string; message?: string; label?: string; confirmLabel?: string; danger?: boolean; busy?: boolean }>(), {
  message: '',
  label: 'Reason',
  confirmLabel: 'Confirm',
  danger: false,
  busy: false,
})
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ confirm: [reason: string] }>()

const reason = ref('')
const error = ref('')
watch(visible, (open) => {
  if (open) {
    reason.value = ''
    error.value = ''
  }
})

function confirm() {
  if (!reason.value.trim()) {
    error.value = `Please fill in: ${props.label.toLowerCase()}.`
    return
  }
  emit('confirm', reason.value.trim())
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '460px' }" :header="title">
    <div class="flex flex-col gap-3">
      <p v-if="message" class="m-0 text-[13px] text-erp-subtle">{{ message }}</p>
      <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted" for="reason-text">
        {{ label }}
        <textarea id="reason-text" v-model="reason" rows="3" class="erp-input h-auto py-2 text-[13px] text-erp-text" maxlength="200" :aria-invalid="Boolean(error)" />
        <span v-if="error" class="text-note-error-text" role="alert">{{ error }}</span>
      </label>
    </div>
    <template #footer>
      <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
      <button type="button" class="erp-btn" :class="danger ? 'erp-btn-danger' : 'erp-btn-primary'" :disabled="busy" @click="confirm">{{ confirmLabel }}</button>
    </template>
  </Dialog>
</template>
