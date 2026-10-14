<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatMoney, formatPrice } from '@/utils/format'
import { coreItemsApi, coreLookupsApi } from '../api/core'
import InUseCard from '../components/InUseCard.vue'
import type { ItemAction, ItemDetail, ItemFormOptions, ItemInput, ItemType, SupplierOption } from '../types'
import { ITEM_STATUS_GROUP, ITEM_TYPE_OPTIONS } from './items'

/** C03 · New item / item (CoreItemForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const session = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const item = ref<ItemDetail | null>(null)
const options = ref<ItemFormOptions | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

interface ConversionRow {
  key: number
  fromUom: string
  toUom: string
  factor: string
}
let nextKey = 1
const form = reactive({
  code: '',
  name: '',
  itemGroup: '',
  type: 'STOCK' as ItemType,
  baseUom: '',
  barcode: '',
  einvoiceClassification: '',
  isPurchasable: true,
  isBuyToOrder: false,
  purchaseUom: '',
  purchaseTaxCode: '',
  preferredSupplier: null as SupplierOption | null,
  reorderLevel: '',
  packSize: '1',
  isSellable: false,
  salesUom: '',
  salesTaxCode: '',
  standardCost: '',
  conversions: [] as ConversionRow[],
})

const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, conversions: form.conversions.map(({ fromUom, toUom, factor }) => ({ fromUom, toUom, factor })) })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: ItemAction) => (isNew.value ? a === 'edit' && session.can('core.item.edit') : Boolean(item.value?.allowedActions.includes(a)))
const editable = computed(() => can('edit'))
const canSeeCost = computed(() => (isNew.value ? session.can('core.item.edit') : Boolean(item.value?.canSeeCost)))
const decimalText = (v: string | null) => (v === null ? '' : String(Number(v)))

function fill(i: ItemDetail | null) {
  if (i) {
    Object.assign(form, {
      code: i.code,
      name: i.name,
      itemGroup: i.itemGroup,
      type: i.type,
      baseUom: i.baseUom,
      barcode: i.barcode ?? '',
      einvoiceClassification: i.einvoiceClassification ?? '',
      isPurchasable: i.isPurchasable,
      isBuyToOrder: i.isBuyToOrder,
      purchaseUom: i.purchaseUom ?? '',
      purchaseTaxCode: i.purchaseTaxCode ?? '',
      preferredSupplier: i.preferredSupplier ? { code: i.preferredSupplier.code, name: i.preferredSupplier.name, shortName: i.preferredSupplier.shortName } : null,
      reorderLevel: decimalText(i.reorderLevel),
      packSize: decimalText(i.packSize),
      isSellable: i.isSellable,
      salesUom: i.salesUom ?? '',
      salesTaxCode: i.salesTaxCode ?? '',
      standardCost: i.standardCost === null ? '' : Number(i.standardCost).toFixed(2),
      conversions: i.conversions.map((c) => ({ key: nextKey++, fromUom: c.fromUom, toUom: c.toUom, factor: String(Number(c.factor)) })),
    })
  } else {
    Object.assign(form, {
      code: '', name: '', itemGroup: '', type: 'STOCK', baseUom: '', barcode: '', einvoiceClassification: '', isPurchasable: true, isBuyToOrder: false,
      purchaseUom: '', purchaseTaxCode: '', preferredSupplier: null, reorderLevel: '', packSize: '1', isSellable: false, salesUom: '', salesTaxCode: '',
      standardCost: '', conversions: [],
    })
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    options.value = await coreLookupsApi.itemForm()
    item.value = isNew.value ? null : await coreItemsApi.get(id.value)
    fill(item.value)
    setCrumb(item.value?.code ?? 'New item')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(i: ItemDetail) {
  item.value = i
  fill(i)
  setCrumb(i.code)
}

const unitLabel = (code: string) => {
  const u = options.value?.uoms.find((x) => x.code === code)
  return u ? `${u.code} · ${u.name}` : code
}
/** Purchase and sales units: the base unit or a unit the item has a conversion for. */
const unitChoices = computed(() => {
  const others = form.conversions.map((c) => (c.fromUom === form.baseUom ? c.toUom : c.toUom === form.baseUom ? c.fromUom : '')).filter(Boolean)
  return [...new Set(others)]
})
const taxLabel = (code: string) => {
  const t = options.value?.taxCodes.find((x) => x.code === code)
  return t ? `${t.code} · ${t.name}` : code
}
const searchSuppliers = async (q: string) => (await coreLookupsApi.suppliers(q)).items

