import { onBeforeUnmount, ref } from 'vue'

/**
 * The last breadcrumb of a document page is its number ("Home › Purchase Order › PO-0001"), which only the
 * page knows once it has loaded. Pages set it here; ModuleLayout shows it instead of the route title.
 */
const crumb = ref<string | null>(null)

export function useCrumb() {
  return crumb
}

export function usePageCrumb() {
  onBeforeUnmount(() => (crumb.value = null))
  return (text: string | null) => (crumb.value = text)
}
