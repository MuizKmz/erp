<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, X } from '@lucide/vue'
import type { BoardCard, IndicatorUnit } from '@/api/boards'
import MoneyText from '@/components/erp/MoneyText.vue'
import StatusChip from '@/components/erp/StatusChip.vue'
import { formatMoney, formatMonthName, formatQty } from '@/utils/format'

/**
 * One chart on a module home (RPT-035): a table, a list, horizontal bars or monthly columns, drawn with plain HTML so
 * no chart library is needed. Module-neutral: the module's colours come from the theme tokens.
 */
const props = defineProps<{ card: BoardCard; cols: 2 | 3; first: boolean; last: boolean; editable: boolean }>()
const emit = defineEmits<{ remove: []; move: [by: -1 | 1] }>()

const title = computed(() => (props.card.month ? `${props.card.title} · ${formatMonthName(props.card.month)}` : props.card.title))
/** How the bar and column values read. */
const unit = computed<IndicatorUnit>(() => (props.card.data && 'unit' in props.card.data ? props.card.data.unit : 'count'))

/** Values as people read them: "RM 25,872", "7", "230". */
function show(value: string, unit: IndicatorUnit, short = false): string {
  if (unit === 'money') return `RM ${formatMoney(value, short ? 0 : 2)}`
  if (unit === 'qty') return formatQty(value)
  return value
}

const isEmpty = computed(() => {
  const d = props.card.data
  if (!d) return false
  if (d.kind === 'table') return d.rows.length === 0
  if (d.kind === 'list') return d.items.length === 0
  if (d.kind === 'bars') return d.rows.length === 0
  return d.points.every((p) => Number(p.value) === 0)
})

// Bar lengths and column heights are display only; the numbers shown come from the server as they are.
const barRows = computed(() => {
  const d = props.card.data
  if (d?.kind !== 'bars') return []
  const max = Math.max(...d.rows.map((r) => Number(r.value)), 0)
  return d.rows.map((r) => ({ ...r, width: max > 0 ? (Number(r.value) / max) * 100 : 0 }))
})
const columns = computed(() => {
  const d = props.card.data
  if (d?.kind !== 'columns') return []
  const max = Math.max(...d.points.map((p) => Number(p.value)), 0)
  return d.points.map((p) => ({ ...p, height: max > 0 ? (Number(p.value) / max) * 100 : 0, label: formatMonthName(p.month).slice(0, 3) }))
})

const TONE: Record<string, string> = { primary: 'bg-mod-primary', muted: 'bg-mod-side', warning: 'bg-attention', danger: 'bg-note-error-text' }
</script>

