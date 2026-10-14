import { onBeforeUnmount, watch } from 'vue'

/**
 * Puts the module's theme (data-module) on <html> while a module layout is shown. PrimeVue dialogs, confirm boxes and
 * pickers open at the end of <body>, outside the layout, so without this they fall back to the default colours.
 * The theme is only CSS variables, so setting it on the root changes nothing else.
 */
export function useModuleTheme(key: () => string) {
  const root = document.documentElement
  const stop = watch(key, (k) => (root.dataset.module = k), { immediate: true })
  onBeforeUnmount(() => {
    stop()
    // Another layout may already have set its own theme; leave that one alone.
    if (root.dataset.module === key()) delete root.dataset.module
  })
}
