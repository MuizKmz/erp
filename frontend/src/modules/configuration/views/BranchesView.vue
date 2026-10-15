<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { Building2, Lock, Plus } from '@lucide/vue'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import SideCard from '@/components/erp/SideCard.vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { useSession } from '@/composables/useSession'
import { configBranchesApi } from '../api/config'
import type { BranchDetail, BranchInput, BranchTree, BranchTreeRow } from '../types'

/** A05 · Branches: the tree and the branch form (CfgBranches.html). ?code=PNG picks a branch; ?new=1&company=ID adds one. */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const session = useSession()

const tree = ref<BranchTree | null>(null)
const branch = ref<BranchDetail | null>(null)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

const isNew = computed(() => route.query.new === '1')
const allBranches = computed<BranchTreeRow[]>(() => tree.value?.companies.flatMap((c) => c.branches) ?? [])
const editable = computed(() => Boolean(tree.value?.canEdit))

const form = reactive({ code: '', name: '', legalEntityId: '', parentId: '', docPrefix: '', address: '', phone: '', email: '', myinvoisBranchName: '', isActive: true })
const saved = ref('')
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => snapshot() !== saved.value)

function fill(b: BranchDetail | null) {
  const t = (v: string | null | undefined) => v ?? ''
  const company = typeof route.query.company === 'string' ? route.query.company : (tree.value?.companies.find((c) => c.isActive)?.id ?? '')
  Object.assign(form, {
    code: b?.code ?? '',
    name: t(b?.name),
    legalEntityId: b?.legalEntityId ?? company,
    parentId: t(b?.parentId),
    docPrefix: t(b?.docPrefix),
    address: t(b?.address),
    phone: t(b?.phone),
    email: t(b?.email),
    myinvoisBranchName: t(b?.myinvoisBranchName),
    isActive: b?.isActive ?? true,
  })
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  tree.value = await configBranchesApi.list()
  const picked = allBranches.value.find((b) => b.code === route.query.code) ?? allBranches.value[0]
  branch.value = isNew.value || !picked ? null : await configBranchesApi.get(picked.id)
  fill(branch.value)
}
onMounted(load)
watch(() => `${String(route.query.code ?? "")}|${String(route.query.new ?? "")}`, load)

const select = (b: BranchTreeRow) => router.replace({ query: { code: b.code } })
const selectedId = computed(() => (isNew.value ? null : branch.value?.id))

/** Branches of the picked company it may sit under: not itself, not one of its own (rule 6; the server checks too). */
const parentChoices = computed(() => {
  const below = new Set<string>()
  const walk = (id: string) => {
    for (const b of allBranches.value.filter((x) => x.parentId === id)) {
      below.add(b.id)
      walk(b.id)
    }
  }
  if (selectedId.value) walk(selectedId.value)
  return allBranches.value.filter((b) => b.legalEntityId === form.legalEntityId && b.id !== selectedId.value && !below.has(b.id))
})
watch(
  () => form.legalEntityId,
  () => {
    if (form.parentId && !parentChoices.value.some((b) => b.id === form.parentId)) form.parentId = ''
  },
)

/** Turning the switch off when a user works only here or an open document needs the branch: say why before saving. */
const switchNote = computed(() => (branch.value?.isActive && !form.isActive ? branch.value.refusals.deactivate : !branch.value?.isActive && form.isActive ? (branch.value?.refusals.activate ?? null) : null))

const blankToNull = (v: string) => v.trim() || null
const body = (): BranchInput => ({
  name: form.name.trim(),
  legalEntityId: form.legalEntityId,
  parentId: form.parentId || null,
  docPrefix: blankToNull(form.docPrefix)?.toUpperCase() ?? null,
  address: blankToNull(form.address),
  phone: blankToNull(form.phone),
  email: blankToNull(form.email),
  myinvoisBranchName: blankToNull(form.myinvoisBranchName),
})

async function save() {
  saving.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      const created = await configBranchesApi.create({ ...body(), code: form.code.trim().toUpperCase() })
      toast.add({ severity: 'success', summary: `Branch ${created.code} added`, life: 3000 })
      await router.replace({ query: { code: created.code } })
    } else {
      branch.value = await configBranchesApi.update(branch.value!.id, { ...body(), isActive: form.isActive, version: branch.value!.version })
      tree.value = await configBranchesApi.list()
      fill(branch.value)
      toast.add({ severity: 'success', summary: `Branch ${branch.value.code} saved`, life: 3000 })
    }
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

const addBranch = () => router.replace({ query: { new: '1', company: form.legalEntityId || undefined } })
const tenantName = computed(() => session.state.tenantName || 'CLB Groups')
</script>

