<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Pencil, Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatPrice } from '@/utils/format'
import { coreLookupsApi, corePriceListsApi } from '../api/core'
import type { PriceListAction, PriceListDetail, PriceListInput, PriceState, SellableItemOption } from '../types'
import { PRICE_LIST_STATUS_GROUP, PRICE_STATE_CHIP } from './priceLists'

/** C09 · Price list with its dated prices (CorePriceListForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const session = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const list = ref<PriceListDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const showEarlier = ref(false)
const errors = ref<Record<string, string>>({})

/**
 * One dated price. A saved price dated before today is history (`locked`): it shows as text and is never sent. A
 * price from today on can be changed (pencil) or removed; a new row picks its item and unit.
 */
interface PriceRow {
  key: number
  saved: boolean
  item: SellableItemOption | null
  itemId: string | null
  uomCode: string
  unitPrice: string
  validFrom: string
  state: PriceState
  locked: boolean
  editing: boolean
}
let nextKey = 1
const form = reactive({
  code: '',
  name: '',
  currency: 'MYR',
  taxInclusive: false,
  validFrom: '',
  validTo: '',
  isActive: true,
  prices: [] as PriceRow[],
})

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

const sent = computed(() => form.prices.filter((p) => !p.locked))
const snapshot = () =>
  JSON.stringify({
    ...form,
    prices: sent.value.map((p) => ({ item: p.item?.code ?? '', uom: p.uomCode, price: p.unitPrice, from: p.validFrom })),
  })
const saved = ref('')
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: PriceListAction) => Boolean(list.value?.allowedActions.includes(a))
/** Only the Master Data Admin changes price lists (decision 2). */
const editable = computed(() => (isNew.value ? session.can('core.price_list.edit') : can('edit')))
const earlierCount = computed(() => form.prices.filter((p) => p.state === 'earlier').length)
const shown = computed(() => form.prices.filter((p) => showEarlier.value || p.state !== 'earlier'))
/** The pencil-and-remove column, only while some price can still change (history rows have none). */
const hasActions = computed(() => editable.value && form.prices.some((p) => !p.locked))
const errorOf = (p: PriceRow) => (p.locked ? undefined : errors.value[`prices[${sent.value.indexOf(p)}]`])

