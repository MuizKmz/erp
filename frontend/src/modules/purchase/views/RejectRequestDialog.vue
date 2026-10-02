<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import { requestsApi } from '../api/purchase'
import type { RequestDetail } from '../types'

/** Reject a purchase request (FlowP1 step 4). The reason is required and shown to the requester. */
const props = defineProps<{ requestId: string; docNo: string; requester: string; version: number }>()
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ rejected: [request: RequestDetail] }>()
const toast = useToast()

const reason = ref('')
const error = ref('')
const sending = ref(false)
watch(visible, (open) => {
  if (open) {
    reason.value = ''
    error.value = ''
  }
})

async function reject() {
  if (!reason.value.trim()) {
    error.value = `Tell ${props.requester} why, so they know what to do next.`
    return
  }
  sending.value = true
  try {
    const result = await requestsApi.reject(props.requestId, props.version, reason.value.trim())
    toast.add({ severity: 'success', summary: `${props.docNo} rejected`, detail: `${props.requester} sees the reason on the request.`, life: 4000 })
    visible.value = false
    emit('rejected', result)
  } catch (e) {
    if (e instanceof ApiError) error.value = e.fieldErrors.reason ?? ''
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '520px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">Reject {{ docNo }}</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">The request is closed. {{ requester }} can raise a new one if it is still needed.</p>
      </div>
    </template>
    <FormField label="Reason" :error="error" for="reject-reason">
      <textarea
        id="reject-reason"
        v-model="reason"
        class="erp-input min-h-24 py-2"
        maxlength="1000"
        placeholder="e.g. No budget this month, or we already have stock in Penang"
      />
    </FormField>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span class="text-xs text-erp-muted">{{ requester }} sees the reason on the request.</span>
        <div class="flex gap-2">
          <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
          <button type="button" class="erp-btn erp-btn-delete" :disabled="sending" @click="reject">Reject request</button>
        </div>
      </div>
    </template>
  </Dialog>
</template>
