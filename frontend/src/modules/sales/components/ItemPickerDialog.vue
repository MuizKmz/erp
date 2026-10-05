<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { formatDayMonth, formatPrice, formatQty } from '@/utils/format'
import { isPositiveDecimal } from '@/utils/money'
import { salesLookupsApi } from '../api/sales'
import type { SaleItemOption } from '../types'

/**
 * S04 · Add item from Master Data (ItemPicker.html). Shows the price list price, the last price sold to this
 * customer and stock at the branch. Excluded and not-for-sale items are greyed out with the reason; out of
 * stock only warns. Used by quotations, sales orders, invoices and cash sales.
 */
const props = defineProps<{
  /** "QT-0012 · Kedai Perabot Maju · Penang Branch · price list Reseller 2026" */
  context: string
  customerCode: string | null
  branchCode: string | null
  branchName: string
  /** Item codes already on the document, by line number */
  onLines: Record<string, number>
}>()
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ add: [items: { item: SaleItemOption; qty: string }[]] }>()

const q = ref('')
const group = ref('')
const sellableOnly = ref(true)
const showStock = ref(true)
const items = ref<SaleItemOption[]>([])
const groups = ref<string[]>([])
const loading = ref(false)
const picked = ref<Record<string, string>>({})

async function search() {
  loading.value = true
  try {
    const result = await salesLookupsApi.items({
      q: q.value.trim() || undefined,
      customerCode: props.customerCode ?? undefined,
      branchCode: props.branchCode ?? undefined,
      group: group.value || undefined,
      sellableOnly: sellableOnly.value ? 'true' : 'false',
    })
    items.value = result.items
    if (!groups.value.length) groups.value = result.groups
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void search(), 300)
})
watch([group, sellableOnly], () => void search())
watch(visible, (open) => {
  if (!open) return
  picked.value = {}
  void search()
})

const canPick = (i: SaleItemOption) => i.state === 'ACTIVE' || i.state === 'OUT_OF_STOCK'
function toggle(i: SaleItemOption) {
  if (!canPick(i)) return
  const next = { ...picked.value }
  if (i.code in next) delete next[i.code]
  else next[i.code] = '1'
  picked.value = next
}
const chosen = computed(() => items.value.filter((i) => i.code in picked.value))
const allValid = computed(() => chosen.value.every((i) => isPositiveDecimal(picked.value[i.code] ?? '')))

function note(i: SaleItemOption): { text: string; tone: 'muted' | 'warn' | 'off' } {
  if (i.state === 'NOT_FOR_SALE') return { text: 'Not for sale in Master Data', tone: 'off' }
  if (i.state === 'EXCLUDED') return { text: `Excluded in ${props.branchName.replace(/\s+branch$/i, '')}${i.reason ? ` · ${i.reason}` : ''}`, tone: 'off' }
  if (props.onLines[i.code]) return { text: `Already on line ${props.onLines[i.code]}`, tone: 'muted' }
  if (i.state === 'OUT_OF_STOCK') return { text: 'Out of stock · warns only', tone: 'warn' }
  if (i.isBuyToOrder) return { text: 'Buy to order', tone: 'muted' }
  return { text: 'Active', tone: 'muted' }
}

function add() {
  if (!chosen.value.length || !allValid.value) return
  emit('add', chosen.value.map((item) => ({ item, qty: picked.value[item.code]! })))
  visible.value = false
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '880px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">Add item from Master Data</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">{{ context }}</p>
      </div>
    </template>

    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-[1.6fr_1fr] gap-3">
        <input v-model="q" class="erp-input" placeholder="Search code, name or barcode" aria-label="Search code, name or barcode" />
        <select v-model="group" class="erp-input" aria-label="Item group">
          <option value="">All item groups</option>
          <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
      <div class="flex items-center justify-between gap-3 text-[13px]">
        <div class="flex gap-5">
          <label class="flex items-center gap-2"><input v-model="sellableOnly" type="checkbox" />Only items that can be sold</label>
          <label class="flex items-center gap-2"><input v-model="showStock" type="checkbox" />Show stock at {{ branchName }}</label>
        </div>
        <span class="text-xs text-erp-muted">{{ loading ? 'Searching…' : `${items.length} ${items.length === 1 ? 'result' : 'results'}` }}</span>
      </div>

      <div class="max-h-[380px] overflow-y-auto rounded-lg border border-erp-border">
        <table class="erp-table">
          <thead class="sticky top-0 z-[1]">
            <tr>
              <th class="w-8" aria-label="Pick" />
              <th>Item</th>
              <th>UOM</th>
              <th class="num">Price list (RM)</th>
              <th>Last sold to customer</th>
              <th v-if="showStock" class="num">In stock</th>
              <th>Note</th>
              <th class="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!loading && !items.length">
              <td :colspan="showStock ? 8 : 7" class="text-center text-erp-muted">No items match. Try another word or item group.</td>
            </tr>
            <tr v-for="i in items" :key="i.code" :class="{ off: !canPick(i) }">
              <td>
                <input type="checkbox" :checked="i.code in picked" :disabled="!canPick(i)" :aria-label="`Pick ${i.code}`" @change="toggle(i)" />
              </td>
              <td>
                <div class="font-semibold whitespace-nowrap">{{ i.code }}</div>
                <div class="text-xs" :class="canPick(i) ? 'text-erp-muted' : ''">{{ i.name }}</div>
              </td>
              <td>{{ i.uomCode }}</td>
              <td class="num">{{ i.listPrice ? formatPrice(i.listPrice) : '—' }}</td>
              <td class="whitespace-nowrap">
                <template v-if="i.lastSold">{{ formatPrice(i.lastSold.price) }} · {{ formatDayMonth(i.lastSold.date) }}</template>
                <template v-else>{{ canPick(i) ? 'Never' : '—' }}</template>
              </td>
              <td v-if="showStock" class="num">{{ i.inStock === null ? '—' : formatQty(i.inStock) }}</td>
              <td
                class="text-xs"
                :class="{ 'font-semibold text-attention': note(i).tone === 'warn', 'text-erp-muted': note(i).tone === 'muted' }"
              >
                {{ note(i).text }}
              </td>
              <td class="num w-[90px]">
                <input
                  v-if="i.code in picked"
                  v-model="picked[i.code]"
                  class="erp-cell"
                  inputmode="decimal"
                  :aria-invalid="!isPositiveDecimal(picked[i.code] ?? '')"
                  :aria-label="`Quantity of ${i.code}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="m-0 text-xs text-erp-muted">
        Read-only data from Master Data. When you add an item, its code, name, price, tax code and unit are copied onto the line, so later
        price changes don't change this document.
      </p>
    </div>

    <template #footer>
      <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
      <button type="button" class="erp-btn erp-btn-primary" :disabled="!chosen.length || !allValid" @click="add">
        Add {{ chosen.length || '' }} {{ chosen.length === 1 ? 'item' : 'items' }}
      </button>
    </template>
  </Dialog>
</template>
