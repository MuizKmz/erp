<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { ApiError } from '@/api/http'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { formatPrice, formatQty } from '@/utils/format'
import { lookupsApi, requestsApi } from '../api/purchase'
import type { RequestDetail, SupplierOption } from '../types'

/**
 * "Create PO directly" (FlowP1 step 6): the buyer confirms the supplier of each line — the preferred supplier to
 * start with — and one draft PO is made per supplier. The buyer checks and sends each PO as usual.
 */
const props = defineProps<{ request: RequestDetail }>()
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ converted: [result: { orders: { id: string; docNo: string }[]; request: RequestDetail }] }>()

const suppliers = ref<Record<number, SupplierOption | null>>({})
const error = ref('')
const sending = ref(false)

const asOption = (code: string, name: string): SupplierOption => ({
  code,
  name,
  shortName: null,
  email: null,
  paymentTermDays: 0,
  currency: 'MYR',
  isWalkIn: false,
})

watch(
  visible,
  (open) => {
    if (!open) return
    error.value = ''
    suppliers.value = Object.fromEntries(
      props.request.lines.map((l) => [l.lineNo, l.preferredSupplierCode ? asOption(l.preferredSupplierCode, l.preferredSupplierName ?? l.preferredSupplierCode) : null]),
    )
  },
  { immediate: true },
)

const searchSuppliers = async (q: string) => (await lookupsApi.suppliers(q)).items

const groups = computed(() => {
  const map = new Map<string, { name: string; lineNos: number[] }>()
  for (const l of props.request.lines) {
    const s = suppliers.value[l.lineNo]
    if (!s) continue
    const g = map.get(s.code) ?? { name: s.name, lineNos: [] }
    g.lineNos.push(l.lineNo)
    map.set(s.code, g)
  }
  return [...map].map(([supplierCode, g]) => ({ supplierCode, ...g }))
})
const missing = computed(() => props.request.lines.filter((l) => !suppliers.value[l.lineNo]))

const summary = computed(() => {
  const n = groups.value.length
  if (!n) return ''
  const names = groups.value.map((g) => g.name).join(', ')
  return n === 1 ? `One draft purchase order to ${names}.` : `${n} draft purchase orders, one per supplier: ${names}.`
})

async function create() {
  if (missing.value.length) {
    error.value = `Pick a supplier for ${missing.value.map((l) => l.itemCode).join(', ')}.`
    return
  }
  sending.value = true
  error.value = ''
  try {
    const result = await requestsApi.toPo(props.request.id, {
      version: props.request.version,
      groups: groups.value.map((g) => ({ supplierCode: g.supplierCode, lineNos: g.lineNos })),
    })
    visible.value = false
    emit('converted', result)
  } catch (e) {
    if (e instanceof ApiError) error.value = Object.values(e.fieldErrors)[0] ?? ''
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '760px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">Create PO directly from {{ request.docNo }}</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">Order from the preferred supplier when the price is known. You can change the supplier of a line.</p>
      </div>
    </template>

    <div class="flex flex-col gap-3">
      <table class="erp-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Last price</th>
            <th>Supplier</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in request.lines" :key="l.id">
            <td>
              <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
              <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
            </td>
            <td class="num">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
            <td class="num">{{ formatPrice(l.lastPrice) }}</td>
            <td class="min-w-[280px]">
              <MasterDataPicker
                v-model="suppliers[l.lineNo]"
                :search="searchSuppliers"
                :invalid="Boolean(error) && !suppliers[l.lineNo]"
                placeholder="Type a supplier code or name"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <NoticeBanner v-if="summary" kind="info">
        {{ summary }} Prices start from the supplier's contract price, else the last price. Each PO stays a draft until you
        send it for approval or release it.
      </NoticeBanner>
      <p v-if="error" class="m-0 text-xs font-medium text-note-error-text" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="sending" @click="create">
          {{ groups.length > 1 ? `Create ${groups.length} draft POs` : 'Create draft PO' }}
        </button>
      </div>
    </template>
  </Dialog>
</template>
