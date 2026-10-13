<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import KpiCard from '@/components/erp/KpiCard.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useSession } from '@/composables/useSession'
import { formatDayMonth, formatMoney, formatPrice, formatQty, formatRm, formatTime } from '@/utils/format'
import { isPositiveDecimal, previewLine, sumMoney } from '@/utils/money'
import { demandApi, lookupsApi, requestsApi } from '../api/purchase'
import type { DemandLine, DemandReport } from '../types'

/** P04 · Demand · what we should buy (PurDemand.html, FlowP1 step 1) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { can } = useSession()

const report = ref<DemandReport | null>(null)
const loading = ref(true)
const raising = ref(false)
const branches = ref<{ code: string; name: string }[]>([])

// ── Filters live in the URL (q, reason, supplier, branch) ────────────────────
const filter = computed(() => ({
  q: String(route.query.q ?? ''),
  reason: String(route.query.reason ?? ''),
  supplier: String(route.query.supplier ?? ''),
  branch: String(route.query.branch ?? ''),
}))
function setFilter(key: keyof typeof filter.value, value: string) {
  void router.replace({ query: { ...route.query, [key]: value || undefined } })
}
const searchText = ref(filter.value.q)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchText, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 250)
})

// ── Buy quantities and selection, per item ───────────────────────────────────
const buyQty = reactive<Record<string, string>>({})
const selected = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  try {
    const result = await demandApi.get(filter.value.branch || undefined)
    for (const line of result.lines) {
      if (line.status !== 'NEEDS_BUYING') continue
      if (!(line.itemCode in buyQty)) buyQty[line.itemCode] = formatQty(line.suggestedQty).replace(/,/g, '')
      // Items below their reorder level are ticked to start with; sales-order items are the buyer's call.
      if (!(line.itemCode in selected)) selected[line.itemCode] = line.reason === 'BELOW_REORDER'
    }
    report.value = result
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  void load()
  branches.value = (await lookupsApi.branches()).items
})
watch(() => filter.value.branch, load)

async function runAgain() {
  await load()
  toast.add({ severity: 'success', summary: 'Demand worked out again', detail: 'Using the latest stock, sales orders and open orders.', life: 3000 })
}

// Needs buying first (below reorder, then sales orders), covered rows after.
const RANK = (l: DemandLine) => (l.status === 'NEEDS_BUYING' ? 0 : 2) + (l.reason === 'BELOW_REORDER' ? 0 : 1)
const lines = computed(() =>
  [...(report.value?.lines ?? [])]
    .sort((a, b) => RANK(a) - RANK(b) || a.itemCode.localeCompare(b.itemCode))
    .filter((l) => {
      const q = filter.value.q.toLowerCase()
      if (q && !`${l.itemCode} ${l.itemName}`.toLowerCase().includes(q)) return false
      if (filter.value.reason && l.reason !== filter.value.reason) return false
      if (filter.value.supplier && l.preferredSupplierCode !== filter.value.supplier) return false
      return true
    }),
)
const suppliers = computed(() => {
  const map = new Map<string, string>()
  for (const l of report.value?.lines ?? []) if (l.preferredSupplierCode) map.set(l.preferredSupplierCode, l.preferredSupplierName ?? l.preferredSupplierCode)
  return [...map].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
})

// ── KPIs ─────────────────────────────────────────────────────────────────────
const chosen = computed(() =>
  (report.value?.lines ?? []).filter((l) => l.status === 'NEEDS_BUYING' && selected[l.itemCode] && isPositiveDecimal(buyQty[l.itemCode] ?? '')),
)
const selectedValue = computed(() =>
  sumMoney(chosen.value.map((l) => previewLine(buyQty[l.itemCode] ?? '0', l.lastPrice ?? '0', '0')?.amount ?? '0.00')),
)
const selectedSuppliers = computed(() => new Set(chosen.value.map((l) => l.preferredSupplierCode ?? '')).size)

// Amber banner for the modules still stubbed. Sales demand is real (kept from Sales events); stock is a snapshot until Inventory.
const notConnected = computed(() => {
  const c = report.value?.connections
  if (!c || (c.inventory && c.sales)) return null
  if (!c.inventory && !c.sales) return 'Inventory and Sales are not connected yet. Stock and sales-order figures here come from demo data until they are.'
  return !c.inventory
    ? 'Inventory is not connected yet. Stock figures here come from demo data until it is.'
    : 'Sales is not connected yet. Sales-order figures here come from demo data until it is.'
})
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const lastRun = computed(() => {
  const at = report.value?.asOf
  return at ? `Last run ${formatDayMonth(new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }))}, ${formatTime(at)}.` : ''
})

// ── Display helpers ──────────────────────────────────────────────────────────
const salesText = (l: DemandLine) => l.salesOrders.map((s) => `For ${s.soNo} · ${formatQty(s.qty)}`).join(', ')
const whyText = (l: DemandLine) =>
  l.reason === 'BELOW_REORDER' ? 'Below reorder' : l.isBuyToOrder ? `For ${l.salesOrders.map((s) => s.soNo).join(', ')} · buy to order` : salesText(l)

// ── Raise request ────────────────────────────────────────────────────────────
const bad = computed(() => (report.value?.lines ?? []).filter((l) => selected[l.itemCode] && !isPositiveDecimal(buyQty[l.itemCode] ?? '')))

async function raise() {
  if (bad.value.length) {
    toast.add({ severity: 'error', summary: `Enter a quantity to buy for ${bad.value.map((l) => l.itemCode).join(', ')}.`, life: 4000 })
    return
  }
  raising.value = true
  try {
    const request = await requestsApi.fromDemand(chosen.value.map((l) => ({ itemCode: l.itemCode, qty: buyQty[l.itemCode]! })))
    toast.add({ severity: 'success', summary: `${request.docNo} saved as draft`, detail: 'Add the needed-by date and reason, then submit it.', life: 4000 })
    await router.push(`/purchase/requests/${request.id}`)
  } finally {
    raising.value = false
  }
}
</script>

<template>
  <PageHeader title="Demand · what we should buy" document>
    <template #subtitle>
      Built every night from stock levels (Inventory), open sales orders (Sales events) and reorder levels (Master Data). {{ lastRun }}
    </template>
    <template #actions>
      <button type="button" class="erp-btn erp-btn-secondary" :disabled="loading" @click="runAgain">Run again now</button>
      <button
        v-if="can('purchase.request.create')"
        type="button"
        class="erp-btn erp-btn-primary"
        :disabled="raising || !chosen.length"
        @click="raise"
      >
        Raise request for selected
      </button>
    </template>
  </PageHeader>

  <div class="grid grid-cols-4 gap-3.5">
    <KpiCard
      compact
      label="Items that need buying"
      :value="report?.kpis.toBuy ?? ''"
      :sub="report ? `${report.kpis.belowReorder} below reorder · ${report.kpis.forSalesOrders} for sales orders` : ''"
      :loading="loading && !report"
    />
    <KpiCard compact label="Already covered" :value="report?.kpis.covered ?? ''" sub="by open POs or requests" :loading="loading && !report" />
    <KpiCard
      compact
      label="Estimated value"
      :value="report ? formatRm(report.kpis.estimatedValue) : ''"
      sub="at last purchase prices"
      :loading="loading && !report"
    />
    <KpiCard
      compact
      label="Selected"
      :value="chosen.length"
      :sub="`RM ${formatMoney(selectedValue)} · ${plural(selectedSuppliers, 'supplier', 'suppliers')}`"
      :loading="loading && !report"
    />
  </div>

  <NoticeBanner v-if="notConnected" kind="warning">{{ notConnected }}</NoticeBanner>

  <section class="erp-card flex grow flex-col gap-3 px-5 py-4">
    <div class="grid grid-cols-4 gap-3">
      <input v-model="searchText" class="erp-input" placeholder="Search item" aria-label="Search item" />
      <select class="erp-input" aria-label="Reason" :value="filter.reason" @change="setFilter('reason', ($event.target as HTMLSelectElement).value)">
        <option value="">All reasons</option>
        <option value="BELOW_REORDER">Below reorder</option>
        <option value="SALES_ORDER">For sales orders</option>
      </select>
      <select
        class="erp-input"
        aria-label="Preferred supplier"
        :value="filter.supplier"
        @change="setFilter('supplier', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">All suppliers</option>
        <option v-for="s in suppliers" :key="s.code" :value="s.code">{{ s.name }}</option>
      </select>
      <select class="erp-input" aria-label="Branch" :value="filter.branch" @change="setFilter('branch', ($event.target as HTMLSelectElement).value)">
        <option value="">All branches</option>
        <option v-for="b in branches" :key="b.code" :value="b.code">{{ b.name }}</option>
      </select>
    </div>

    <div class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr>
            <th class="w-8" aria-label="Select" />
            <th>Item</th>
            <th>Why</th>
            <th class="num">On hand</th>
            <th class="num">On order</th>
            <th class="num">Reorder level</th>
            <th>Preferred supplier</th>
            <th class="num">Last price</th>
            <th class="num">Buy</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !report">
            <td colspan="9" class="py-8 text-center text-erp-muted">Working out what to buy…</td>
          </tr>
          <tr v-else-if="!lines.length">
            <td colspan="9" class="py-8 text-center text-erp-muted">Nothing needs buying for these filters.</td>
          </tr>
          <template v-for="l in lines" :key="l.itemCode">
            <tr v-if="l.status === 'NEEDS_BUYING'" :class="{ 'bg-mod-light': selected[l.itemCode] }">
              <td><input v-model="selected[l.itemCode]" type="checkbox" :aria-label="`Select ${l.itemCode}`" /></td>
              <td>
                <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
              </td>
              <td>
                <StatusChip v-if="l.reason === 'BELOW_REORDER'" status="BELOW_REORDER" group="pending" label="Below reorder" />
                <StatusChip v-else status="SALES_ORDER" group="partial" :label="whyText(l)" />
              </td>
              <td class="num">{{ formatQty(l.onHand) }}</td>
              <td class="num">{{ formatQty(l.onOrder) }}</td>
              <td class="num">{{ l.reorderLevel === null ? '—' : formatQty(l.reorderLevel) }}</td>
              <td>{{ l.preferredSupplierName ?? '—' }}</td>
              <td class="num">{{ l.lastPrice ? formatPrice(l.lastPrice) : '—' }}</td>
              <td class="num">
                <input
                  v-model="buyQty[l.itemCode]"
                  class="erp-cell w-[72px] font-bold"
                  inputmode="decimal"
                  :aria-invalid="selected[l.itemCode] && !isPositiveDecimal(buyQty[l.itemCode] ?? '')"
                  :aria-label="`Buy quantity ${l.itemCode}`"
                  @input="selected[l.itemCode] = true"
                />
              </td>
            </tr>
            <tr v-else class="off">
              <td><input type="checkbox" disabled :aria-label="`${l.itemCode} already covered`" /></td>
              <td>
                <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                <div class="text-xs">{{ l.itemName }}</div>
              </td>
              <td>{{ whyText(l) }}</td>
              <td class="num">{{ formatQty(l.onHand) }}</td>
              <td class="num">{{ formatQty(l.onOrder) }}</td>
              <td class="num">{{ l.reorderLevel === null ? '—' : formatQty(l.reorderLevel) }}</td>
              <td>{{ l.preferredSupplierName ?? '—' }}</td>
              <td class="num">{{ l.lastPrice ? formatPrice(l.lastPrice) : '—' }}</td>
              <td class="num">Covered by {{ l.coveredBy.join(', ') }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p class="m-0 text-xs text-erp-muted">
      “Buy” is a suggestion: it tops stock back up to the reorder level, adds what open sales orders still need, and rounds up to the supplier’s pack size. Change it before raising the request.
    </p>
  </section>
</template>
