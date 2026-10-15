<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import KpiCard from '@/components/erp/KpiCard.vue'
import NoticeBanner from '@/components/erp/NoticeBanner.vue'
import { useSession } from '@/composables/useSession'
import { formatDateTime } from '@/utils/format'
import { configApi } from '../api/config'
import { CONFIG_MENU } from '../menu'
import type { ConfigDashboard } from '../types'

/** A01 · Configuration home: who works here, how they sign in, what needs attention and the latest security events. */
const TILE_SHADES = ['bg-mod-tile-1', 'bg-mod-tile-2', 'bg-mod-tile-3', 'bg-mod-tile-4']
const TILE_TEXT = ['text-mod-tile-1', 'text-mod-tile-2', 'text-mod-tile-3', 'text-mod-tile-4']

const data = ref<ConfigDashboard | null>(null)
const loading = ref(true)
// Everyone may open My account; the rest of Configuration needs config.view (choice 20).
const allowed = useSession().can('config.view')

onMounted(async () => {
  if (!allowed) {
    loading.value = false
    return
  }
  try {
    data.value = await configApi.dashboard()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- Group tiles -->
  <div class="flex gap-4">
    <RouterLink
      v-for="(g, i) in CONFIG_MENU"
      :key="g.key"
      :to="g.to"
      class="flex h-[100px] w-[132px] flex-col items-center justify-center gap-2 rounded-xl p-2 text-center text-xs font-semibold text-erp-on-dark"
      :class="TILE_SHADES[i]"
    >
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-erp-on-dark">
        <component :is="g.icon" :size="18" :class="TILE_TEXT[i]" aria-hidden="true" />
      </span>
      {{ g.title }}
    </RouterLink>
  </div>

  <NoticeBanner v-if="!allowed" kind="info">
    You can open <RouterLink to="/account" class="erp-link font-semibold">My account</RouterLink>. The rest of Configuration needs the permission to view it, which the
    Administrator and the Auditor hold.
  </NoticeBanner>

  <template v-else>
  <section class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-4">
      <h2 class="m-0 text-[15px] font-bold">Who works here and what they may do</h2>
      <span class="text-xs text-erp-muted">Every change here is logged with who made it and the old and new value.</span>
    </div>
    <div class="grid grid-cols-4 gap-4">
      <template v-if="loading && !data">
        <KpiCard v-for="n in 8" :key="n" label="" value="" loading />
      </template>
      <KpiCard v-for="c in data?.cards ?? []" :key="c.key" :label="c.label" :value="c.value" :sub="c.sub" :to="c.to" />
    </div>
  </section>

  <div class="grid grid-cols-2 items-start gap-4">
    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between gap-4">
        <h2 class="m-0 text-[15px] font-bold">Needs attention</h2>
        <span class="text-xs text-erp-muted">Checked when the page opens</span>
      </div>
      <p v-if="data && !data.attention.length" class="m-0 text-[13px] text-erp-muted">Nothing needs attention.</p>
      <ul v-else-if="data" class="m-0 list-none p-0">
        <li v-for="a in data.attention" :key="a.key" class="flex gap-2.5 border-b border-erp-row py-2.5 text-[13px] last:border-b-0">
          <TriangleAlert :size="15" class="mt-0.5 shrink-0 text-note-warn-strong" aria-hidden="true" />
          <span><RouterLink :to="a.to" class="erp-link font-semibold">{{ a.lead }}</RouterLink> {{ a.text }}</span>
        </li>
      </ul>
    </section>

    <section class="erp-card flex flex-col gap-3 px-5 py-[18px]">
      <div class="flex items-center justify-between gap-4">
        <h2 class="m-0 text-[15px] font-bold">Recent security events</h2>
        <RouterLink to="/config/security-log" class="erp-link text-xs font-semibold">Security log</RouterLink>
      </div>
      <p v-if="data && !data.security.length" class="m-0 text-[13px] text-erp-muted">
        No sign-ins yet: the demo runs with the user switcher. Once sign-in is on, every sign-in, failure, lockout and permission change shows up here.
      </p>
      <table v-else-if="data" class="erp-table">
        <thead>
          <tr><th>When</th><th>Who</th><th>What happened</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in data.security" :key="e.id">
            <td class="whitespace-nowrap">{{ formatDateTime(e.at) }}</td>
            <td class="whitespace-nowrap">{{ e.userName ?? '—' }}</td>
            <td>{{ e.message }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
  </template>
</template>
