<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus } from '@lucide/vue'
import PageHeader from '@/components/erp/PageHeader.vue'
import { configRolesApi } from '../api/config'
import type { RoleListItem } from '../types'

/** A08 · Roles (CfgRoleList.html) */
const roles = ref<RoleListItem[] | null>(null)
const canEdit = ref(false)
onMounted(async () => {
  const result = await configRolesApi.list()
  roles.value = result.items
  canEdit.value = result.canEdit
})
</script>

<template>
  <section class="erp-card flex grow flex-col gap-3 px-6 py-[18px]">
    <PageHeader title="Roles" subtitle="A role is a set of permissions and a data scope. Users can hold several; they get the sum.">
      <template v-if="canEdit" #actions>
        <RouterLink to="/config/roles/new" class="erp-btn erp-btn-add"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add new role</RouterLink>
      </template>
    </PageHeader>

    <div v-if="!roles" class="py-10 text-center text-[13px] text-erp-muted">Loading…</div>
    <table v-else class="erp-table">
      <thead>
        <tr>
          <th>Role</th>
          <th class="num">Users</th>
          <th class="num">Permissions</th>
          <th>Sees</th>
          <th>Two-factor</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in roles" :key="r.id">
          <td>
            <RouterLink :to="`/config/roles/${r.id}`" class="erp-link font-semibold">{{ r.name }}</RouterLink>
            <div class="font-mono text-[11px] text-erp-muted">{{ r.code }}</div>
          </td>
          <td class="num"><span v-if="r.users">{{ r.users }}</span><span v-else class="text-note-warn-strong">None</span></td>
          <td class="num">{{ r.permissionsText }}</td>
          <td>{{ r.sees }}</td>
          <td><span v-if="r.twoFactor">Required</span><span v-else class="text-erp-muted">—</span></td>
          <td>
            <span class="rounded-xl bg-chip-draft-bg px-2.5 py-[3px] text-xs font-semibold text-chip-draft-text">{{ r.isStarter ? 'Starter' : 'Custom' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="m-0 text-xs text-erp-muted">
      Starter roles come from how Purchase, Sales and Core work today. They can be changed; <strong class="text-erp-text">Reset to starter</strong> brings one back. Administrator always
      holds every permission.
    </p>
  </section>
</template>
