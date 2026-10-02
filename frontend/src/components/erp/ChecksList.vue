<script setup lang="ts">
import { Check, X } from '@lucide/vue'
import SideCard from './SideCard.vue'

/**
 * "Checks" card: what must be true before a document can go ahead, green when met and red when not.
 * The server checks the same rules again; this list is the live preview.
 */
defineProps<{
  title?: string
  checks: { text: string; ok: boolean }[]
}>()
</script>

<template>
  <SideCard :title="title ?? 'Checks'">
    <div class="flex flex-col gap-2">
      <div v-for="c in checks" :key="c.text" class="flex items-start gap-2 text-[13px]" :class="c.ok ? '' : 'text-note-error-text'">
        <Check v-if="c.ok" :size="16" :stroke-width="2.5" class="mt-0.5 shrink-0 text-mod-line" aria-label="Met" />
        <X v-else :size="16" :stroke-width="2.5" class="mt-0.5 shrink-0" aria-label="Not met" />
        <span>{{ c.text }}</span>
      </div>
    </div>
  </SideCard>
</template>
