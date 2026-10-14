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
import { formatDate, formatMoney } from '@/utils/format'
import { coreLookupsApi, coreSuppliersApi } from '../api/core'
import InUseCard from '../components/InUseCard.vue'
import type { IdType, PurchasableItemOption, SupplierAction, SupplierDetail, SupplierFormOptions, SupplierInput } from '../types'
import { SUPPLIER_STATUS_GROUP } from './suppliers'

/** C07 · New supplier / supplier with contract prices (CoreSupplierForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const session = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const supplier = ref<SupplierDetail | null>(null)
const options = ref<SupplierFormOptions | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

/** A saved contract price reads as a table row (C07) until someone with core.supplier.contract edits it. */
interface ContractRow {
  key: number
  itemId: string | null
  item: PurchasableItemOption | null
  unitPrice: string
  validFrom: string
  validTo: string
  editing: boolean
}
let nextKey = 1
const form = reactive({
  name: '',
  shortName: '',
  category: '',
  isWalkIn: false,
  contactName: '',
  email: '',
  phone: '',
  address: '',
  tin: '',
  idType: 'BRN' as IdType | '',
  regNo: '',
  sstNo: '',
  serviceTaxNo: '',
  einvoiceEmail: '',
  paymentTermDays: 30,
  currency: 'MYR',
  contractPrices: [] as ContractRow[],
})

const saved = ref('')
const snapshot = () =>
  JSON.stringify({ ...form, contractPrices: form.contractPrices.map((c) => ({ item: c.item?.code ?? '', unitPrice: c.unitPrice, validFrom: c.validFrom, validTo: c.validTo })) })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: SupplierAction) => Boolean(supplier.value?.allowedActions.includes(a))
/** Buyers and the Purchasing Manager edit suppliers; contract prices need core.supplier.contract (decision 2). */
const detailsEditable = computed(() => (isNew.value ? session.can('core.supplier.edit') : can('edit')))
const contractsEditable = computed(() => (isNew.value ? session.can('core.supplier.contract') : can('editContracts')))
const anyEditable = computed(() => detailsEditable.value || contractsEditable.value)
const text = (v: string | null) => v ?? ''
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const priceText = (v: string) => String(Number(v))

