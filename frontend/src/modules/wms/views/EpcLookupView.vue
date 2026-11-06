<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from '@lucide/vue'
import { ApiError } from '@/api/http'
import StatusChip from '@/components/erp/StatusChip.vue'
import { formatDateTime } from '@/utils/format'
import { wmsApi } from '../api/wms'
import WmsPage from '../components/WmsPage.vue'
import type { EpcAnswer } from '../types'

/** W03 · EPC Lookup (WmsEpcLookup.html). The code stays in the URL, so Back and Refresh keep the tag. */
const route = useRoute()
const router = useRouter()

const text = ref('')
const tag = ref<EpcAnswer | null>(null)
const notFound = ref('')
const failed = ref(false)
const busy = ref(false)
const code = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))

async function load(value: string) {
  tag.value = null
  notFound.value = ''
  failed.value = false
  if (!value) return
  busy.value = true
  try {
    tag.value = await wmsApi.epc(value)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound.value = `No tag found for ${value}. Check the EPC or serial number.`
    else failed.value = true
  } finally {
    busy.value = false
  }
}
watch(code, (value) => {
  text.value = value
  void load(value)
}, { immediate: true })

function lookUp() {
  const value = text.value.trim()
  if (value === code.value) void load(value)
  else void router.replace({ query: value ? { code: value } : {} })
}
const place = computed(() => [tag.value?.location, tag.value?.rack].filter(Boolean).join(' · ') || '—')
const QUALITY: Record<string, string> = { GOOD: 'Good', DAMAGE: 'Damaged', QUARANTINE: 'Quarantine' }
</script>

<template>
  <WmsPage title="EPC Lookup" subtitle="Scan or type one RFID tag to see where it is and what happened to it." :source="tag?.source" :failed="failed">
    <form class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted" @submit.prevent="lookUp">
      <label for="epc-code">EPC or serial number</label>
      <span class="flex gap-2">
        <input id="epc-code" v-model="text" class="erp-input grow font-mono" autofocus autocomplete="off" />
        <button type="submit" class="erp-btn erp-btn-secondary" :disabled="busy"><Search :size="14" aria-hidden="true" />Look up</button>
      </span>
    </form>
    <span v-if="notFound" class="text-[13px] text-note-error-text" role="alert">{{ notFound }}</span>

    <div v-if="tag" class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-4">
      <div class="rounded-xl border border-erp-border p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="m-0 text-[15px] font-bold">This tag</h2>
          <StatusChip :status="tag.status" :label="tag.statusLabel" :group="tag.statusGroup" />
        </div>
        <dl class="m-0 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          <dt class="text-erp-muted">Serial number</dt><dd class="m-0 font-mono">{{ tag.serialNumber ?? '—' }}</dd>
          <dt class="text-erp-muted">EPC</dt><dd class="m-0 font-mono">{{ tag.epcCode }}</dd>
          <dt class="text-erp-muted">Item</dt><dd class="m-0 font-medium"><strong>{{ tag.itemCode ?? '—' }}</strong><template v-if="tag.itemName"> · {{ tag.itemName }}</template></dd>
          <dt class="text-erp-muted">Batch</dt><dd class="m-0 font-medium">{{ tag.batch ?? '—' }}</dd>
          <dt class="text-erp-muted">Warehouse</dt><dd class="m-0 font-medium">{{ tag.warehouse ?? '—' }}</dd>
          <dt class="text-erp-muted">Location and rack</dt><dd class="m-0 font-medium">{{ place }}</dd>
          <dt class="text-erp-muted">Quality</dt><dd class="m-0 font-medium">{{ tag.quality ? (QUALITY[tag.quality] ?? tag.quality) : '—' }}</dd>
          <dt class="text-erp-muted">Available for sale</dt><dd class="m-0 font-medium">{{ tag.availableForSale ? 'Yes' : 'No' }}</dd>
          <dt class="text-erp-muted">Reserved for order</dt><dd class="m-0 font-medium">{{ tag.reservedForOrder ?? 'None' }}</dd>
        </dl>
      </div>
      <div class="rounded-xl border border-erp-border p-4">
        <h2 class="m-0 mb-3 text-[15px] font-bold">What happened</h2>
        <ol class="m-0 flex list-none flex-col gap-3.5 p-0">
          <li v-for="e in tag.events" :key="e.what" class="grid grid-cols-[14px_1fr] gap-2.5 text-[13px]">
            <span class="mt-1 size-2.5 rounded-full" :class="e.when ? 'bg-mod-line' : 'bg-erp-input'" aria-hidden="true" />
            <span>
              <span class="block font-semibold" :class="{ 'text-erp-muted': !e.when }">{{ e.what }}</span>
              <span class="block text-xs text-erp-muted">{{ e.when ? formatDateTime(e.when) : 'Not yet' }}<template v-if="e.when && e.detail"> · {{ e.detail }}</template></span>
            </span>
          </li>
        </ol>
        <p class="mt-3 mb-0 text-xs text-erp-muted">The WMS keeps these dates, not every scan.</p>
      </div>
    </div>
  </WmsPage>
</template>
