<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy, Download } from '@lucide/vue'

/** The 8 recovery codes, shown once (A03 set-up, A11 My account): to copy or save as a text file. */
const props = defineProps<{ codes: readonly string[]; name: string }>()

const copied = ref(false)
const text = () => `Zora Pro ERP recovery codes (${props.name})\nEach one signs you in once.\n\n${props.codes.join('\n')}\n`

async function copy() {
  try {
    await navigator.clipboard.writeText(text())
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* clipboard blocked: the codes stay on screen to write down */
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `zora-recovery-codes-${props.name.toLowerCase()}.txt`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <ul class="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 rounded-[10px] border border-erp-border bg-erp-bg px-5 py-4 font-mono text-sm font-bold tracking-wider" aria-label="Recovery codes">
      <li v-for="c in codes" :key="c" class="select-all">{{ c }}</li>
    </ul>
    <div class="flex gap-2">
      <button type="button" class="erp-btn erp-btn-secondary" @click="copy">
        <component :is="copied ? Check : Copy" :size="14" aria-hidden="true" />{{ copied ? 'Copied' : 'Copy' }}
      </button>
      <button type="button" class="erp-btn erp-btn-secondary" @click="download"><Download :size="14" aria-hidden="true" />Save as a file</button>
    </div>
  </div>
</template>
