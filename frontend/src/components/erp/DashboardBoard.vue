<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { BarChart3, CalendarRange, List, Plus, Table2 } from '@lucide/vue'
import { boardsApi, type Board, type IndicatorKind } from '@/api/boards'
import IndicatorCard from '@/components/erp/IndicatorCard.vue'

/**
 * A module home's dashboard (SRS RPT-035 to RPT-039): the toolbar, the module's fixed KPI cards (slot), and the
 * charts this person picked, saved on the server so they follow the person to any computer. Module-neutral.
 */
const props = defineProps<{ path: string }>()
const toast = useToast()
const confirm = useConfirm()
const boards = boardsApi(props.path)

const board = ref<Board | null>(null)
const loading = ref(true)
const failed = ref(false)
const busy = ref(false)
const adding = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  try {
    board.value = await boards.get()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const keys = computed(() => board.value?.cards.map((c) => c.key) ?? [])
const full = computed(() => Boolean(board.value && keys.value.length >= board.value.maxCards))

/** Saves a layout; the answer comes back with every card calculated. */
async function save(cols: 2 | 3, cards: string[]) {
  busy.value = true
  try {
    board.value = await boards.save(cols, cards)
  } finally {
    busy.value = false
  }
}

function setCols(n: 2 | 3) {
  if (board.value && board.value.cols !== n) void save(n, keys.value)
}

async function add(key: string, title: string) {
  if (!board.value) return
  await save(board.value.cols, [...keys.value, key])
  toast.add({ severity: 'success', summary: `${title} added`, detail: 'It is at the end of your dashboard.', life: 2500 })
}

function remove(key: string) {
  if (board.value) void save(board.value.cols, keys.value.filter((k) => k !== key))
}

function move(index: number, by: -1 | 1) {
  if (!board.value) return
  const next = [...keys.value]
  const [card] = next.splice(index, 1)
  next.splice(index + by, 0, card!)
  void save(board.value.cols, next)
}

function clearAll() {
  if (!board.value) return
  const cols = board.value.cols
  confirm.require({
    header: 'Clear your dashboard?',
    message: 'Every chart is taken off. The cards at the top stay, and you can put the default charts back at any time.',
    acceptLabel: 'Clear',
    rejectLabel: 'Keep them',
    acceptClass: 'p-button-danger',
    accept: () => void save(cols, []),
  })
}

async function reset() {
  busy.value = true
  try {
    board.value = await boards.reset()
    toast.add({ severity: 'success', summary: 'Default charts back', life: 2500 })
  } finally {
    busy.value = false
  }
}

const KIND: Record<IndicatorKind, { label: string; icon: typeof Table2 }> = {
  table: { label: 'Table', icon: Table2 },
  list: { label: 'List', icon: List },
  bars: { label: 'Bar chart', icon: BarChart3 },
  columns: { label: 'By month', icon: CalendarRange },
}
</script>

<template>
  <!-- Dashboard toolbar -->
  <div class="erp-card flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-2.5">
    <div class="flex items-center gap-2.5">
      <span class="text-sm font-bold">Dashboard</span>
      <span v-if="board" class="text-xs text-erp-muted">{{ board.isDefault ? 'Default charts' : 'Your charts · saved to your account' }}</span>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex overflow-hidden rounded-lg border border-erp-input" role="group" aria-label="Dashboard columns">
        <button
          v-for="n in [2, 3] as const"
          :key="n"
          type="button"
          class="h-8 cursor-pointer border-0 px-3 font-[inherit] text-xs font-semibold"
          :class="board?.cols === n ? 'bg-mod-chip-bg text-mod-chip-text' : 'bg-erp-card text-erp-text'"
          :aria-pressed="board?.cols === n"
          :disabled="!board || busy"
          @click="setCols(n)"
        >
          {{ n }} cols
        </button>
      </div>
      <button type="button" class="erp-btn erp-btn-add" :disabled="!board" @click="adding = true"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add chart</button>
      <button type="button" class="erp-btn erp-btn-danger" :disabled="!board || !keys.length || busy" @click="clearAll">Clear</button>
    </div>
  </div>

  <!-- The module's headline numbers, always shown -->
  <slot name="kpis" />

  <div v-if="failed" class="erp-card flex items-center justify-between px-5 py-4 text-[13px]">
    <span>The charts could not be loaded.</span>
    <button type="button" class="erp-btn erp-btn-secondary" @click="load">Try again</button>
  </div>

  <div v-else-if="loading" class="erp-card px-5 py-8 text-center text-[13px] text-erp-muted">Loading your charts…</div>

  <div v-else-if="board && !board.cards.length" class="erp-card flex flex-col items-center gap-3 px-5 py-10 text-center">
    <p class="m-0 text-sm font-semibold">No charts on your dashboard</p>
    <p class="m-0 max-w-md text-[13px] text-erp-muted">Add the charts you want to see here. They are saved to your account, so they follow you to any computer.</p>
    <div class="flex gap-2">
      <button type="button" class="erp-btn erp-btn-add" @click="adding = true"><Plus :size="14" :stroke-width="2.5" aria-hidden="true" />Add chart</button>
      <button type="button" class="erp-btn erp-btn-secondary" :disabled="busy" @click="reset">Put back the default charts</button>
    </div>
  </div>

  <div
    v-else-if="board"
    class="grid min-h-0 grow grid-flow-row-dense gap-4 max-lg:!grid-cols-1"
    :class="[board.cols === 2 ? 'grid-cols-[1.5fr_1fr]' : 'grid-cols-3', { 'opacity-60': busy }]"
    :aria-busy="busy"
  >
    <IndicatorCard
      v-for="(c, i) in board.cards"
      :key="c.key"
      :card="c"
      :cols="board.cols"
      :first="i === 0"
      :last="i === board.cards.length - 1"
      :editable="!busy"
      @remove="remove(c.key)"
      @move="move(i, $event)"
    />
  </div>

  <!-- Add chart -->
  <Dialog v-model:visible="adding" modal :draggable="false" class="erp-dialog" :style="{ width: '600px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">Add a chart</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">
          It goes at the end of your dashboard. Every chart shows only what you are allowed to see.
          <template v-if="board"> {{ keys.length }} of {{ board.maxCards }} used.</template>
        </p>
      </div>
    </template>
    <ul v-if="board" class="m-0 flex list-none flex-col gap-2 p-0">
      <li v-for="c in board.catalogue" :key="c.key" class="flex items-center gap-3 rounded-lg border border-erp-border px-3 py-2.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mod-light text-mod-primary" :title="KIND[c.kind].label">
          <component :is="KIND[c.kind].icon" :size="17" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="text-[13px] font-semibold">{{ c.title }}</span>
          <span class="text-xs text-erp-muted">{{ c.description }}</span>
        </span>
        <span v-if="c.onBoard" class="shrink-0 text-xs font-semibold text-erp-muted">On your dashboard</span>
        <button
          v-else
          type="button"
          class="erp-btn erp-btn-secondary shrink-0"
          :disabled="busy || full"
          :title="full ? `A dashboard holds at most ${board.maxCards} charts. Remove one first.` : undefined"
          @click="add(c.key, c.title)"
        >
          Add
        </button>
      </li>
    </ul>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <button v-if="board && !board.isDefault" type="button" class="erp-link cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold" :disabled="busy" @click="reset">Put back the default charts</button>
        <span v-else />
        <button type="button" class="erp-btn erp-btn-primary" @click="adding = false">Done</button>
      </div>
    </template>
  </Dialog>
</template>
