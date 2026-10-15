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
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { usePageCrumb } from '@/composables/usePageCrumb'
import { configPermissionsApi, configRolesApi } from '../api/config'
import type { CatalogueModule, RoleDetail, RoleInput } from '../types'

/** A09 · New role / role with its data scope and permissions (CfgRoleForm.html) */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const setCrumb = usePageCrumb()

const id = computed(() => String(route.params.id))
const isNew = computed(() => id.value === 'new')

const role = ref<RoleDetail | null>(null)
const catalogue = ref<CatalogueModule[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

const form = reactive({ code: '', name: '', description: '', agentScopeCustomers: false, agentScopeDocuments: false, permissions: [] as string[] })
const saved = ref('')
const snapshot = () => JSON.stringify({ ...form, permissions: [...form.permissions].sort() })
const dirty = computed(() => snapshot() !== saved.value)
const can = (a: 'edit' | 'reset' | 'delete') => Boolean(role.value?.allowedActions.includes(a))
const isAdmin = computed(() => Boolean(role.value?.isAdministrator))
const editable = computed(() => (isNew.value ? true : can('edit')))

/** Modules opened by hand; a module with any permission is always open. */
const opened = ref(new Set<string>())
const held = computed(() => new Set(form.permissions))
const countIn = (m: CatalogueModule) => m.objects.flatMap((o) => o.actions).filter((a) => held.value.has(a.key)).length
const sizeOf = (m: CatalogueModule) => m.objects.flatMap((o) => o.actions).length
const openModules = computed(() => catalogue.value.filter((m) => isAdmin.value || countIn(m) > 0 || opened.value.has(m.module)))
const closedModules = computed(() => catalogue.value.filter((m) => !openModules.value.includes(m)))

function fill(r: RoleDetail | null) {
  Object.assign(form, {
    code: r?.code ?? '',
    name: r?.name ?? '',
    description: r?.description ?? '',
    agentScopeCustomers: r?.agentScopeCustomers ?? false,
    agentScopeDocuments: r?.agentScopeDocuments ?? false,
    permissions: [...(r?.permissions ?? [])],
  })
  opened.value = new Set()
  saved.value = snapshot()
  errors.value = {}
}

async function load() {
  loading.value = true
  try {
    catalogue.value = (await configPermissionsApi.catalogue()).modules
    role.value = isNew.value ? null : await configRolesApi.get(id.value)
    fill(role.value)
    setCrumb(role.value?.name ?? 'New role')
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggle(key: string, on: boolean) {
  form.permissions = on ? [...form.permissions, key] : form.permissions.filter((k) => k !== key)
}
function open(module: string) {
  opened.value = new Set([...opened.value, module])
}

const body = (): RoleInput => ({
  name: form.name.trim(),
  description: form.description.trim() || null,
  agentScopeCustomers: form.agentScopeCustomers,
  agentScopeDocuments: form.agentScopeDocuments,
  permissions: form.permissions,
})

function show(r: RoleDetail) {
  role.value = r
  fill(r)
  setCrumb(r.name)
}

async function save() {
  saving.value = true
  errors.value = {}
  try {
    if (isNew.value) {
      const created = await configRolesApi.create({ ...body(), code: form.code.trim().toUpperCase() })
      toast.add({ severity: 'success', summary: `Role ${created.name} created`, life: 3000 })
      await router.replace(`/config/roles/${created.id}`)
      show(created)
    } else {
      show(await configRolesApi.update(id.value, { ...body(), version: role.value!.version }))
      toast.add({ severity: 'success', summary: 'Role saved. It applies from the next click of everyone who holds it.', life: 4000 })
    }
  } catch (error) {
    if (error instanceof ApiError) errors.value = error.fieldErrors
  } finally {
    saving.value = false
  }
}

function reset() {
  const r = role.value!
  confirm.require({
    header: `Reset ${r.name} to starter?`,
    message: 'Its permissions and data scope go back to what Purchase, Sales and Core gave it at the start. The change is logged.',
    acceptLabel: 'Reset',
    rejectLabel: 'Keep it',
    accept: async () => {
      show(await configRolesApi.resetToStarter(r.id, r.version))
      toast.add({ severity: 'success', summary: `${r.name} reset to starter`, life: 3000 })
    },
  })
}

function remove() {
  const r = role.value!
  confirm.require({
    header: `Delete ${r.name}?`,
    message: `Nobody holds this role, so it can go. The code ${r.code} is not used again.`,
    acceptLabel: 'Delete',
    rejectLabel: 'Keep it',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await configRolesApi.remove(r.id, r.version)
      toast.add({ severity: 'success', summary: `${r.name} deleted`, life: 3000 })
      void router.push('/config/roles')
    },
  })
}

const closedText = computed(() => {
  const names = closedModules.value.map((m) => m.label)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')
})
</script>

<template>
  <div v-if="loading && !catalogue.length" class="erp-card px-6 py-10 text-center text-[13px] text-erp-muted">Loading…</div>

  <template v-else>
    <section class="erp-card px-6 py-[18px]">
      <PageHeader :title="isNew ? 'New role' : `Role ${role?.name ?? ''}`" :subtitle="isNew ? 'A set of permissions and a data scope.' : role?.subtitle" document>
        <template v-if="role" #chip>
          <span class="rounded-xl bg-chip-draft-bg px-2.5 py-[3px] text-xs font-semibold text-chip-draft-text">{{ role.isStarter ? 'Starter' : 'Custom' }}</span>
        </template>
        <template #actions>
          <button v-if="can('delete')" type="button" class="erp-btn erp-btn-danger" :disabled="saving || dirty" @click="remove">Delete</button>
          <RouterLink v-if="isNew" to="/config/roles" class="erp-btn erp-btn-secondary">Cancel</RouterLink>
          <button v-if="editable" type="button" class="erp-btn erp-btn-primary" :disabled="saving || !dirty" @click="save">{{ isNew ? 'Create role' : 'Save changes' }}</button>
        </template>
      </PageHeader>
    </section>

    <div class="grid grow items-start gap-4 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- Role -->
        <section class="erp-card flex flex-col gap-3.5 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">Role</h2>
          <div class="grid grid-cols-3 gap-x-[18px] gap-y-3.5">
            <FormField v-if="isNew" label="Code" for="code" :error="errors.code">
              <input id="code" v-model="form.code" class="erp-input uppercase" maxlength="30" placeholder="QA_LEAD" />
            </FormField>
            <div v-else class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-erp-muted">
              <span class="flex justify-between gap-2">
                <label for="code">Code</label>
                <span class="inline-flex items-center gap-1.5"><Lock :size="12" aria-hidden="true" />Never changes</span>
              </span>
              <div id="code" class="erp-input-ro">{{ role?.code }}</div>
            </div>
            <FormField label="Name" for="name" :error="errors.name" class="col-span-2">
              <input id="name" v-model="form.name" class="erp-input" maxlength="100" :disabled="!editable" />
            </FormField>
            <FormField label="What it is for" for="description" :error="errors.description" class="col-span-3">
              <input id="description" v-model="form.description" class="erp-input" maxlength="300" :disabled="!editable" />
            </FormField>
          </div>
        </section>

        <!-- Data scope -->
        <section class="erp-card flex flex-col gap-3 px-[18px] py-4">
          <h2 class="m-0 text-[15px] font-bold">What they can see</h2>
          <label class="flex items-center gap-2.5 text-[13px] font-medium">
            <SwitchToggle v-model="form.agentScopeCustomers" label="Customers: only those they are agent for" :disabled="!editable" />
            Customers: only those they are agent for
          </label>
          <label class="flex items-center gap-2.5 text-[13px] font-medium">
            <SwitchToggle v-model="form.agentScopeDocuments" label="Sales documents: only for those customers" :disabled="!editable" />
            Sales documents: only for those customers
          </label>
          <span class="text-xs text-erp-muted">
            On top of the branch scope every user has. A user holding this role is limited this way even if another of their roles is not. Data scopes are applied from step A7.
          </span>
        </section>

        <!-- Permissions -->
        <section class="erp-card flex flex-col gap-3 px-[18px] py-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[15px] font-bold">Permissions · {{ isAdmin ? 'all' : form.permissions.length }}</h2>
            <button
              v-if="can('reset')"
              type="button"
              class="erp-btn erp-btn-secondary"
              :disabled="saving || dirty || role?.asStarter === true"
              :title="role?.asStarter ? 'It already has its starter permissions and scope.' : dirty ? 'Save or undo your changes first.' : undefined"
              @click="reset"
            >
              Reset to starter
            </button>
          </div>
          <NoticeBanner v-if="isAdmin" kind="info">Administrator holds every permission and cannot be changed.</NoticeBanner>
          <span v-if="errors.permissions" class="text-xs font-medium text-note-error-text" role="alert">{{ errors.permissions }}</span>

          <div v-for="m in openModules" :key="m.module" class="flex flex-col">
            <div class="flex items-baseline justify-between border-b border-erp-row pt-1.5 pb-2">
              <h3 class="m-0 text-[13px] font-bold">{{ m.label }}</h3>
              <span class="text-xs text-erp-muted">{{ isAdmin ? sizeOf(m) : countIn(m) }} of {{ sizeOf(m) }}</span>
            </div>
            <div v-for="o in m.objects" :key="o.object" class="grid grid-cols-[200px_minmax(0,1fr)] items-center border-b border-erp-row py-2 text-[13px]">
              <span>{{ o.object }}</span>
              <div class="flex flex-wrap gap-x-5 gap-y-1.5">
                <label v-for="a in o.actions" :key="a.key" class="flex items-center gap-2" :title="a.key">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-mod-primary"
                    :checked="isAdmin || held.has(a.key)"
                    :disabled="!editable || isAdmin"
                    @change="toggle(a.key, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ a.action }}
                </label>
              </div>
            </div>
          </div>
          <p v-if="closedModules.length" class="m-0 text-xs text-erp-muted">
            {{ closedText }}: nothing.
            <template v-if="editable">
              Open
              <template v-for="(m, i) in closedModules" :key="m.module">
                <button type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold" @click="open(m.module)">{{ m.label }}</button><template v-if="i < closedModules.length - 1"> or </template>
              </template>
              to give permissions there.
            </template>
          </p>
        </section>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <SideCard v-if="role" :title="`Held by ${role.users.length} user${role.users.length === 1 ? '' : 's'}`">
          <p v-if="!role.users.length" class="m-0 text-[13px] text-erp-muted">Nobody holds this role yet. Give it to someone on their user page.</p>
          <ul v-else class="m-0 list-none p-0">
            <li v-for="u in role.users" :key="u.id" class="flex items-center justify-between gap-3 border-b border-erp-row py-2 text-[13px] last:border-b-0">
              <RouterLink :to="`/config/users/${u.id}`" class="erp-link">{{ u.code }} · {{ u.name }}</RouterLink>
              <span class="text-xs text-erp-muted">{{ u.branches }}</span>
            </li>
          </ul>
        </SideCard>
        <SideCard v-if="role" title="Two-factor">
          <p class="m-0 text-[13px] text-erp-muted">{{ role.twoFactor.text }}</p>
        </SideCard>
        <template v-if="role">
          <ActivityList v-if="role.activity.length" :items="role.activity" />
          <SideCard v-else title="Activity">
            <p class="m-0 text-[13px] text-erp-muted">No changes yet. Loaded with the starter roles.</p>
          </SideCard>
        </template>
        <SideCard v-else title="A new role">
          <p class="m-0 text-[13px] text-erp-muted">It starts with no permissions. Tick what it may do, then give it to users on their user page. Every change is logged.</p>
        </SideCard>
      </div>
    </div>
  </template>
</template>
