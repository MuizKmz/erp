<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { Lock, Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import ActivityList from '@/components/erp/ActivityList.vue'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { useSession } from '@/composables/useSession'
import { configCompaniesApi } from '../api/config'
import type { CompanyAction, CompanyDetail, CompanyInput, CompanySummary } from '../types'

/** A04 · Company, with its branches (CfgCompany.html). ?company=CODE picks another company; ?new=1 adds one (choice 2). */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const session = useSession()

const companies = ref<CompanySummary[]>([])
const company = ref<CompanyDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

const isNew = computed(() => route.query.new === '1')
const can = (a: CompanyAction) => Boolean(company.value?.allowedActions.includes(a))
const editable = computed(() => (isNew.value ? session.can('config.organisation.edit') : can('edit')))

const form = reactive({ code: '', legalName: '', registrationNo: '', tin: '', salesTaxNo: '', serviceTaxNo: '', myinvoisName: '', address: '', phone: '', email: '' })
const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)

function fill(c: CompanyDetail | null) {
  const t = (v: string | null | undefined) => v ?? ''
  Object.assign(form, {
    code: c?.code ?? '',
    legalName: t(c?.legalName),
    registrationNo: t(c?.registrationNo),
    tin: t(c?.tin),
    salesTaxNo: t(c?.salesTaxNo),
    serviceTaxNo: t(c?.serviceTaxNo),
    myinvoisName: t(c?.myinvoisName),
    address: t(c?.address),
    phone: t(c?.phone),
    email: t(c?.email),
  })
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    companies.value = (await configCompaniesApi.list()).items
    const picked = companies.value.find((c) => c.code === route.query.company) ?? companies.value[0]
    company.value = isNew.value || !picked ? null : await configCompaniesApi.get(picked.id)
    fill(company.value)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => `${String(route.query.company ?? "")}|${String(route.query.new ?? "")}`, load)

/** "The TIN, registration and tax numbers are" + bold "demo values", as the mockup words it. */
const demo = computed(() => {
  const m = company.value?.demoNotice?.match(/^(.*) (demo values?)\.$/)
  return m ? { lead: m[1], word: m[2] } : null
})

const blankToNull = (v: string) => v.trim() || null
const body = (): CompanyInput => ({
  legalName: form.legalName.trim(),
  registrationNo: blankToNull(form.registrationNo),
  tin: blankToNull(form.tin),
  salesTaxNo: blankToNull(form.salesTaxNo),
  serviceTaxNo: blankToNull(form.serviceTaxNo),
  myinvoisName: blankToNull(form.myinvoisName),
  address: blankToNull(form.address),
  phone: blankToNull(form.phone),
  email: blankToNull(form.email),
})

async function save() {
  saving.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      const created = await configCompaniesApi.create({ ...body(), code: form.code.trim().toUpperCase() })
      toast.add({ severity: 'success', summary: `Company ${created.code} created`, life: 3000 })
      await router.replace({ query: { company: created.code } })
    } else {
      company.value = await configCompaniesApi.update(company.value!.id, { ...body(), version: company.value!.version })
      fill(company.value)
      toast.add({ severity: 'success', summary: 'Company saved', life: 3000 })
    }
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function setActive(action: 'deactivate' | 'activate') {
  const c = company.value!
  const run = async () => {
    company.value = await configCompaniesApi.setActive(c.id, action, c.version)
    fill(company.value)
    toast.add({ severity: 'success', summary: `${c.legalName} made ${action === 'activate' ? 'active' : 'inactive'}`, life: 3000 })
  }
  if (action === 'activate') return run()
  confirm.require({
    header: `Make ${c.legalName} inactive?`,
    message: 'None of its branches is active, so nobody works for it. You can make it active again.',
    acceptLabel: 'Make inactive',
    rejectLabel: 'Keep it',
    accept: run,
  })
}

const addBranch = () => router.push({ path: '/config/branches', query: { new: '1', company: company.value?.id } })
</script>