<template>
  <section class="erp-card px-6 py-[18px]">
    <PageHeader title="Branches" :subtitle="`The places ${tenantName} works from. Users work in one or more branches and pick one as active.`">
      <template #actions>
        <button v-if="isNew" type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="router.replace({ query: {} })">Cancel</button>
        <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">{{ isNew ? 'Add branch' : 'Save changes' }}</button>
      </template>
    </PageHeader>
  </section>

  <div v-if="!tree" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <div v-else class="grid grow items-start gap-4 grid-cols-[320px_minmax(0,1fr)]">
    <!-- Tree -->
    <section class="erp-card flex flex-col gap-3 px-[18px] py-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="m-0 text-[15px] font-bold">Branches</h2>
        <button v-if="editable" type="button" class="erp-btn erp-btn-secondary" :disabled="saving" @click="addBranch">
          <Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add branch
        </button>
      </div>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <template v-for="c in tree.companies" :key="c.id">
          <li class="flex items-center gap-2 px-2.5 py-2 text-[13px]">
            <Building2 :size="14" class="shrink-0 text-erp-muted" aria-hidden="true" />
            <span :class="{ 'text-erp-muted line-through': !c.isActive }">{{ c.legalName }}</span>
            <span class="text-xs text-erp-muted">company</span>
          </li>
          <li v-for="b in c.branches" :key="b.id">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 py-2 pr-2.5 text-left text-[13px]"
              :class="selectedId === b.id ? 'bg-mod-light font-semibold' : 'bg-transparent'"
              :style="{ paddingLeft: `${28 + b.depth * 18}px` }"
              @click="select(b)"
            >
              <Building2 :size="14" class="shrink-0 text-erp-muted" aria-hidden="true" />
              <span :class="{ 'text-erp-muted': !b.isActive }">{{ b.code }} · {{ b.name }}</span>
              <span class="text-xs font-normal text-erp-muted">{{ b.isActive ? `${b.users} users` : 'inactive' }}</span>
            </button>
          </li>
        </template>
      </ul>
      <p class="m-0 text-xs text-erp-muted">A branch can sit under another; reports for a parent include its children.</p>
    </section>

    <div class="flex min-w-0 flex-col gap-4">
      <NoticeBanner v-if="branch?.demoNotice && !isNew" kind="warning">{{ branch.demoNotice }} Replace them with the branch's real ones.</NoticeBanner>

      <!-- Branch form -->
      <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
        <h2 class="m-0 text-[15px] font-bold">{{ isNew ? 'New branch' : branch?.name }}</h2>
        <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
          <FormField v-if="isNew" label="Code" for="code" :error="errors.code">
            <input id="code" v-model="form.code" class="erp-input uppercase" maxlength="10" placeholder="KL" />
          </FormField>
          <div v-else class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
            <span class="flex justify-between gap-2">
              <label for="code">Code</label>
              <span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
            </span>
            <div id="code" class="erp-input-ro">{{ branch?.code }}</div>
          </div>
          <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
            <input id="name" v-model="form.name" class="erp-input" maxlength="100" :disabled="!editable" />
          </FormField>
          <FormField label="Company" for="company" :error="errors.legalEntityId">
            <select id="company" v-model="form.legalEntityId" class="erp-input" :disabled="!editable">
              <option value="" disabled>Pick the company</option>
              <option v-for="c in tree.companies" :key="c.id" :value="c.id" :disabled="!c.isActive && c.id !== branch?.legalEntityId">{{ c.code }} · {{ c.legalName }}</option>
            </select>
          </FormField>
          <FormField label="Under branch" for="parent" :error="errors.parentId">
            <select id="parent" v-model="form.parentId" class="erp-input" :disabled="!editable">
              <option value="">— (top level)</option>
              <option v-for="b in parentChoices" :key="b.id" :value="b.id">{{ b.code }} · {{ b.name }}</option>
            </select>
          </FormField>
          <FormField label="Document prefix" for="docPrefix" :error="errors.docPrefix">
            <input id="docPrefix" v-model="form.docPrefix" class="erp-input uppercase" maxlength="10" :placeholder="form.code || 'Same as the code'" :disabled="!editable" />
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
          <FormField label="MyInvois branch name" for="myinvois" :error="errors.myinvoisBranchName">
            <input id="myinvois" v-model="form.myinvoisBranchName" class="erp-input" maxlength="150" :disabled="!editable" />
          </FormField>
        </div>
        <div v-if="!isNew" class="flex flex-col gap-1.5">
          <label class="flex items-center gap-2.5 text-[13px] font-medium">
            <SwitchToggle v-model="form.isActive" label="Active" :disabled="!editable" />
            Active
          </label>
          <span v-if="switchNote" class="text-xs font-medium text-note-warn-strong" role="alert">{{ switchNote }}</span>
        </div>
      </section>

      <SideCard v-if="branch && !isNew" title="In use">
        <p class="m-0 text-[13px] text-erp-muted">{{ branch.inUse.text }}</p>
      </SideCard>
    </div>
  </div>
</template>