function fill(l: PriceListDetail | null) {
  if (l) {
    Object.assign(form, {
      code: l.code, name: l.name, currency: l.currency, taxInclusive: l.taxInclusive, validFrom: l.validFrom, validTo: l.validTo ?? '', isActive: l.isActive,
      prices: l.prices.map((p) => ({
        key: nextKey++, saved: true, item: { code: p.itemCode, name: p.itemName, baseUom: p.uomCode, units: [p.uomCode] }, itemId: p.itemId, uomCode: p.uomCode,
        unitPrice: String(Number(p.unitPrice)), validFrom: p.validFrom, state: p.state, locked: p.locked, editing: false,
      })),
    })
  } else {
    Object.assign(form, { code: '', name: '', currency: 'MYR', taxInclusive: false, validFrom: session.today.value, validTo: '', isActive: true, prices: [] })
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    list.value = isNew.value ? null : await corePriceListsApi.get(id.value)
    fill(list.value)
    setCrumb(list.value?.code ?? 'New price list')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(l: PriceListDetail) {
  list.value = l
  fill(l)
  setCrumb(l.code)
}

const searchItems = async (q: string) => (await coreLookupsApi.sellableItems(q)).items
/** A new price starts today, or on the list's first day when that is later. */
function addPrice() {
  const from = form.validFrom > session.today.value ? form.validFrom : session.today.value
  form.prices.push({ key: nextKey++, saved: false, item: null, itemId: null, uomCode: '', unitPrice: '', validFrom: from, state: 'waiting', locked: false, editing: true })
}
function pickItem(p: PriceRow, item: SellableItemOption | null) {
  p.item = item
  p.uomCode = item?.units[0] ?? ''
}

function body(): PriceListInput {
  return {
    name: form.name.trim(),
    currency: form.currency,
    taxInclusive: form.taxInclusive,
    validFrom: form.validFrom,
    validTo: form.validTo || null,
    prices: sent.value.map((p) => ({ itemCode: p.item?.code ?? '', uomCode: p.uomCode, unitPrice: p.unitPrice.trim(), validFrom: p.validFrom })),
  }
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    const result = isNew.value
      ? await corePriceListsApi.create({ code: form.code.trim().toUpperCase(), isActive: form.isActive, ...body() })
      : await corePriceListsApi.update(id.value, { ...body(), version: list.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `Price list ${result.code} created` : 'Price list saved', life: 3000 })
    if (isNew.value) await router.replace(`/core/price-lists/${result.id}`)
    show(result)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

async function setStatus(action: 'deactivate' | 'activate') {
  const l = list.value!
  const run = async () => {
    show(await corePriceListsApi.setStatus(l.id, action, l.version))
    toast.add({ severity: 'success', summary: `${l.code} ${action === 'deactivate' ? 'deactivated' : 'activated'}`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({
    header: `Deactivate ${l.code}?`,
    message: 'Sales stops using its prices straight away, and it can no longer be given to a customer. You can activate it again.',
    acceptLabel: 'Deactivate',
    rejectLabel: 'Keep it',
    accept: run,
  })
}

function deletePriceList() {
  const l = list.value!
  confirm.require({
    header: `Delete ${l.code}?`,
    message: `No customer and no Sales document uses this price list, so it can go, with its prices. The code ${l.code} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await corePriceListsApi.remove(l.id, l.version)
      toast.add({ severity: 'success', summary: `${l.code} deleted`, life: 3000 })
      void router.push('/core/price-lists')
    },
  })
}

/** "Standard 2026 · MYR · 1 Jan 2026 – 31 Dec 2026" */
const subtitle = computed(() => {
  const l = list.value
  if (!l) return 'Prices for Sales, from a date. Customers are given a price list in Core.'
  return `${l.name} · ${l.currency} · ${formatDate(l.validFrom)} – ${l.validTo ? formatDate(l.validTo) : 'no end'}`
})
const usedByTitle = computed(() => {
  const n = list.value?.customers.length ?? 0
  return n === 0 ? 'Used by no customers' : `Used by ${n} customer${n === 1 ? '' : 's'}`
})
const statusLabel = computed(() => (isNew.value ? (form.isActive ? 'Active' : 'Inactive') : (list.value?.statusLabel ?? '')))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New price list' : `Price list ${list?.code ?? ''}`" :subtitle="subtitle" document>
        <template #chip>
          <StatusChip v-if="list" :status="list.status" :label="list.statusLabel" :group="PRICE_LIST_STATUS_GROUP[list.status]" />
        </template>
        <template #actions>
          <template v-if="isNew">
            <RouterLink to="/core/price-lists" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
            <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save price list</button>
          </template>
          <template v-else-if="list">
            <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving || dirty" @click="deletePriceList">Delete</button>
            <button
              v-if="can('deactivate') || list.refusals.deactivate"
              type="button"
              class="erp-btn erp-btn-secondary"
              :disabled="saving || dirty || !can('deactivate')"
              :title="list.refusals.deactivate ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setStatus('deactivate')"
            >
              Deactivate
            </button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setStatus('activate')">Activate</button>
            <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">Save changes</button>
            <RouterLink v-else to="/core/price-lists" class="erp-btn erp-btn-secondary">Back</RouterLink>
          </template>
        </template>
      </PageHeader>
    </section>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- Price list -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Price list</h2>
          <div class="grid grid-cols-4 gap-x-[18px] gap-y-3.5">
            <FormField v-if="isNew" label="Code" for="code" :error="errors.code">
              <input id="code" v-model="form.code" class="erp-input uppercase placeholder:normal-case" maxlength="20" placeholder="STD-2027" />
            </FormField>
            <div v-else class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span class="flex justify-between gap-2">
                <label for="code">Code</label>
                <span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ form.code }}</div>
            </div>
            <FormField label="Name" for="name" :error="errors.name">
              <input id="name" v-model="form.name" class="erp-input" maxlength="60" :disabled="!editable" />
            </FormField>
            <FormField label="Currency" for="currency" :error="errors.currency">
              <select id="currency" v-model="form.currency" class="erp-input" :disabled="!editable">
                <option value="MYR">MYR</option>
              </select>
            </FormField>
            <FormField label="Prices" for="tax" :error="errors.taxInclusive">
              <select id="tax" v-model="form.taxInclusive" class="erp-input" :disabled="!editable">
                <option :value="false">Exclude tax</option>
                <option :value="true">Include tax</option>
              </select>
            </FormField>
            <FormField label="Valid from" for="validFrom" :error="errors.validFrom">
              <DatePicker
                v-if="editable"
                input-id="validFrom"
                :model-value="isoToDate(form.validFrom)"
                date-format="d M yy"
                fluid
                class="erp-date"
                :invalid="Boolean(errors.validFrom)"
                @update:model-value="form.validFrom = dateToIso($event)"
              />
              <div v-else class="erp-input-ro">{{ formatDate(form.validFrom) }}</div>
            </FormField>
            <FormField label="Valid to" for="validTo" :error="errors.validTo">
              <DatePicker
                v-if="editable"
                input-id="validTo"
                :model-value="isoToDate(form.validTo)"
                date-format="d M yy"
                placeholder="No end"
                show-button-bar
                fluid
                class="erp-date"
                :invalid="Boolean(errors.validTo)"
                @update:model-value="form.validTo = dateToIso($event)"
                @clear-click="form.validTo = ''"
              />
              <div v-else class="erp-input-ro">{{ form.validTo ? formatDate(form.validTo) : 'No end' }}</div>
            </FormField>
            <div class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span>Status</span>
              <span class="inline-flex h-[38px] items-center gap-2 text-[13px] font-medium text-erp-text">
                <SwitchToggle v-model="form.isActive" label="Active" :disabled="!isNew || !editable" />{{ statusLabel }}
              </span>
            </div>
          </div>
        </section>

        <!-- Prices -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Prices · {{ isNew ? form.prices.length : list?.priceCount }}</h2>
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="addPrice"><Plus :size="14" aria-hidden="true" />Add price</button>
          </div>
          <NoticeBanner kind="info">To change a price from a date, add a new row with that date. The old price stays for documents dated before it.</NoticeBanner>
          <p v-if="!form.prices.length" class="m-0 text-[13px] text-erp-muted">No prices yet.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Name</th>
                <th class="w-[80px]">Unit</th>
                <th class="num w-[120px]">Price (RM)</th>
                <th :class="hasActions ? 'w-[160px]' : 'w-[120px]'">From</th>
                <th v-if="hasActions" class="w-[60px]"><span class="sr-only">Change</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="p in shown" :key="p.key">
                <tr v-if="!p.editing" :class="{ 'text-erp-muted': p.state === 'earlier' }">
                  <td class="whitespace-nowrap">
                    <RouterLink v-if="p.itemId" :to="`/core/items/${p.itemId}`" class="erp-link font-semibold">{{ p.item?.code }}</RouterLink>
                    <span v-else class="font-semibold">{{ p.item?.code }}</span>
                  </td>
                  <td>{{ p.item?.name }}</td>
                  <td>{{ p.uomCode }}</td>
                  <td class="num whitespace-nowrap">{{ formatPrice(p.unitPrice) }}</td>
                  <td class="whitespace-nowrap">
                    {{ formatDate(p.validFrom) }}
                    <StatusChip v-if="PRICE_STATE_CHIP[p.state]" :status="p.state" :label="PRICE_STATE_CHIP[p.state]!.label" :group="PRICE_STATE_CHIP[p.state]!.group" class="ml-1" />
                  </td>
                  <td v-if="hasActions" class="whitespace-nowrap text-right">
                    <template v-if="!p.locked">
                      <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-erp-text" :aria-label="`Change the price of ${p.item?.code} from ${formatDate(p.validFrom)}`" @click="p.editing = true"><Pencil :size="14" /></button>
                      <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove the price of ${p.item?.code} from ${formatDate(p.validFrom)}`" @click="form.prices.splice(form.prices.indexOf(p), 1)"><X :size="15" /></button>
                    </template>
                  </td>
                </tr>
                <tr v-else>
                  <template v-if="p.saved">
                    <td class="font-semibold whitespace-nowrap">{{ p.item?.code }}</td>
                    <td>{{ p.item?.name }}</td>
                    <td>{{ p.uomCode }}</td>
                  </template>
                  <template v-else>
                    <td colspan="2">
                      <MasterDataPicker :model-value="p.item" :search="searchItems" placeholder="Type an item code or name" :input-id="`price-item-${p.key}`" @update:model-value="pickItem(p, $event)" />
                    </td>
                    <td>
                      <select v-model="p.uomCode" class="erp-input" :disabled="!p.item" :aria-label="`Unit for ${p.item?.code ?? 'the new price'}`">
                        <option v-for="u in p.item?.units ?? []" :key="u" :value="u">{{ u }}</option>
                      </select>
                    </td>
                  </template>
                  <td><input v-model="p.unitPrice" class="erp-input text-right" inputmode="decimal" placeholder="260.00" :aria-label="`Price of ${p.item?.code ?? 'the new item'}`" /></td>
                  <td>
                    <DatePicker
                      :model-value="isoToDate(p.validFrom)"
                      :min-date="isoToDate(session.today.value) ?? undefined"
                      date-format="d M yy"
                      fluid
                      class="erp-date"
                      :input-id="`price-from-${p.key}`"
                      @update:model-value="p.validFrom = dateToIso($event)"
                    />
                  </td>
                  <td class="text-right">
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove the price of ${p.item?.code ?? 'the new item'}`" @click="form.prices.splice(form.prices.indexOf(p), 1)"><X :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="errorOf(p)">
                  <td :colspan="hasActions ? 6 : 5" class="pt-0 text-xs font-medium text-note-error-text" role="alert">{{ errorOf(p) }}</td>
                </tr>
              </template>
            </tbody>
          </table>
          <button v-if="earlierCount" type="button" class="erp-link self-start cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-erp-link" @click="showEarlier = !showEarlier">
            {{ showEarlier ? 'Hide earlier prices' : `Show earlier prices (${earlierCount})` }}
          </button>
        </section>
      </div>

      <div class="flex flex-col gap-4">
        <template v-if="list">
          <SideCard :title="usedByTitle">
            <p v-if="!list.customers.length" class="m-0 text-[13px] text-erp-muted">No customer has this price list yet. Give it to one on the customer form.</p>
            <ul v-else class="m-0 flex list-none flex-col p-0">
              <li v-for="c in list.customers" :key="c.id" class="border-b border-erp-border py-2 text-[13px] first:pt-0">
                <RouterLink :to="`/core/customers/${c.id}`" class="erp-link">{{ c.code }}</RouterLink> · {{ c.name }}
              </li>
            </ul>
            <p v-if="list.documents" class="m-0 mt-2.5 text-xs text-erp-muted">Also on {{ list.documents }} Sales document{{ list.documents === 1 ? '' : 's' }}, so it can never be deleted.</p>
          </SideCard>
          <ActivityList v-if="list.activity.length" :items="list.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
        </template>
        <SideCard v-else title="New price list">
          <p class="m-0 text-[13px] text-erp-muted">Once saved, customers can be given this price list in Core, and Sales prices their documents from it.</p>
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