<template>
  <div v-if="loading && !company && !isNew" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New company' : `Company ${company?.code ?? ''}`" :subtitle="isNew ? 'A legal entity with its own TIN and books.' : company?.subtitle" document>
        <template v-if="company && !isNew" #chip>
          <StatusChip :status="company.isActive ? 'ACTIVE' : 'INACTIVE'" :label="company.isActive ? 'Active' : 'Inactive'" :group="company.isActive ? 'done' : 'draft'" />
        </template>
        <template #actions>
          <select
            v-if="companies.length > 1 && !isNew"
            aria-label="Company"
            class="erp-input w-auto"
            :value="company?.code"
            @change="router.replace({ query: { company: ($event.target as HTMLSelectElement).value } })"
          >
            <option v-for="c in companies" :key="c.id" :value="c.code">{{ c.code }} · {{ c.legalName }}</option>
          </select>
          <template v-if="isNew">
            <button type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="router.replace({ query: {} })">Cancel</button>
          </template>
          <template v-else-if="session.can('config.organisation.edit')">
            <button type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="router.push({ query: { new: '1' } })">Add company</button>
            <button v-if="can('deactivate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setActive('deactivate')">Make inactive</button>
            <button v-if="can('activate')" type="button" class="erp-btn erp-btn-secondary" :disabled="saving || dirty" @click="setActive('activate')">Make active</button>
          </template>
          <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">{{ isNew ? 'Create company' : 'Save changes' }}</button>
        </template>
      </PageHeader>
    </section>

    <NoticeBanner v-if="demo && !isNew" kind="warning">
      {{ demo.lead }} <strong>{{ demo.word }}</strong>. Replace them with the company's real ones before the first real e-Invoice.
    </NoticeBanner>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-4">
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Company</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField v-if="isNew" label="Code" for="code" :error="errors.code">
              <input id="code" v-model="form.code" class="erp-input uppercase" maxlength="20" placeholder="CLB" />
            </FormField>
            <div v-else class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span class="flex justify-between gap-2">
                <label for="code">Code</label>
                <span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ company?.code }}</div>
            </div>
            <FormField label="Legal name" for="legalName" :error="errors.legalName" class="col-span-2">
              <input id="legalName" v-model="form.legalName" class="erp-input" maxlength="150" :disabled="!editable" />
            </FormField>
            <FormField label="Registration no (SSM)" for="registrationNo" :error="errors.registrationNo">
              <input id="registrationNo" v-model="form.registrationNo" class="erp-input" maxlength="40" :disabled="!editable" />
            </FormField>
            <FormField label="TIN" for="tin" :error="errors.tin">
              <input id="tin" v-model="form.tin" class="erp-input uppercase" maxlength="30" :disabled="!editable" />
            </FormField>
            <FormField label="Base currency" for="currency">
              <div id="currency" class="erp-input-ro">{{ company?.currencyText ?? 'MYR · Ringgit Malaysia' }}</div>
            </FormField>
            <FormField label="Sales tax no" for="salesTaxNo" :error="errors.salesTaxNo">
              <input id="salesTaxNo" v-model="form.salesTaxNo" class="erp-input" maxlength="40" :disabled="!editable" />
            </FormField>
            <FormField label="Service tax no" for="serviceTaxNo" :error="errors.serviceTaxNo">
              <input id="serviceTaxNo" v-model="form.serviceTaxNo" class="erp-input" maxlength="40" :disabled="!editable" />
            </FormField>
            <FormField label="MyInvois taxpayer name" for="myinvoisName" :error="errors.myinvoisName">
              <input id="myinvoisName" v-model="form.myinvoisName" class="erp-input" maxlength="150" :disabled="!editable" />
            </FormField>
            <FormField label="Address" for="address" :error="errors.address" class="col-span-3">
              <textarea id="address" v-model="form.address" class="erp-input min-h-[58px] resize-y" rows="2" maxlength="500" :disabled="!editable" />
            </FormField>
            <FormField label="Phone" for="phone" :error="errors.phone">
              <input id="phone" v-model="form.phone" class="erp-input" maxlength="40" :disabled="!editable" />
            </FormField>
            <FormField label="Email" for="email" :error="errors.email">
              <input id="email" v-model="form.email" type="email" class="erp-input" maxlength="150" :disabled="!editable" />
            </FormField>
            <FormField label="Time zone" for="timeZone">
              <div id="timeZone" class="erp-input-ro">{{ company?.timeZone ?? 'Asia/Kuala_Lumpur' }}</div>
            </FormField>
          </div>
        </section>

        <section v-if="company && !isNew" class="erp-card flex flex-col gap-3 px-[18px] py-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Branches</h2>
            <button v-if="can('addBranch')" type="button" class="erp-btn erp-btn-secondary" @click="addBranch">
              <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add branch
            </button>
          </div>
          <table v-if="company.branches.length" class="erp-table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Parent</th><th>Document prefix</th><th>Users</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr v-for="b in company.branches" :key="b.id">
                <td><RouterLink :to="{ path: '/config/branches', query: { code: b.code } }" class="erp-link font-semibold">{{ b.code }}</RouterLink></td>
                <td>{{ b.name }}</td>
                <td>{{ b.parent ?? '—' }}</td>
                <td>{{ b.docPrefix ?? b.code }}</td>
                <td>{{ b.users }}</td>
                <td><StatusChip :status="b.isActive ? 'ACTIVE' : 'INACTIVE'" :label="b.isActive ? 'Active' : 'Inactive'" :group="b.isActive ? 'done' : 'draft'" /></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="m-0 text-[13px] text-erp-muted">No branches yet. Add the places this company works from.</p>
        </section>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <SideCard title="Why the company is separate">
          <p class="m-0 text-[13px] text-erp-muted">
            The company is the legal entity: its TIN, tax numbers and books. Branches are the places it works from. Finance will keep one set of books per company (SDD ADR-19).
          </p>
        </SideCard>
        <template v-if="company && !isNew">
          <ActivityList v-if="company.activity.length" :items="company.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the opening data.</p>
          </SideCard>
        </template>
      </div>
    </div>
  </template>
</template>
