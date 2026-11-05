<script setup lang="ts">
import { Clock } from '@lucide/vue'
import { useToast } from 'primevue/usetoast'

/**
 * The actions of a report (SalesReports.html): schedule by email (comes later), PDF through the browser's own print,
 * and Export to Excel, which the page builds from what it shows.
 */
defineProps<{ canExport: boolean }>()
const emit = defineEmits<{ export: [] }>()
const toast = useToast()

const schedule = () => toast.add({ severity: 'info', summary: 'Schedule email', detail: 'This comes later with scheduled reports.', life: 3000 })
const print = () => window.print()
</script>

<template>
  <button type="button" class="erp-btn erp-btn-secondary" @click="schedule"><Clock :size="14" aria-hidden="true" />Schedule email</button>
  <button type="button" class="erp-btn erp-btn-secondary" @click="print">PDF</button>
  <button type="button" class="erp-btn erp-btn-export" :disabled="!canExport" @click="emit('export')">Export to Excel</button>
</template>
