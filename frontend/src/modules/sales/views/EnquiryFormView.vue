<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Plus, X } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import LinkedDocs from '@/components/erp/LinkedDocs.vue'
import MasterDataPicker from '@/components/erp/MasterDataPicker.vue'
import NextSteps from '@/components/erp/NextSteps.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { formatDate, formatQty, formatRm } from '@/utils/format'
import { isPositiveDecimal } from '@/utils/money'
import { salesEnquiriesApi, salesLookupsApi } from '../api/sales'
import ItemPickerDialog from '../components/ItemPickerDialog.vue'
import ReasonDialog from '../components/ReasonDialog.vue'
import { docRoute } from '../routes'
import type { CustomerCardData, CustomerOption, EnquiryAction, EnquiryDetail, EnquiryTypeOption, SaleItemOption } from '../types'

/** S07 · New enquiry / enquiry (EnquiryForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const { today, user } = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const enquiry = ref<EnquiryDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const types = ref<EnquiryTypeOption[]>([])
const sources = ref<{ code: string; name: string }[]>([])
const agents = ref<{ code: string; name: string; branchCodes: string[] }[]>([])
const branches = ref<{ code: string; name: string }[]>([])
const card = ref<CustomerCardData | null>(null)
const pickerOpen = ref(false)
const lostOpen = ref(false)

interface ItemRow {
  key: number
  itemCode: string
  itemName: string
  uomCode: string
  qty: string
  remarks: string
}
let nextKey = 1
const form = reactive({
  isProspect: false,
  customer: null as CustomerOption | null,
  prospectName: '',
  contactName: '',
  phone: '',
  email: '',
  branchCode: '',
  docDate: '',
  enquiryTypeCode: '',
  sourceCode: '',
  agentCode: '',
  budget: '',
  neededBy: '',
  customerRef: '',
  description: '',
  details: {} as Record<string, string>,
  items: [] as ItemRow[],
})
const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const dateToIso = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')

const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: EnquiryAction) => (isNew.value ? a === 'edit' : Boolean(enquiry.value?.allowedActions.includes(a)))
const editable = computed(() => isNew.value || can('edit'))
const currentType = computed(() => types.value.find((t) => t.code === form.enquiryTypeCode) ?? null)

function fill(e: EnquiryDetail | null) {
  if (e) {
    form.isProspect = e.isProspect && !e.customerCode
    form.customer = e.customerCode
      ? { code: e.customerCode, name: e.customerName, branchCode: e.branch.code, contactName: e.contactName, deliveryAddress: null, creditTermDays: 0, priceListCode: '', creditLimit: null, defaultAgentCode: null }
      : null
    form.prospectName = e.customerCode ? '' : e.customerName
    form.contactName = e.contactName ?? ''
    form.phone = e.phone ?? ''
    form.email = e.email ?? ''
    form.branchCode = e.branch.code
    form.docDate = e.docDate
    form.enquiryTypeCode = e.enquiryTypeCode
    form.sourceCode = e.sourceCode
    form.agentCode = e.agent.code
    form.budget = e.budget ?? ''
    form.neededBy = e.neededBy ?? ''
    form.customerRef = e.customerRef ?? ''
    form.description = e.description ?? ''
    form.details = { ...e.details }
    form.items = e.items.map((i) => ({ key: nextKey++, itemCode: i.itemCode, itemName: i.itemName, uomCode: i.uomCode, qty: formatQty(i.qty).replace(/,/g, ''), remarks: i.remarks ?? '' }))
    card.value = e.customerCard
  } else {
    Object.assign(form, {
      isProspect: false, customer: null, prospectName: '', contactName: '', phone: '', email: '', branchCode: user.value?.branchCodes[0] ?? '',
      docDate: today.value, enquiryTypeCode: '', sourceCode: '', agentCode: user.value?.roles.includes('SALES_AGENT') ? user.value.code : '',
      budget: '', neededBy: '', customerRef: '', description: '', details: {}, items: [],
    })
    card.value = null
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    const [t, a, b] = await Promise.all([salesLookupsApi.enquiryTypes(), salesLookupsApi.agents(), salesLookupsApi.branches()])
    types.value = t.types
    sources.value = t.sources
    agents.value = a.items
    branches.value = b.items
    enquiry.value = isNew.value ? null : await salesEnquiriesApi.get(id.value)
    fill(enquiry.value)
    setCrumb(enquiry.value?.docNo ?? 'New enquiry')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(e: EnquiryDetail) {
  enquiry.value = e
  fill(e)
  setCrumb(e.docNo)
}

const searchCustomers = async (q: string) => (await salesLookupsApi.customers(q)).items
async function onCustomerPicked(c: CustomerOption) {
  form.customer = c
  form.branchCode = c.branchCode
  if (!form.contactName) form.contactName = c.contactName ?? ''
  card.value = await salesEnquiriesApi.customerCard(c.code)
  if (card.value) {
    if (!form.phone) form.phone = card.value.phone ?? ''
    if (!form.email) form.email = card.value.email ?? ''
    if (!form.agentCode && c.defaultAgentCode) form.agentCode = c.defaultAgentCode
  }
}
watch(
  () => form.isProspect,
  (prospect) => {
    if (prospect) {
      form.customer = null
      card.value = null
    } else form.prospectName = ''
  },
)

function addItems(picked: { item: SaleItemOption; qty: string }[]) {
  for (const { item, qty } of picked) form.items.push({ key: nextKey++, itemCode: item.code, itemName: item.name, uomCode: item.uomCode, qty, remarks: '' })
}

function body() {
  return {
    isProspect: form.isProspect,
    customerCode: form.customer?.code,
    prospectName: form.prospectName,
    branchCode: form.branchCode || undefined,
    contactName: form.contactName,
    phone: form.phone,
    email: form.email || undefined,
    docDate: form.docDate || undefined,
    enquiryTypeCode: form.enquiryTypeCode,
    sourceCode: form.sourceCode,
    agentCode: form.agentCode || undefined,
    budget: form.budget || null,
    neededBy: form.neededBy || null,
    customerRef: form.customerRef,
    description: form.description,
    details: form.details,
    items: form.items.map((i) => ({ itemCode: i.itemCode, qty: i.qty, remarks: i.remarks })),
  }
}

function validate(): boolean {
  const e: Record<string, string> = {}
  if (form.isProspect && !form.prospectName.trim()) e.prospectName = 'Type the company or person asking.'
  if (!form.isProspect && !form.customer) e.customerCode = 'Pick the customer from Master Data, or tick New prospect.'
  if (!form.enquiryTypeCode) e.enquiryTypeCode = 'Pick the enquiry type.'
  if (!form.sourceCode) e.sourceCode = 'Pick where the enquiry came from.'
  if (!form.agentCode) e.agentCode = 'Pick the sales agent.'
  if (form.budget && !/^\d+(\.\d{1,2})?$/.test(form.budget)) e.budget = 'Budget must be an amount like 95000.00.'
  form.items.forEach((i, n) => {
    if (!isPositiveDecimal(i.qty)) e[`items[${n}].qty`] = 'Quantity must be more than 0.'
  })
  for (const d of currentType.value?.details ?? []) {
    if (d.required && d.kind !== 'FILE' && !form.details[d.label]?.trim()) e[`details.${d.label}`] = `${d.label} is needed for this enquiry type.`
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function save(forward = false) {
  if (!validate()) {
    toast.add({ severity: 'error', summary: 'Please check the highlighted fields.', life: 4000 })
    return
  }
  saving.value = true
  try {
    const result = isNew.value
      ? await salesEnquiriesApi.create({ ...body(), forward })
      : await salesEnquiriesApi.update(id.value, { ...body(), version: enquiry.value!.version })
    toast.add({ severity: 'success', summary: isNew.value ? `${result.docNo} saved${forward ? ' and forwarded' : ''}` : 'Enquiry saved', life: 3000 })
    if (isNew.value) await router.replace(`/sales/enquiries/${result.id}`)
    show(result)
  } catch (error) {
    if (error instanceof ApiError) errors.value = { ...errors.value, ...error.fieldErrors }
  } finally {
    saving.value = false
  }
}

async function forwardNow() {
  if (dirty.value) await save()
  const e = enquiry.value!
  show(await salesEnquiriesApi.forward(e.id, e.version))
  toast.add({ severity: 'success', summary: `Forwarded to ${e.agent.name}`, life: 3000 })
}

async function createQuotation() {
  if (dirty.value) await save()
  saving.value = true
  try {
    const q = await salesEnquiriesApi.createQuotation(enquiry.value!.id)
    toast.add({ severity: 'success', summary: `${q.docNo} created`, detail: 'Customer and items copied. Check prices and discounts, then release.', life: 4000 })
    void router.push(`/sales/quotations/${q.id}`)
  } finally {
    saving.value = false
  }
}

async function markLost(reason: string) {
  const e = enquiry.value!
  show(await salesEnquiriesApi.lost(e.id, e.version, reason))
  lostOpen.value = false
  toast.add({ severity: 'success', summary: `${e.docNo} closed as lost`, life: 3000 })
}

function deleteEnquiry() {
  const e = enquiry.value!
  confirm.require({
    header: `Delete ${e.docNo}?`,
    message: `The enquiry is removed. Its number ${e.docNo} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await salesEnquiriesApi.remove(e.id, e.version)
      toast.add({ severity: 'success', summary: `${e.docNo} deleted`, life: 3000 })
      void router.push('/sales/enquiries')
    },
  })
}

const GROUP: Record<string, 'draft' | 'released' | 'done' | 'cancelled'> = { NEW: 'draft', FORWARDED: 'released', QUOTED: 'done', LOST: 'cancelled' }
const branchName = computed(() => branches.value.find((b) => b.code === form.branchCode)?.name ?? enquiry.value?.branch.name ?? '')
const myBranches = computed(() => branches.value.filter((b) => user.value?.branchCodes.includes(b.code)))
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <PageHeader :title="isNew ? 'New enquiry' : `Enquiry ${enquiry?.docNo ?? ''}`" document>
      <template #chip>
        <StatusChip v-if="enquiry" :status="enquiry.status" :label="enquiry.statusLabel" :group="GROUP[enquiry.status]" />
        <StatusChip v-else status="DRAFT" label="Draft" />
      </template>
      <template #subtitle>
        <template v-if="enquiry">{{ enquiry.customerName }}<template v-if="enquiry.isProspect"> (prospect)</template> · {{ enquiry.typeName }} · from {{ enquiry.sourceName }}</template>
        <template v-else>The enquiry number is given when you save.</template>
      </template>
      <template #actions>
        <template v-if="isNew">
          <RouterLink to="/sales/enquiries" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
          <button type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="save(false)">Save draft</button>
          <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save(true)">Save and forward to agent</button>
        </template>
        <template v-else-if="enquiry">
          <RouterLink to="/sales/enquiries" class="erp-btn erp-btn-secondary">Back</RouterLink>
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving" @click="deleteEnquiry">Delete</button>
          <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || !dirty" @click="save(false)">Save</button>
          <button v-if="can('markLost')" type="button" class="erp-btn erp-btn-danger" :disabled="saving" @click="lostOpen = true">Mark as lost</button>
          <button v-if="can('forward')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="forwardNow">Forward to agent</button>
          <button v-if="can('createQuotation')" type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="createQuotation">Create quotation</button>
          <RouterLink v-if="enquiry.quotation" :to="docRoute('SAL_QUOTATION', enquiry.quotation.id)!" class="erp-btn erp-btn-primary">Open {{ enquiry.quotation.no }}</RouterLink>
        </template>
      </template>
    </PageHeader>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_330px]">
      <div class="flex min-w-0 flex-col gap-4">
        <NoticeBanner v-if="enquiry?.status === 'LOST'" kind="error">Closed as lost<template v-if="enquiry.lostReason">: “{{ enquiry.lostReason }}”</template>.</NoticeBanner>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Customer</h2>
            <div v-if="isNew" class="flex overflow-hidden rounded-lg border border-erp-border text-[13px] font-semibold" role="radiogroup" aria-label="Customer type">
              <button
                v-for="opt in [{ v: false, l: 'Existing customer' }, { v: true, l: 'New prospect' }]"
                :key="opt.l"
                type="button"
                role="radio"
                :aria-checked="form.isProspect === opt.v"
                class="cursor-pointer border-0 px-3.5 py-2"
                :class="form.isProspect === opt.v ? 'bg-mod-light text-mod-accent' : 'bg-erp-card text-erp-text'"
                @click="form.isProspect = opt.v"
              >
                {{ opt.l }}
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-x-4 gap-y-3">
            <FormField v-if="!form.isProspect" label="Customer · from Master Data" :error="errors.customerCode" for="eq-customer">
              <MasterDataPicker v-if="isNew" v-model="form.customer" input-id="eq-customer" :search="searchCustomers" :invalid="Boolean(errors.customerCode)" placeholder="Type a customer code or name" :display="(c) => `${c.name} (${c.code})`" @picked="onCustomerPicked" />
              <div v-else class="erp-input-ro truncate">{{ form.customer?.name }} ({{ form.customer?.code }})</div>
            </FormField>
            <FormField v-else label="Company or person (new prospect)" :error="errors.prospectName" for="eq-prospect">
              <input v-if="isNew" id="eq-prospect" v-model="form.prospectName" class="erp-input" maxlength="150" :aria-invalid="Boolean(errors.prospectName)" />
              <div v-else class="erp-input-ro">{{ form.prospectName }}</div>
            </FormField>
            <FormField label="Contact name" for="eq-contact">
              <input v-if="editable" id="eq-contact" v-model="form.contactName" class="erp-input" maxlength="100" />
              <div v-else class="erp-input-ro">{{ form.contactName || '—' }}</div>
            </FormField>
            <FormField label="Phone" for="eq-phone">
              <input v-if="editable" id="eq-phone" v-model="form.phone" class="erp-input" maxlength="30" />
              <div v-else class="erp-input-ro">{{ form.phone || '—' }}</div>
            </FormField>
            <FormField label="Email" :error="errors.email" for="eq-email">
              <input v-if="editable" id="eq-email" v-model="form.email" class="erp-input" maxlength="150" />
              <div v-else class="erp-input-ro">{{ form.email || '—' }}</div>
            </FormField>
            <FormField label="Branch" for="eq-branch">
              <select v-if="isNew" id="eq-branch" v-model="form.branchCode" class="erp-input">
                <option v-for="b in myBranches" :key="b.code" :value="b.code">{{ b.name }}</option>
              </select>
              <div v-else class="erp-input-ro">{{ branchName }}</div>
            </FormField>
            <FormField label="Enquiry date" for="eq-date">
              <DatePicker v-if="editable" input-id="eq-date" :model-value="isoToDate(form.docDate)" date-format="d M yy" show-icon fluid class="erp-date" @update:model-value="form.docDate = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.docDate) }}</div>
            </FormField>
          </div>
        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <h2 class="m-0 text-[15px] font-bold">Enquiry details</h2>
          <div class="grid grid-cols-3 gap-x-4 gap-y-3">
            <FormField label="Enquiry type" :error="errors.enquiryTypeCode" for="eq-type">
              <select v-if="editable" id="eq-type" v-model="form.enquiryTypeCode" class="erp-input" :aria-invalid="Boolean(errors.enquiryTypeCode)">
                <option value="" disabled>Pick a type</option>
                <option v-for="t in types" :key="t.code" :value="t.code">{{ t.name }}</option>
              </select>
              <div v-else class="erp-input-ro">{{ enquiry?.typeName }}</div>
            </FormField>
            <FormField label="Enquiry from" :error="errors.sourceCode" for="eq-source">
              <select v-if="editable" id="eq-source" v-model="form.sourceCode" class="erp-input" :aria-invalid="Boolean(errors.sourceCode)">
                <option value="" disabled>Pick a source</option>
                <option v-for="s in sources" :key="s.code" :value="s.code">{{ s.name }}</option>
              </select>
              <div v-else class="erp-input-ro">{{ enquiry?.sourceName }}</div>
            </FormField>
            <FormField label="Sales agent" :error="errors.agentCode" for="eq-agent">
              <select v-if="editable" id="eq-agent" v-model="form.agentCode" class="erp-input" :aria-invalid="Boolean(errors.agentCode)">
                <option value="" disabled>Pick an agent</option>
                <option v-for="a in agents" :key="a.code" :value="a.code">{{ a.name }}</option>
              </select>
              <div v-else class="erp-input-ro">{{ enquiry?.agent.name }}</div>
            </FormField>
            <FormField label="Customer budget (RM)" :error="errors.budget" for="eq-budget">
              <input v-if="editable" id="eq-budget" v-model="form.budget" class="erp-input text-right" inputmode="decimal" :aria-invalid="Boolean(errors.budget)" />
              <div v-else class="erp-input-ro text-right">{{ form.budget ? formatRm(form.budget) : '—' }}</div>
            </FormField>
            <FormField label="Needed by" for="eq-needed">
              <DatePicker v-if="editable" input-id="eq-needed" :model-value="isoToDate(form.neededBy)" date-format="d M yy" show-icon show-button-bar fluid class="erp-date" @update:model-value="form.neededBy = dateToIso($event)" />
              <div v-else class="erp-input-ro">{{ formatDate(form.neededBy) || '—' }}</div>
            </FormField>
            <FormField label="Customer reference" for="eq-ref">
              <input v-if="editable" id="eq-ref" v-model="form.customerRef" class="erp-input" maxlength="50" />
              <div v-else class="erp-input-ro">{{ form.customerRef || '—' }}</div>
            </FormField>
            <FormField class="col-span-3" label="Description" for="eq-desc">
              <textarea v-if="editable" id="eq-desc" v-model="form.description" rows="3" class="erp-input h-auto py-2" maxlength="4000" />
              <div v-else class="erp-input-ro h-auto min-h-9 py-2 whitespace-pre-line">{{ form.description || '—' }}</div>
            </FormField>
            <template v-for="d in currentType?.details ?? []" :key="d.label">
              <FormField :label="`${d.label}${d.required ? '' : ' (optional)'}`" :error="errors[`details.${d.label}`]" :for="`eq-d-${d.label}`">
                <div v-if="d.kind === 'FILE'" class="erp-input-ro text-erp-muted">Attach files after saving</div>
                <select v-else-if="d.kind === 'CHOICE' && editable" :id="`eq-d-${d.label}`" v-model="form.details[d.label]" class="erp-input">
                  <option value="">—</option>
                  <option v-for="c in d.choices ?? []" :key="c" :value="c">{{ c }}</option>
                </select>
                <input v-else-if="editable" :id="`eq-d-${d.label}`" v-model="form.details[d.label]" class="erp-input" :type="d.kind === 'DATE' ? 'date' : 'text'" :inputmode="d.kind === 'NUMBER' ? 'numeric' : undefined" />
                <div v-else class="erp-input-ro">{{ form.details[d.label] || '—' }}</div>
              </FormField>
            </template>
          </div>

        </section>

        <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Items of interest <span class="font-normal text-erp-muted">(optional, copied to the quotation)</span></h2>
            <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" @click="pickerOpen = true"><Plus :size="14" aria-hidden="true" />Add item</button>
          </div>
          <div class="flex flex-col gap-2">
            <div class="overflow-x-auto">
              <table class="erp-table">
                <thead><tr><th>Item code</th><th>Description</th><th class="num">Qty</th><th>UOM</th><th>Remarks</th><th v-if="editable" aria-label="Remove" /></tr></thead>
                <tbody>
                  <tr v-if="!form.items.length"><td :colspan="editable ? 6 : 5" class="text-erp-muted">No items yet.</td></tr>
                  <tr v-for="(i, n) in form.items" :key="i.key">
                    <td class="font-bold whitespace-nowrap">{{ i.itemCode }}</td>
                    <td>{{ i.itemName }}</td>
                    <td class="num w-[90px]">
                      <input v-if="editable" v-model="i.qty" class="erp-cell min-w-[60px]" inputmode="decimal" :aria-invalid="Boolean(errors[`items[${n}].qty`])" :aria-label="`Quantity of ${i.itemCode}`" />
                      <template v-else>{{ formatQty(i.qty) }}</template>
                    </td>
                    <td>{{ i.uomCode }}</td>
                    <td>
                      <input v-if="editable" v-model="i.remarks" class="erp-cell text-left" maxlength="200" :aria-label="`Remarks for ${i.itemCode}`" />
                      <template v-else>{{ i.remarks || '—' }}</template>
                    </td>
                    <td v-if="editable" class="w-8">
                      <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-erp-muted hover:bg-erp-head" :aria-label="`Remove ${i.itemCode}`" @click="form.items.splice(n, 1)"><X :size="14" /></button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <ActivityList v-if="enquiry" :items="enquiry.activity" />
      </div>

      <aside class="flex flex-col gap-4">
        <SideCard v-if="card" title="From Master Data">
          <template #chip><StatusChip :status="card.status === 'ACTIVE' ? 'DONE' : 'DRAFT'" :label="card.status === 'ACTIVE' ? 'Active' : card.status === 'PROSPECT' ? 'Prospect' : 'Blocked'" /></template>
          <p class="m-0 text-xs text-erp-muted">{{ card.name }} · {{ card.code }}. Read-only here; change it in Master Data.</p>
          <div class="flex flex-col text-[13px]">
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Category</span><span>{{ card.category ?? '—' }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Area</span><span>{{ card.area ?? '—' }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Credit term</span><span>{{ card.creditTermDays }} days</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Credit limit</span><span class="erp-num">{{ card.creditLimit ? formatRm(card.creditLimit) : 'No limit' }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Owed now</span><span class="erp-num">{{ formatRm(card.owedNow) }}</span></div>
            <div class="flex justify-between gap-3 border-b border-erp-row py-[6px]"><span class="text-erp-muted">Default agent</span><span>{{ card.defaultAgent ?? '—' }}</span></div>
            <div class="flex justify-between gap-3 py-[6px]"><span class="text-erp-muted">Price list</span><span>{{ card.priceList }}</span></div>
          </div>
        </SideCard>
        <SideCard v-else-if="form.isProspect || enquiry?.isProspect" title="New prospect">
          <p class="m-0 text-[13px] text-erp-subtle">Not in Master Data yet. Admin adds the customer in Core; the enquiry keeps its link.</p>
        </SideCard>

        <NextSteps title="What happens next">
          <li><span>Save gives the enquiry its number.</span></li>
          <li><span>Forward notifies the sales agent.</span></li>
          <li><span>Create quotation copies the customer and items.</span></li>
          <template #footer>
            <p class="m-0 rounded-lg border border-note-warn-border bg-note-warn-bg px-3 py-2 text-xs text-note-warn-text">A new prospect must be added to Master Data before a quotation can be created.</p>
          </template>
        </NextSteps>

        <LinkedDocs v-if="enquiry && enquiry.links.length" :docs="enquiry.links" :route-of="docRoute" />
      </aside>
    </div>

    <ItemPickerDialog
      v-model:visible="pickerOpen"
      :context="`${enquiry?.docNo ?? 'New enquiry'} · ${form.customer?.name ?? (form.prospectName || 'prospect')} · ${branchName}`"
      :customer-code="form.customer?.code ?? null"
      :branch-code="form.branchCode || null"
      :branch-name="branchName || 'this branch'"
      :on-lines="Object.fromEntries(form.items.map((i, n) => [i.itemCode, n + 1]))"
      @add="addItems"
    />
    <ReasonDialog
      v-model:visible="lostOpen"
      :title="`Mark ${enquiry?.docNo} as lost`"
      message="The enquiry is closed. It stays in the list under Lost."
      label="Why was it lost?"
      confirm-label="Mark as lost"
      danger
      @confirm="markLost"
    />
  </template>
</template>
