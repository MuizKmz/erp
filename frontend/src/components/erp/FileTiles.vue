<script setup lang="ts">
import { ref } from 'vue'
import { FileText, Image as ImageIcon } from '@lucide/vue'
import { openFile } from '@/api/http'

/**
 * Attached files as tiles (photos, a supplier letter, a receipt photo), opened in a new tab when clicked.
 * With `editable`, the last tile adds a file: the parent uploads it and adds it to `files`.
 */
const props = withDefaults(
  defineProps<{
    files: { id: string; fileName: string; mimeType: string; downloadUrl: string }[]
    editable?: boolean
    addLabel?: string
    accept?: string
    upload?: (file: File) => Promise<void>
  }>(),
  { editable: false, addLabel: '+ Add file', accept: 'image/*,application/pdf' },
)

const uploading = ref(false)
async function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.upload) return
  uploading.value = true
  try {
    await props.upload(file)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <button
      v-for="f in files"
      :key="f.id"
      type="button"
      class="flex h-[96px] w-[150px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-erp-input bg-erp-head px-2 text-xs text-erp-muted hover:text-erp-text"
      :title="`Open ${f.fileName}`"
      @click="openFile(f.downloadUrl)"
    >
      <ImageIcon v-if="f.mimeType.startsWith('image/')" :size="20" aria-hidden="true" />
      <FileText v-else :size="20" aria-hidden="true" />
      <span class="max-w-full truncate">{{ f.fileName }}</span>
    </button>
    <label
      v-if="editable && upload"
      class="flex h-[96px] w-[150px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-erp-input text-xs text-erp-muted hover:text-erp-text"
    >
      {{ uploading ? 'Uploading…' : addLabel }}
      <input type="file" :accept="accept" class="hidden" :disabled="uploading" @change="onChange" />
    </label>
    <p v-if="!files.length && !editable" class="m-0 text-[13px] text-erp-muted">No files.</p>
  </div>
</template>
