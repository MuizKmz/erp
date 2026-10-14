<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { useSession } from '@/composables/useSession'
import { coreCustomersApi, coreLookupsApi } from '../api/core'
import InUseCard from '../components/InUseCard.vue'
import type { CustomerAction, CustomerDetail, CustomerFormOptions, CustomerInput, IdType } from '../types'
import { CUSTOMER_STATUS_GROUP } from './customers'

/** C05 · New customer / customer (CoreCustomerForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()
const session = useSession()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const customer = ref<CustomerDetail | null>(null)
const options = ref<CustomerFormOptions | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

const form = reactive({
  name: '',
  category: '',
  area: '',
  branchCode: '',
  defaultAgentCode: '',
  cameFromEnquiry: '',
  billingAddress: '',
  deliveryAddress: '',
  contactName: '',
  email: '',
  phone: '',
  tin: '',
  idType: 'BRN' as IdType | '',
  idNumber: '',
  salesTaxNo: '',
  serviceTaxNo: '',
  einvoiceEmail: '',
  taxMode: 'EXCLUSIVE' as 'EXCLUSIVE' | 'INCLUSIVE',
  creditTermDays: 30,
  creditLimit: '',
  overdueLimit: '',
  creditScope: '' as '' | 'GROUP' | 'BRANCH',
  priceListCode: '',
})

const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: CustomerAction) => Boolean(customer.value?.allowedActions.includes(a))
/** Name, address, tax identity, price list … need core.customer.edit; the credit card needs core.customer.credit. */
const detailsEditable = computed(() => (isNew.value ? session.can('core.customer.edit') : can('edit')))
const creditEditable = computed(() => (isNew.value ? session.can('core.customer.edit') && session.can('core.customer.credit') : can('editCredit')))
const anyEditable = computed(() => detailsEditable.value || creditEditable.value)
const text = (v: string | null) => v ?? ''