function addConversion() {
  form.conversions.push({ key: nextKey++, fromUom: '', toUom: form.baseUom, factor: '' })
}

function body(): ItemInput {
  return {
    name: form.name.trim(),
    itemGroup: form.itemGroup,
    type: form.type,
    baseUom: form.baseUom,
    barcode: form.barcode.trim() || null,
    einvoiceClassification: form.einvoiceClassification || null,
    isPurchasable: form.isPurchasable,
    isBuyToOrder: form.isPurchasable && form.isBuyToOrder,
    purchaseUom: form.purchaseUom || null,
    purchaseTaxCode: form.purchaseTaxCode || null,
    preferredSupplierCode: form.preferredSupplier?.code ?? null,
    reorderLevel: form.reorderLevel.trim() || null,
    packSize: form.packSize.trim(),
    isSellable: form.isSellable,
    salesUom: form.salesUom || null,
    salesTaxCode: form.salesTaxCode || null,
    standardCost: canSeeCost.value ? form.standardCost.trim() || null : item.value?.standardCost ?? null,
    conversions: form.conversions.map((c) => ({ fromUom: c.fromUom, toUom: c.toUom, factor: c.factor.trim() })),
  }
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    const result = isNew.value
      ? await coreItemsApi.create({ code: form.code.trim().toUpperCase(), ...body() })
      : await coreItemsApi.update(id.value, { ...body(), version: item.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `Item ${result.code} created` : 'Item saved', life: 3000 })
    if (isNew.value) await router.replace(`/core/items/${result.id}`)
    show(result)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

const ASK: Record<'block' | 'discontinue', { header: string; message: string; accept: string }> = {
  block: { header: 'Block', message: 'Purchase and Sales cannot use a blocked item on new documents. You can activate it again.', accept: 'Block' },
  discontinue: { header: 'Discontinue', message: 'A discontinued item is no longer bought or sold, and leaves the pickers. You can activate it again.', accept: 'Discontinue' },
}
async function setStatus(action: 'block' | 'activate' | 'discontinue') {
  const i = item.value!
  const run = async () => {
    show(await coreItemsApi.setStatus(i.id, action, i.version))
    toast.add({ severity: 'success', summary: `${i.code} ${action === 'block' ? 'blocked' : action === 'activate' ? 'activated' : 'discontinued'}`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({ header: `${ASK[action].header} ${i.code}?`, message: ASK[action].message, acceptLabel: ASK[action].accept, rejectLabel: 'Keep it', accept: run })
}

function deleteItem() {
  const i = item.value!
  confirm.require({
    header: `Delete ${i.code}?`,
    message: `Nothing uses this item, so it can go. The code ${i.code} cannot be used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await coreItemsApi.remove(i.id, i.version)
      toast.add({ severity: 'success', summary: `${i.code} deleted`, life: 3000 })
      void router.push('/core/items')
    },
  })
}

/** "Seating · Stock item · bought from Perabot Kayu Timur · on 2 price lists" */
const subtitle = computed(() => {
  const i = item.value
  if (!i) return 'The code cannot change once the item is saved.'
  const lists = new Set(i.prices.map((p) => p.priceListCode)).size
  const supplier = i.preferredSupplier ? `bought from ${i.preferredSupplier.shortName ?? i.preferredSupplier.name}` : null
  return [i.itemGroup, `${i.typeLabel} item`, supplier, lists ? `on ${lists} price list${lists === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
})
const statusWaits = 'Block and Discontinue come back once these are finished or cancelled.'
const showStatus = (a: ItemAction) => !isNew.value && editable.value && (can(a) || Boolean(item.value?.refusals[a]))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="options">
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New item' : `Item ${item?.code ?? ''}`" :subtitle="subtitle" document>
        <template #chip>
          <StatusChip v-if="item" :status="item.status" :label="item.statusLabel" :group="ITEM_STATUS_GROUP[item.status]" />
        </template>
        <template #actions>
          <template v-if="isNew">
            <RouterLink to="/core/items" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
            <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save item</button>
          </template>
          <template v-else-if="item">
            <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving || dirty" @click="deleteItem">Delete</button>
            <button
              v-if="showStatus('block')"
              type="button"
              class="erp-btn erp-btn-danger"
              :disabled="saving || dirty || !can('block')"
              :title="item.refusals.block ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setStatus('block')"
            >
              Block
            </button>
            <button
              v-if="showStatus('discontinue')"
              type="button"
              class="erp-btn erp-btn-secondary"
              :disabled="saving || dirty || !can('discontinue')"
              :title="item.refusals.discontinue ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setStatus('discontinue')"
            >
              Discontinue
            </button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setStatus('activate')">Activate</button>
            <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">Save changes</button>
            <RouterLink v-else to="/core/items" class="erp-btn erp-btn-secondary">Back</RouterLink>
          </template>
        </template>
      </PageHeader>
    </section>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- General -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">General</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span class="flex justify-between gap-2">
                <label for="code">Item code</label>
                <span v-if="!isNew" class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div v-if="!isNew" id="code" class="erp-input-ro">{{ form.code }}</div>
              <input v-else id="code" v-model="form.code" class="erp-input uppercase" maxlength="30" placeholder="CH-DIN-01" />
              <span v-if="errors.code" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.code }}</span>
            </div>
            <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
              <input id="name" v-model="form.name" class="erp-input" maxlength="150" :disabled="!editable" />
            </FormField>
            <FormField label="Item group" for="itemGroup" :error="errors.itemGroup">
              <select id="itemGroup" v-model="form.itemGroup" class="erp-input" :disabled="!editable">
                <option value="" disabled>Pick the group</option>
                <option v-if="form.itemGroup && !options.itemGroups.includes(form.itemGroup)" :value="form.itemGroup">{{ form.itemGroup }}</option>
                <option v-for="g in options.itemGroups" :key="g" :value="g">{{ g }}</option>
              </select>
            </FormField>
            <FormField label="Type" for="type" :error="errors.type">
              <select id="type" v-model="form.type" class="erp-input" :disabled="!editable">
                <option v-for="t in ITEM_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </FormField>
            <FormField label="Base unit" for="baseUom" :error="errors.baseUom">
              <select id="baseUom" v-model="form.baseUom" class="erp-input" :disabled="!editable">
                <option value="" disabled>Pick the unit</option>
                <option v-if="form.baseUom && !options.uoms.some((u) => u.code === form.baseUom)" :value="form.baseUom">{{ form.baseUom }}</option>
                <option v-for="u in options.uoms" :key="u.code" :value="u.code">{{ u.code }} · {{ u.name }}</option>
              </select>
            </FormField>
            <FormField label="Barcode" for="barcode" :error="errors.barcode">
              <input id="barcode" v-model="form.barcode" class="erp-input" maxlength="30" :disabled="!editable" />
            </FormField>
            <FormField label="e-Invoice classification" for="classification" :error="errors.einvoiceClassification" class="col-span-2">
              <select id="classification" v-model="form.einvoiceClassification" class="erp-input" :class="{ 'text-erp-subtle': !form.einvoiceClassification }" :disabled="!editable">
                <option value="">Pick the LHDN classification</option>
                <option v-for="c in options.classifications" :key="c.code" :value="c.code">{{ c.code }} · {{ c.name }}</option>
              </select>
            </FormField>
          </div>
        </section>

        <!-- Buying -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Buying</h2>
          <div class="flex gap-6 text-[13px] font-medium">
            <span class="inline-flex items-center gap-2"><SwitchToggle v-model="form.isPurchasable" label="Can be bought" :disabled="!editable" />Can be bought</span>
            <span class="inline-flex items-center gap-2"><SwitchToggle v-model="form.isBuyToOrder" label="Buy to order only" :disabled="!editable || !form.isPurchasable" />Buy to order only</span>
          </div>
          <span v-if="errors.isBuyToOrder" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.isBuyToOrder }}</span>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Purchase unit" for="purchaseUom" :error="errors.purchaseUom">
              <select id="purchaseUom" v-model="form.purchaseUom" class="erp-input" :disabled="!editable">
                <option value="">Same as base unit</option>
                <option v-for="u in unitChoices" :key="u" :value="u">{{ unitLabel(u) }}</option>
              </select>
            </FormField>
            <FormField label="Purchase tax" for="purchaseTax" :error="errors.purchaseTaxCode">
              <select id="purchaseTax" v-model="form.purchaseTaxCode" class="erp-input" :disabled="!editable">
                <option value="">Pick the tax code</option>
                <option v-for="t in options.taxCodes" :key="t.code" :value="t.code">{{ taxLabel(t.code) }}</option>
              </select>
            </FormField>
            <FormField label="Preferred supplier" for="supplier" :error="errors.preferredSupplierCode">
              <MasterDataPicker v-if="editable" v-model="form.preferredSupplier" input-id="supplier" :search="searchSuppliers" placeholder="Type a supplier code or name" />
              <div v-else id="supplier" class="erp-input-ro">{{ form.preferredSupplier ? `${form.preferredSupplier.code} · ${form.preferredSupplier.name}` : '—' }}</div>
            </FormField>
            <FormField label="Reorder level" for="reorder" :error="errors.reorderLevel">
              <input id="reorder" v-model="form.reorderLevel" class="erp-input" inputmode="decimal" :disabled="!editable" />
            </FormField>
            <FormField label="Pack size" for="pack" :error="errors.packSize">
              <input id="pack" v-model="form.packSize" class="erp-input" inputmode="decimal" :disabled="!editable" />
            </FormField>
          </div>
        </section>

        <!-- Selling -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Selling</h2>
          <div class="flex gap-6 text-[13px] font-medium">
            <span class="inline-flex items-center gap-2"><SwitchToggle v-model="form.isSellable" label="Can be sold" :disabled="!editable" />Can be sold</span>
          </div>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Sales unit" for="salesUom" :error="errors.salesUom">
              <select id="salesUom" v-model="form.salesUom" class="erp-input" :disabled="!editable">
                <option value="">Same as base unit</option>
                <option v-for="u in unitChoices" :key="u" :value="u">{{ unitLabel(u) }}</option>
              </select>
            </FormField>
            <FormField label="Sales tax" for="salesTax" :error="errors.salesTaxCode">
              <select id="salesTax" v-model="form.salesTaxCode" class="erp-input" :disabled="!editable">
                <option value="">Pick the tax code</option>
                <option v-for="t in options.taxCodes" :key="t.code" :value="t.code">{{ taxLabel(t.code) }}</option>
              </select>
            </FormField>
            <FormField v-if="canSeeCost" label="Standard cost (RM)" for="cost" :error="errors.standardCost">
              <input id="cost" v-model="form.standardCost" class="erp-input" inputmode="decimal" :disabled="!editable" />
            </FormField>
          </div>
          <span v-if="canSeeCost" class="text-xs text-erp-muted">Standard cost gives the estimated margin on quotations. Only the Sales Manager sees it.</span>
        </section>

        <!-- Units and conversions -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Units and conversions</h2>
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="!form.baseUom" @click="addConversion"><Plus :size="14" aria-hidden="true" />Add conversion</button>
          </div>
          <p v-if="!form.conversions.length" class="m-0 text-[13px] text-erp-muted">
            <template v-if="form.baseUom">No conversions: bought, stocked and sold in {{ form.baseUom }}.</template>
            <template v-else>Pick the base unit first. A conversion is to or from it.</template>
          </p>
          <div v-for="(c, n) in form.conversions" :key="c.key" class="flex flex-col gap-1">
            <div class="flex items-center gap-2 text-[13px]">
              <template v-if="editable">
                <span>1</span>
                <select v-model="c.fromUom" class="erp-input w-[150px]" :aria-label="`Conversion ${n + 1}: unit`">
                  <option value="" disabled>Unit</option>
                  <option v-for="u in options.uoms" :key="u.code" :value="u.code">{{ u.code }} · {{ u.name }}</option>
                </select>
                <span>=</span>
                <input v-model="c.factor" class="erp-input w-[110px]" inputmode="decimal" placeholder="12" :aria-label="`Conversion ${n + 1}: factor`" />
                <select v-model="c.toUom" class="erp-input w-[150px]" :aria-label="`Conversion ${n + 1}: to unit`">
                  <option value="" disabled>Unit</option>
                  <option v-for="u in options.uoms" :key="u.code" :value="u.code">{{ u.code }} · {{ u.name }}</option>
                </select>
                <button type="button" class="ml-1 cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove conversion ${n + 1}`" @click="form.conversions.splice(n, 1)"><X :size="15" /></button>
              </template>
              <span v-else>1 {{ c.fromUom }} = {{ c.factor }} {{ c.toUom }}</span>
            </div>
            <span v-if="errors[`conversions[${n}]`]" class="text-xs font-medium text-note-error-text" role="alert">{{ errors[`conversions[${n}]`] }}</span>
          </div>
          <span v-if="form.conversions.length" class="text-xs text-erp-muted">Read as “1 BOX = 12 PCS”. One side is always the base unit. Changing a factor never changes documents already made.</span>
        </section>
      </div>

      <div class="flex flex-col gap-4">
        <template v-if="item">
          <InUseCard :usage="item.usage" :waits="statusWaits" />
          <SideCard title="Prices">
            <p v-if="!item.prices.length" class="m-0 text-[13px] text-erp-muted">Not on a price list yet.</p>
            <div v-for="p in item.prices" :key="`${p.priceListCode}-${p.uomCode}`" class="flex justify-between gap-2 border-b border-erp-row py-1.5 text-[13px]">
              <RouterLink v-if="p.priceListId" :to="`/core/price-lists/${p.priceListId}`" class="erp-link">{{ p.priceListName }}</RouterLink>
              <span v-else>{{ p.priceListName }}</span>
              <span class="whitespace-nowrap">RM {{ formatMoney(p.unitPrice) }} / {{ p.uomCode }}</span>
            </div>
            <span class="text-xs text-erp-muted">From the price lists. Change a price on its price list.</span>
          </SideCard>
          <SideCard title="Contract prices">
            <p v-if="!item.contractPrices.length" class="m-0 text-[13px] text-erp-muted">No contract price. Contract prices are kept on the supplier.</p>
            <div v-for="c in item.contractPrices" :key="`${c.supplierCode}-${c.validFrom}`" class="flex flex-col border-b border-erp-row py-1.5 text-[13px]">
              <span class="flex justify-between gap-2">
                <RouterLink v-if="c.supplierId" :to="`/core/suppliers/${c.supplierId}`" class="erp-link">{{ c.supplierCode }} · {{ c.supplierName }}</RouterLink>
                <span v-else>{{ c.supplierCode }}</span>
                <span class="whitespace-nowrap">RM {{ formatPrice(c.unitPrice) }}</span>
              </span>
              <span class="text-xs text-erp-muted">{{ formatDate(c.validFrom) }} – {{ c.validTo ? formatDate(c.validTo) : 'no end' }}</span>
            </div>
          </SideCard>
          <ActivityList v-if="item.activity.length" :items="item.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
        </template>
        <SideCard v-else title="New item">
          <p class="m-0 text-[13px] text-erp-muted">Once saved, Purchase and Sales can use the item straight away. The code never changes, and a deleted item’s code is not used again.</p>
        </SideCard>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* For someone who can only look, the fields read like the locked fields of a released document (.erp-input-ro). */
.erp-input:disabled {
  color: var(--erp-subtle);
  background: var(--erp-head-bg);
  border-color: var(--erp-border);
  opacity: 1;
}
</style>