<template>
  <!-- A table takes two cards' height, and in 3 columns two columns' width, so its columns stay readable. -->
  <section
    class="group/card erp-card relative flex min-w-0 flex-col gap-3 px-5 py-[18px]"
    :class="card.wide ? (cols === 3 ? 'col-span-2 row-span-2 max-lg:col-span-1' : 'row-span-2') : ''"
    :aria-label="title"
  >
    <div class="flex items-start justify-between gap-3">
      <h2 class="m-0 text-[15px] font-bold">{{ title }}</h2>
      <RouterLink v-if="card.link" :to="card.link.to" class="erp-link shrink-0 text-[13px] font-semibold whitespace-nowrap">{{ card.link.label }}</RouterLink>
    </div>

    <!-- Move and remove: a small bar on the card's top edge, shown on hover, keyboard focus or a touch screen, so the
         header keeps its layout. -->
    <div
      v-if="editable"
      class="absolute -top-3 right-4 flex items-center gap-0.5 rounded-full border border-erp-border bg-erp-card px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100"
    >
      <button
        type="button"
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-erp-muted hover:bg-erp-head hover:text-erp-text disabled:hidden"
        :disabled="first"
        :aria-label="`Move ${card.title} earlier`"
        @click="emit('move', -1)"
      >
        <ChevronLeft :size="14" />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-erp-muted hover:bg-erp-head hover:text-erp-text disabled:hidden"
        :disabled="last"
        :aria-label="`Move ${card.title} later`"
        @click="emit('move', 1)"
      >
        <ChevronRight :size="14" />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-erp-muted hover:bg-erp-head hover:text-note-error-text"
        :aria-label="`Remove ${card.title}`"
        @click="emit('remove')"
      >
        <X :size="14" />
      </button>
    </div>

    <p v-if="card.failed" class="m-0 text-[13px] text-note-error-text">{{ card.failed }}</p>
    <p v-else-if="!card.data || isEmpty" class="m-0 text-[13px] text-erp-muted">{{ card.empty }}</p>

    <!-- Table -->
    <div v-else-if="card.data.kind === 'table'" class="overflow-x-auto">
      <table class="erp-table">
        <thead>
          <tr>
            <th v-for="c in card.data.columns" :key="c.key" :class="{ num: c.num }">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in card.data.rows" :key="r.id">
            <td v-for="c in card.data.columns" :key="c.key" :class="{ num: c.num }">
              <template v-if="r.cells[c.key]">
                <RouterLink v-if="r.cells[c.key]!.to" :to="r.cells[c.key]!.to!" class="erp-link whitespace-nowrap" :class="{ 'font-semibold': r.cells[c.key]!.strong }">{{ r.cells[c.key]!.text }}</RouterLink>
                <MoneyText v-else-if="r.cells[c.key]!.money !== undefined" :value="r.cells[c.key]!.money!" />
                <span v-else-if="r.cells[c.key]!.progress" class="erp-num">{{ formatQty(r.cells[c.key]!.progress!.done) }} / {{ formatQty(r.cells[c.key]!.progress!.of) }}</span>
                <StatusChip v-else-if="r.cells[c.key]!.chip" :status="r.cells[c.key]!.chip!.status" :label="r.cells[c.key]!.chip!.label" :group="r.cells[c.key]!.chip!.group" />
                <span v-else :class="{ 'font-semibold whitespace-nowrap': r.cells[c.key]!.strong }">{{ r.cells[c.key]!.text }}</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- List -->
    <div v-else-if="card.data.kind === 'list'" class="flex flex-col gap-2">
      <component
        :is="i.to ? 'RouterLink' : 'div'"
        v-for="i in card.data.items"
        :key="i.id"
        :to="i.to"
        class="flex items-center justify-between gap-3 rounded-lg bg-erp-head px-3 py-2.5 text-[13px] text-erp-text"
      >
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="font-semibold">{{ i.title }}</span>
          <span v-if="i.sub" class="text-xs text-erp-muted">{{ i.sub }}</span>
        </span>
        <span v-if="i.aside" class="shrink-0 font-semibold whitespace-nowrap text-attention">{{ i.aside }}</span>
        <StatusChip v-if="i.chip" :status="i.chip.status" :label="i.chip.label" :group="i.chip.group" />
      </component>
    </div>

    <!-- Horizontal bars -->
    <div v-else-if="card.data.kind === 'bars'" class="flex flex-col gap-2.5 text-xs">
      <component
        :is="r.to ? 'RouterLink' : 'div'"
        v-for="r in barRows"
        :key="r.key"
        :to="r.to"
        class="flex items-center gap-2.5 text-erp-text"
        :class="{ 'rounded-md hover:bg-erp-head': r.to }"
      >
        <span class="flex w-[140px] shrink-0 flex-col">
          <span class="truncate" :title="r.label">{{ r.label }}</span>
          <span v-if="r.sub" class="truncate text-[11px] text-erp-muted">{{ r.sub }}</span>
        </span>
        <div class="h-2.5 grow rounded-[5px] bg-erp-track">
          <div class="h-2.5 rounded-[5px]" :class="TONE[r.tone ?? 'primary']" :style="{ width: `${r.width}%` }" />
        </div>
        <span class="w-[84px] shrink-0 text-right erp-num">{{ show(r.value, unit, true) }}</span>
      </component>
    </div>

    <!-- Monthly columns -->
    <div
      v-else-if="card.data.kind === 'columns'"
      class="flex gap-3 pt-6"
      role="img"
      :aria-label="`${title}: ${columns.map((c) => `${c.label} ${show(c.value, unit)}`).join(', ')}`"
    >
      <div v-for="c in columns" :key="c.month" class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <div class="relative h-[140px] w-full border-b border-erp-border">
          <div
            class="absolute bottom-0 left-1/2 w-full max-w-[44px] -translate-x-1/2 rounded-t-md bg-mod-primary"
            :style="{ height: `${Math.max(c.height, Number(c.value) ? 2 : 0)}%` }"
          />
          <span
            v-if="Number(c.value)"
            class="absolute right-0 left-0 text-center text-[11px] whitespace-nowrap text-erp-muted erp-num"
            :style="{ bottom: `calc(${Math.max(c.height, 2)}% + 4px)` }"
          >
            {{ show(c.value, unit, true).replace('RM ', '') }}
          </span>
        </div>
        <span class="text-[11px] text-erp-muted">{{ c.label }}</span>
      </div>
    </div>

    <p v-if="card.note && !card.failed" class="m-0 text-xs text-erp-muted">{{ card.note }}</p>
  </section>
</template>