function fill(c: CustomerDetail | null) {
  if (c) {
    Object.assign(form, {
      name: c.name, category: text(c.category), area: text(c.area), branchCode: c.branchCode, defaultAgentCode: text(c.defaultAgentCode), cameFromEnquiry: text(c.cameFromEnquiry),
      billingAddress: text(c.billingAddress), deliveryAddress: text(c.deliveryAddress), contactName: text(c.contactName), email: text(c.email), phone: text(c.phone),
      tin: text(c.tin), idType: c.idType ?? '', idNumber: text(c.idNumber), salesTaxNo: text(c.salesTaxNo), serviceTaxNo: text(c.serviceTaxNo), einvoiceEmail: text(c.einvoiceEmail),
      taxMode: c.taxMode, creditTermDays: c.creditTermDays, creditLimit: text(c.creditLimit), overdueLimit: text(c.overdueLimit), creditScope: c.creditScope ?? '', priceListCode: c.priceListCode,
    })
  } else {
    Object.assign(form, {
      name: '', category: '', area: '', branchCode: session.user.value?.branchCodes[0] ?? '', defaultAgentCode: '', cameFromEnquiry: '', billingAddress: '', deliveryAddress: '',
      contactName: '', email: '', phone: '', tin: '', idType: 'BRN', idNumber: '', salesTaxNo: '', serviceTaxNo: '', einvoiceEmail: '', taxMode: 'EXCLUSIVE',
      creditTermDays: options.value?.creditTerms.find((t) => t.days === 30)?.days ?? options.value?.creditTerms[0]?.days ?? 0, creditLimit: '', overdueLimit: '', creditScope: '',
      priceListCode: options.value?.priceLists[0]?.code ?? '',
    })
  }
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    options.value = await coreLookupsApi.customerForm()
    customer.value = isNew.value ? null : await coreCustomersApi.get(id.value)
    fill(customer.value)
    setCrumb(customer.value?.code ?? 'New customer')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function show(c: CustomerDetail) {
  customer.value = c
  fill(c)
  setCrumb(c.code)
}

const blankToNull = (v: string) => v.trim() || null
function body(): CustomerInput {
  return {
    name: form.name.trim(),
    category: form.category || null,
    area: form.area || null,
    branchCode: form.branchCode,
    defaultAgentCode: form.defaultAgentCode || null,
    billingAddress: blankToNull(form.billingAddress),
    deliveryAddress: blankToNull(form.deliveryAddress),
    contactName: blankToNull(form.contactName),
    email: blankToNull(form.email),
    phone: blankToNull(form.phone),
    tin: blankToNull(form.tin),
    idType: form.idType || null,
    idNumber: blankToNull(form.idNumber),
    salesTaxNo: blankToNull(form.salesTaxNo),
    serviceTaxNo: blankToNull(form.serviceTaxNo),
    einvoiceEmail: blankToNull(form.einvoiceEmail),
    taxMode: form.taxMode,
    creditTermDays: Number(form.creditTermDays),
    creditLimit: blankToNull(form.creditLimit),
    overdueLimit: blankToNull(form.overdueLimit),
    creditScope: form.creditScope || null,
    priceListCode: form.priceListCode,
  }
}

async function save(status: 'ACTIVE' | 'PROSPECT' = 'ACTIVE') {
  saving.value = true
  errors.value = {}
  try {
    const result = isNew.value
      ? await coreCustomersApi.create({ ...body(), status, cameFromEnquiry: blankToNull(form.cameFromEnquiry) })
      : await coreCustomersApi.update(id.value, { ...body(), version: customer.value!.version })
    toast.add({
      severity: 'success',
      summary: isNew.value ? `${status === 'PROSPECT' ? 'Prospect' : 'Customer'} ${result.code} created` : 'Customer saved',
      detail: isNew.value && result.cameFromEnquiry ? `Sales links ${result.cameFromEnquiry} to ${result.code} in a moment.` : undefined,
      life: 4000,
    })
    if (isNew.value) await router.replace(`/core/customers/${result.id}`)
    show(result)
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

async function setStatus(action: 'block' | 'activate') {
  const c = customer.value!
  const run = async () => {
    show(await coreCustomersApi.setStatus(c.id, action, c.version))
    toast.add({ severity: 'success', summary: action === 'block' ? `${c.code} blocked` : `${c.code} is an active customer`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({
    header: `Block ${c.code}?`,
    message: 'Sales cannot use a blocked customer on new quotations, orders or invoices. You can activate it again.',
    acceptLabel: 'Block',
    rejectLabel: 'Keep it',
    accept: run,
  })
}

function deleteCustomer() {
  const c = customer.value!
  confirm.require({
    header: `Delete ${c.code}?`,
    message: `No Sales document uses this customer, so it can go. The number ${c.code} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await coreCustomersApi.remove(c.id, c.version)
      toast.add({ severity: 'success', summary: `${c.code} deleted`, life: 3000 })
      void router.push('/core/customers')
    },
  })
}

/** "Hotel Seri Bayu Sdn Bhd · Hospitality · Central · HQ Shah Alam" */
const subtitle = computed(() => {
  const c = customer.value
  if (!c) return 'The customer number is given when you save.'
  return [c.name, c.category, c.area, c.branchName].filter(Boolean).join(' · ')
})
/** The e-Invoice warning, as the fields are typed (decision 9). Never blocks a save. */
const eInvoiceGap = computed(() => {
  if (customer.value?.isCash) return null
  const noTin = !form.tin.trim()
  const noId = !form.idNumber.trim()
  if (noTin && noId) return 'No TIN or ID number yet. e-Invoices with this customer need both.'
  if (noId) return 'No ID number yet. e-Invoices need it with the TIN.'
  if (noTin) return 'No TIN yet. e-Invoices need it with the ID number.'
  return null
})
const blockWaits = 'Block comes back once these are finished or cancelled. Unpaid invoices do not count: they wait for payment, not for Sales.'
</script>

<template>
  <div v-if="loading" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else-if="options">
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New customer' : `Customer ${customer?.code ?? ''}`" :subtitle="subtitle" document>
        <template #chip>
          <StatusChip v-if="customer" :status="customer.status" :label="customer.statusLabel" :group="CUSTOMER_STATUS_GROUP[customer.status]" />
        </template>
        <template #actions>
          <template v-if="isNew">
            <RouterLink to="/core/customers" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
            <button type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="save('PROSPECT')">Save as prospect</button>
            <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save('ACTIVE')">Save customer</button>
          </template>
          <template v-else-if="customer">
            <button v-if="can('delete')" type="button" class="erp-btn erp-btn-delete" :disabled="saving || dirty" @click="deleteCustomer">Delete</button>
            <button
              v-if="can('block') || customer.refusals.block"
              type="button"
              class="erp-btn erp-btn-danger"
              :disabled="saving || dirty || !can('block')"
              :title="customer.refusals.block ?? (dirty ? 'Save or undo your changes first.' : undefined)"
              @click="setStatus('block')"
            >
              Block
            </button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setStatus('activate')">
              {{ customer.status === 'PROSPECT' ? 'Make customer' : 'Activate' }}
            </button>
            <button v-if="anyEditable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save()">Save changes</button>
            <RouterLink v-else to="/core/customers" class="erp-btn erp-btn-secondary">Back</RouterLink>
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
                <label for="code">Customer code</label>
                <span v-if="!isNew" class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ customer?.code ?? 'Given when you save' }}</div>
            </div>
            <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
              <input id="name" v-model="form.name" class="erp-input" maxlength="150" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Category" for="category" :error="errors.category">
              <select id="category" v-model="form.category" class="erp-input" :disabled="!detailsEditable">
                <option value="">—</option>
                <option v-if="form.category && !options.categories.includes(form.category)" :value="form.category">{{ form.category }}</option>
                <option v-for="c in options.categories" :key="c" :value="c">{{ c }}</option>
              </select>
            </FormField>
            <FormField label="Area" for="area" :error="errors.area">
              <select id="area" v-model="form.area" class="erp-input" :disabled="!detailsEditable">
                <option value="">—</option>
                <option v-if="form.area && !options.areas.includes(form.area)" :value="form.area">{{ form.area }}</option>
                <option v-for="a in options.areas" :key="a" :value="a">{{ a }}</option>
              </select>
            </FormField>
            <FormField label="Branch" for="branch" :error="errors.branchCode">
              <select id="branch" v-model="form.branchCode" class="erp-input" :disabled="!detailsEditable">
                <option value="" disabled>Pick the branch</option>
                <option v-for="b in options.branches" :key="b.code" :value="b.code">{{ b.code }} · {{ b.name }}</option>
              </select>
            </FormField>
            <FormField label="Sales agent" for="agent" :error="errors.defaultAgentCode">
              <select id="agent" v-model="form.defaultAgentCode" class="erp-input" :disabled="!detailsEditable">
                <option value="">—</option>
                <option v-if="form.defaultAgentCode && !options.agents.some((a) => a.code === form.defaultAgentCode)" :value="form.defaultAgentCode">{{ customer?.agentName ?? form.defaultAgentCode }}</option>
                <option v-for="a in options.agents" :key="a.code" :value="a.code">{{ a.name }}</option>
              </select>
            </FormField>
            <FormField label="Came from enquiry" for="enquiry" :error="errors.cameFromEnquiry">
              <input v-if="isNew" id="enquiry" v-model="form.cameFromEnquiry" class="erp-input uppercase" maxlength="30" placeholder="EQ-2609-0010" :disabled="!detailsEditable" />
              <div v-else id="enquiry" class="erp-input-ro">{{ customer?.cameFromEnquiry ?? '—' }}</div>
            </FormField>
          </div>
          <span class="text-xs text-erp-muted">For a new customer, type the enquiry it came from (EQ-2609-0010): Sales then links that enquiry to this customer.</span>
        </section>

        <!-- Address and contact -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Address and contact</h2>
          <div class="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
            <FormField label="Billing address" for="billing" :error="errors.billingAddress">
              <textarea id="billing" v-model="form.billingAddress" class="erp-input" rows="2" maxlength="300" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Delivery address" for="delivery" :error="errors.deliveryAddress">
              <textarea id="delivery" v-model="form.deliveryAddress" class="erp-input" rows="2" maxlength="300" :disabled="!detailsEditable" />
            </FormField>
          </div>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Contact" for="contact" :error="errors.contactName">
              <input id="contact" v-model="form.contactName" class="erp-input" maxlength="100" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Email" for="email" :error="errors.email">
              <input id="email" v-model="form.email" class="erp-input" type="email" maxlength="150" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Phone" for="phone" :error="errors.phone">
              <input id="phone" v-model="form.phone" class="erp-input" maxlength="30" :disabled="!detailsEditable" />
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
            <FormField label="ID number" for="idNumber" :error="errors.idNumber">
              <input id="idNumber" v-model="form.idNumber" class="erp-input uppercase placeholder:normal-case" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Sales tax no" for="salesTax" :error="errors.salesTaxNo">
              <input id="salesTax" v-model="form.salesTaxNo" class="erp-input" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Service tax no" for="serviceTax" :error="errors.serviceTaxNo">
              <input id="serviceTax" v-model="form.serviceTaxNo" class="erp-input" maxlength="30" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="e-Invoice email" for="einvoiceEmail" :error="errors.einvoiceEmail">
              <input id="einvoiceEmail" v-model="form.einvoiceEmail" class="erp-input" type="email" maxlength="150" placeholder="Not set" :disabled="!detailsEditable" />
            </FormField>
            <FormField label="Tax mode" for="taxMode" :error="errors.taxMode">
              <select id="taxMode" v-model="form.taxMode" class="erp-input" :disabled="!detailsEditable">
                <option value="EXCLUSIVE">Exclusive</option>
                <option value="INCLUSIVE">Inclusive</option>
              </select>
            </FormField>
          </div>
        </section>

        <!-- Credit -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Credit</h2>
          <div class="flex items-start gap-2.5 rounded-[10px] border border-mod-light-border bg-mod-light px-3.5 py-2.5 text-[13px] text-mod-accent">
            <Lock :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Only the Finance Manager and the Master Data Admin change these. Every change is logged with the old and new value.</span>
          </div>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField label="Credit term" for="term" :error="errors.creditTermDays">
              <select id="term" v-model.number="form.creditTermDays" class="erp-input" :disabled="!creditEditable">
                <option v-if="!options.creditTerms.some((t) => t.days === form.creditTermDays)" :value="form.creditTermDays">{{ form.creditTermDays }} days</option>
                <option v-for="t in options.creditTerms" :key="t.days" :value="t.days">{{ t.name }}</option>
              </select>
            </FormField>
            <FormField label="Credit limit (RM)" for="creditLimit" :error="errors.creditLimit">
              <input id="creditLimit" v-model="form.creditLimit" class="erp-input" inputmode="decimal" placeholder="No limit" :disabled="!creditEditable" />
            </FormField>
            <FormField label="Overdue limit (RM)" for="overdueLimit" :error="errors.overdueLimit">
              <input id="overdueLimit" v-model="form.overdueLimit" class="erp-input" inputmode="decimal" placeholder="No limit" :disabled="!creditEditable" />
            </FormField>
            <FormField label="Credit checked" for="scope" :error="errors.creditScope" class="col-span-2">
              <select id="scope" v-model="form.creditScope" class="erp-input" :disabled="!creditEditable">
                <option value="">As Credit Control says</option>
                <option value="GROUP">Group-wide, whatever Credit Control says</option>
                <option value="BRANCH">Per branch, whatever Credit Control says</option>
              </select>
            </FormField>
            <FormField label="Price list" for="priceList" :error="errors.priceListCode">
              <select id="priceList" v-model="form.priceListCode" class="erp-input" :disabled="!detailsEditable">
                <option v-if="form.priceListCode && !options.priceLists.some((p) => p.code === form.priceListCode)" :value="form.priceListCode">{{ customer?.priceListName ?? form.priceListCode }}</option>
                <option v-for="p in options.priceLists" :key="p.code" :value="p.code">{{ p.name }}</option>
              </select>
            </FormField>
          </div>
        </section>
      </div>

      <div class="flex flex-col gap-4">
        <template v-if="customer">
          <InUseCard :usage="customer.usage" :waits="blockWaits" />
          <ActivityList v-if="customer.activity.length" :items="customer.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
          <SideCard title="Balance and orders">
            <p class="m-0 text-[13px] text-erp-muted">What the customer owes and orders is in Sales (credit check, invoices). Core keeps only the customer’s details and limits.</p>
          </SideCard>
        </template>
        <SideCard v-else title="New customer">
          <p class="m-0 text-[13px] text-erp-muted">
            <strong>Save customer</strong> makes an active customer that Sales can quote at once. <strong>Save as prospect</strong> keeps it out of quotations until someone makes it a customer.
          </p>
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