function fill(s: SupplierDetail | null) {
  if (s) {
    Object.assign(form, {
      name: s.name, shortName: text(s.shortName), category: text(s.category), isWalkIn: s.isWalkIn, contactName: text(s.contactName), email: text(s.email),
      phone: text(s.phone), address: text(s.address), tin: text(s.tin), idType: s.idType ?? '', regNo: text(s.regNo), sstNo: text(s.sstNo),
      serviceTaxNo: text(s.serviceTaxNo), einvoiceEmail: text(s.einvoiceEmail), paymentTermDays: s.paymentTermDays, currency: s.currency,
      contractPrices: s.contractPrices.map((c) => ({
        key: nextKey++, itemId: c.itemId, item: { code: c.itemCode, name: c.itemName, baseUom: c.uomCode ?? '' }, unitPrice: priceText(c.unitPrice), validFrom: c.validFrom, validTo: c.validTo ?? '', editing: false,
      })),
    })
  } else {
    Object.assign(form, {
      name: '', shortName: '', category: '', isWalkIn: false, contactName: '', email: '', phone: '', address: '', tin: '', idType: 'BRN', regNo: '', sstNo: '',
      serviceTaxNo: '', einvoiceEmail: '', paymentTermDays: options.value?.paymentTerms.find((t) => t.days === 30)?.days ?? 30, currency: 'MYR', contractPrices: [],
    })
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    options.value = await coreLookupsApi.supplierForm()
    supplier.value = isNew.value ? null : await coreSuppliersApi.get(id.value)
    fill(supplier.value)
    setCrumb(supplier.value?.code ?? 'New supplier')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(s: SupplierDetail) {
  supplier.value = s
  fill(s)
  setCrumb(s.code)
}

const searchItems = async (q: string) => (await coreLookupsApi.purchasableItems(q)).items
function addContract() {
  form.contractPrices.push({ key: nextKey++, itemId: null, item: null, unitPrice: '', validFrom: session.today.value, validTo: '', editing: true })
}

const blankToNull = (v: string) => v.trim() || null
function body(): SupplierInput {
  return {
    name: form.name.trim(),
    shortName: blankToNull(form.shortName),
    category: blankToNull(form.category),
    isWalkIn: form.isWalkIn,
    contactName: blankToNull(form.contactName),
    email: blankToNull(form.email),
    phone: blankToNull(form.phone),
    address: blankToNull(form.address),
    tin: blankToNull(form.tin),
    idType: form.idType || null,
    regNo: blankToNull(form.regNo),
    sstNo: blankToNull(form.sstNo),
    serviceTaxNo: blankToNull(form.serviceTaxNo),
    einvoiceEmail: blankToNull(form.einvoiceEmail),
    paymentTermDays: Number(form.paymentTermDays),
    currency: form.currency,
    contractPrices: form.contractPrices.map((c) => ({ itemCode: c.item?.code ?? '', unitPrice: c.unitPrice.trim(), validFrom: c.validFrom, validTo: c.validTo || null })),
  }
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    const result = isNew.value ? await coreSuppliersApi.create(body()) : await coreSuppliersApi.update(id.value, { ...body(), version: supplier.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `Supplier ${result.code} created` : 'Supplier saved', life: 3000 })
    if (isNew.value) await router.replace(`/core/suppliers/${result.id}`)
    show(result)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

async function setStatus(action: 'block' | 'activate') {
  const s = supplier.value!
  const run = async () => {
    show(await coreSuppliersApi.setStatus(s.id, action, s.version))
    toast.add({ severity: 'success', summary: action === 'block' ? `${s.code} blocked` : `${s.code} activated`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({
    header: `Block ${s.code}?`,
    message: 'Purchase cannot pick a blocked supplier on new requests for quotation, orders or cash purchases. You can activate it again.',
    acceptLabel: 'Block',
    rejectLabel: 'Keep it',
    accept: run,
  })
}

function deleteSupplier() {
  const s = supplier.value!
  confirm.require({
    header: `Delete ${s.code}?`,
    message: `No Purchase document uses this supplier and no item prefers it, so it can go, with its contract prices. The number ${s.code} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await coreSuppliersApi.remove(s.id, s.version)
      toast.add({ severity: 'success', summary: `${s.code} deleted`, life: 3000 })
      void router.push('/core/suppliers')
    },
  })
}

/** "Perabot Kayu Timur · Furniture, timber · 30 days · MYR" */
const subtitle = computed(() => {
  const s = supplier.value
  if (!s) return 'The supplier number is given when you save.'
  return [s.name, s.category, s.paymentTermDays === 0 ? 'Cash' : `${s.paymentTermDays} days`, s.currency].filter(Boolean).join(' · ')
})
const eInvoiceGap = computed(() => {
  if (form.isWalkIn) return null
  const noTin = !form.tin.trim()
  const noId = !form.regNo.trim()
  if (noTin && noId) return 'No TIN or ID number yet. e-Invoices with this supplier need both.'
  if (noId) return 'No ID number yet. e-Invoices need it with the TIN.'
  if (noTin) return 'No TIN yet. e-Invoices need it with the ID number.'
  return null
})
const blockWaits = 'Block comes back once these are finished or cancelled.'
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="options">
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New supplier' : `Supplier ${supplier?.code ?? ''}`" :subtitle="subtitle" document>
        <template #chip>
          <StatusChip v-if="supplier" :status="supplier.status" :label="supplier.statusLabel" :group="SUPPLIER_STATUS_GROUP[supplier.status]" />
        </template>
        <template #actions>
          <template v-if="isNew">
            <RouterLink to="/core/suppliers" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
            <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save supplier</button>
          </template>
          <template v-else-if="supplier">
            <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving || dirty" @click="deleteSupplier">Delete</button>
            <button
              v-if="can('block') || supplier.refusals.block"
              type="button"
              class="erp-btn erp-btn-danger"
              :disabled="saving || dirty || !can('block')"
              :title="supplier.refusals.block ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setStatus('block')"
            >
              Block
            </button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setStatus('activate')">Activate</button>
            <button v-if="anyEditable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">Save changes</button>
            <RouterLink v-else to="/core/suppliers" class="erp-btn erp-btn-secondary">Back</RouterLink>
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
                <label for="code">Supplier code</label>
                <span v-if="!isNew" class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ supplier?.code ?? 'Given when you save' }}</div>
            </div>
            <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
              <input id="name" v-model="form.name" class="erp-input" maxlength="150" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Short name" for="shortName" :error="errors.shortName">
              <input id="shortName" v-model="form.shortName" class="erp-input" maxlength="60" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Supplies" for="supplies" :error="errors.category" class="col-span-2">
              <input id="supplies" v-model="form.category" class="erp-input" maxlength="100" placeholder="Furniture, timber" :disabled="!detailsEditable" />
            </FormField>
          </div>
          <span class="inline-flex items-center gap-2 text-[13px] font-medium"><SwitchToggle v-model="form.isWalkIn" label="Walk-in shop, for cash purchases" :disabled="!detailsEditable" />Walk-in shop, for cash purchases</span>
        </section>

        <!-- Contact -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Contact</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Contact" for="contact" :error="errors.contactName">
              <input id="contact" v-model="form.contactName" class="erp-input" maxlength="100" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Email · POs and RFQs go here" for="email" :error="errors.email">
              <input id="email" v-model="form.email" class="erp-input" type="email" maxlength="150" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Phone" for="phone" :error="errors.phone">
              <input id="phone" v-model="form.phone" class="erp-input" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Address" for="address" :error="errors.address" class="col-span-3">
              <textarea id="address" v-model="form.address" class="erp-input" rows="2" maxlength="300" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
          </div>
        </section>

        <!-- Tax identity -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Tax identity</h2>
          <NoticeBanner v-if="eInvoiceGap" kind="warning">{{ eInvoiceGap }}</NoticeBanner>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="TIN" for="tin" :error="errors.tin">
              <input id="tin" v-model="form.tin" class="erp-input uppercase placeholder:normal-case" maxlength="20" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="ID type" for="idType" :error="errors.idType">
              <select id="idType" v-model="form.idType" class="erp-input" :disabled="!detailsEditable">
                <option value="">—</option>
                <option v-for="t in options.idTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </FormField>
            <FormField label="ID number" for="regNo" :error="errors.regNo">
              <input id="regNo" v-model="form.regNo" class="erp-input uppercase placeholder:normal-case" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Sales tax no" for="sstNo" :error="errors.sstNo">
              <input id="sstNo" v-model="form.sstNo" class="erp-input" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Service tax no" for="serviceTax" :error="errors.serviceTaxNo">
              <input id="serviceTax" v-model="form.serviceTaxNo" class="erp-input" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="e-Invoice email" for="einvoiceEmail" :error="errors.einvoiceEmail">
              <input id="einvoiceEmail" v-model="form.einvoiceEmail" class="erp-input" type="email" maxlength="150" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
          </div>
        </section>

        <!-- Terms -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Terms</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Payment term" for="term" :error="errors.paymentTermDays">
              <select id="term" v-model.number="form.paymentTermDays" class="erp-input" :disabled="!detailsEditable">
                <option v-if="!options.paymentTerms.some((t) => t.days === form.paymentTermDays)" :value="form.paymentTermDays">{{ form.paymentTermDays }} days</option>
                <option v-for="t in options.paymentTerms" :key="t.days" :value="t.days">{{ t.name }}</option>
              </select>
            </FormField>
            <FormField label="Currency" for="currency" :error="errors.currency">
              <select id="currency" v-model="form.currency" class="erp-input" :disabled="!detailsEditable">
                <option v-for="c in options.currencies" :key="c" :value="c">{{ c }}</option>
              </select>
            </FormField>
          </div>
        </section>

        <!-- Contract prices -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <div class="flex items-center justify-between">
            <h2 class="m-0 text-[15px] font-bold">Contract prices</h2>
            <button v-if="contractsEditable" type="button" class="erp-btn erp-btn-secondary" @click="addContract"><Plus :size="14" aria-hidden="true" />Add contract price</button>
          </div>
          <p v-if="!form.contractPrices.length" class="m-0 text-[13px] text-erp-muted">No contract prices.</p>
          <table v-else class="erp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Name</th>
                <th class="num w-[130px]">Unit price</th>
                <th class="w-[150px]">Valid from</th>
                <th class="w-[150px]">Valid to</th>
                <th v-if="contractsEditable" class="w-[60px]"><span class="sr-only">Change</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(c, n) in form.contractPrices" :key="c.key">
                <tr v-if="!c.editing">
                  <td class="whitespace-nowrap"><RouterLink v-if="c.itemId" :to="`/core/items/${c.itemId}`" class="erp-link font-semibold">{{ c.item?.code }}</RouterLink></td>
                  <td>{{ c.item?.name }}</td>
                  <td class="num whitespace-nowrap">RM {{ formatMoney(c.unitPrice, 4) }}</td>
                  <td class="whitespace-nowrap">{{ formatDate(c.validFrom) }}</td>
                  <td class="whitespace-nowrap">{{ c.validTo ? formatDate(c.validTo) : 'No end' }}</td>
                  <td v-if="contractsEditable" class="whitespace-nowrap text-right">
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-erp-text" :aria-label="`Change contract price for ${c.item?.code}`" @click="c.editing = true"><Pencil :size="14" /></button>
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove contract price for ${c.item?.code}`" @click="form.contractPrices.splice(n, 1)"><X :size="15" /></button>
                  </td>
                </tr>
                <tr v-else>
                  <template v-if="c.itemId">
                    <td class="font-semibold whitespace-nowrap">{{ c.item?.code }}</td>
                    <td>{{ c.item?.name }}</td>
                  </template>
                  <td v-else colspan="2"><MasterDataPicker v-model="c.item" :search="searchItems" placeholder="Type an item code or name" :input-id="`contract-${n}`" /></td>
                  <td><input v-model="c.unitPrice" class="erp-input text-right" inputmode="decimal" placeholder="2100.00" :aria-label="`Contract price ${n + 1}: unit price`" /></td>
                  <td>
                    <DatePicker :model-value="isoToDate(c.validFrom)" date-format="d M yy" fluid class="erp-date" :input-id="`contract-from-${n}`" @update:model-value="c.validFrom = dateToIso($event)" />
                  </td>
                  <td>
                    <DatePicker
                      :model-value="isoToDate(c.validTo)"
                      date-format="d M yy"
                      placeholder="No end"
                      show-button-bar
                      fluid
                      class="erp-date"
                      :input-id="`contract-to-${n}`"
                      @update:model-value="c.validTo = dateToIso($event)"
                      @clear-click="c.validTo = ''"
                    />
                  </td>
                  <td class="text-right">
                    <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-erp-muted hover:text-note-error-text" :aria-label="`Remove contract price ${n + 1}`" @click="form.contractPrices.splice(n, 1)"><X :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="errors[`contractPrices[${n}]`]">
                  <td :colspan="contractsEditable ? 6 : 5" class="pt-0 text-xs font-medium text-note-error-text" role="alert">{{ errors[`contractPrices[${n}]`] }}</td>
                </tr>
              </template>
            </tbody>
          </table>
          <span class="text-xs text-erp-muted">An item with a contract price skips the RFQ, and Purchase drafts buy-to-order POs at this price.</span>
        </section>
      </div>

      <div class="flex flex-col gap-4">
        <template v-if="supplier">
          <InUseCard :usage="supplier.usage" :waits="blockWaits" />
          <SideCard title="Who can change it">
            <p class="m-0 text-[13px] text-erp-muted">
              The Master Data Admin, buyers and the Purchasing Manager. Contract prices: only the Purchasing Manager and the Master Data Admin, because a contract price lets an order skip the RFQ.
              Every change is logged with the old and new value.
            </p>
          </SideCard>
          <ActivityList v-if="supplier.activity.length" :items="supplier.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
        </template>
        <SideCard v-else title="New supplier">
          <p class="m-0 text-[13px] text-erp-muted">Once saved, Purchase can pick the supplier on requests for quotation, orders and cash purchases straight away.</p>
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
