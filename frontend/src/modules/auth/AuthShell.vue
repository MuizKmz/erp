<script setup lang="ts">
import BrandMark from '@/components/erp/BrandMark.vue'
/** The frame of the sign-in pages (CfgSignIn.html, CfgTwoFactor.html): the dark bar with the logo and one centred card. */
withDefaults(defineProps<{ width?: 'narrow' | 'wide' }>(), { width: 'narrow' })
</script>

<template>
  <div data-module="config" class="flex min-h-screen flex-col bg-launcher-bg">
    <header class="flex h-14 shrink-0 items-center gap-3 bg-launcher-bar px-7">
      <BrandMark :size="34" />
      <div class="text-base font-bold text-erp-on-dark">Zora Pro ERP</div>
    </header>
    <main class="flex grow justify-center px-4 pt-[72px] pb-10">
      <section class="erp-card flex h-fit w-full flex-col gap-4 px-8 py-7" :class="width === 'wide' ? 'max-w-[518px]' : 'max-w-[398px]'">
        <slot />
      </section>
    </main>
  </div>
</template>
