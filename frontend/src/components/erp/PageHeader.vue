<script setup lang="ts">
import { Building2 } from '@lucide/vue'
import { useViewBranch } from '@/composables/useViewBranch'

/**
 * Title row of a page. Lists: 18px title + one-line description. Documents: 20px title with the number and
 * status chip (slot "chip"), the line below names the supplier and where it came from. Actions on the right;
 * only one filled module-colour button per screen.
 */
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    document?: boolean
    /** The document's issuing branch, shown next to the chip to someone who works in more than one branch. */
    branch?: string | null
  }>(),
  { document: false, branch: null },
)
const view = useViewBranch()
</script>

<template>
  <div class="flex items-end justify-between gap-4">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2.5">
        <h1 class="m-0 font-bold" :class="document ? 'text-xl' : 'text-lg'">{{ title }}</h1>
        <slot name="chip" />
        <span
          v-if="branch && view.several.value"
          class="inline-flex items-center gap-1 rounded-full bg-erp-track px-2.5 py-0.5 text-xs font-semibold text-erp-subtle"
          :title="`Issued by ${view.nameOf(branch)}`"
        >
          <Building2 :size="12" aria-hidden="true" />{{ view.nameOf(branch) }}
        </span>
      </div>
      <p v-if="subtitle || $slots.subtitle" class="mt-1 mb-0 text-xs text-erp-muted">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
