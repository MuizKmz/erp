import { computed, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useViewBranch } from './useViewBranch'

/**
 * A report page's filters and data. The filters live in the URL query, so back and refresh keep them (CLAUDE.md →
 * Frontend rules); the report loads again whenever one changes.
 */
export function useReport<T>(keys: readonly string[], fetch: (query: Record<string, string | undefined>) => Promise<T>) {
  const route = useRoute()
  const router = useRouter()
  const page = route.name
  const data = ref(null) as Ref<T | null>
  const loading = ref(false)

  // While the top bar shows one branch it decides (x-view-branch): a branch left in the URL is ignored.
  const topBar = useViewBranch().fromTopBar
  const read = (key: string) => (key === 'branch' && topBar.value ? '' : typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
  const filters = computed(() => Object.fromEntries(keys.map((k) => [k, read(k)])) as Record<string, string>)
  const signature = computed(() => JSON.stringify(filters.value))

  async function load() {
    loading.value = true
    try {
      data.value = await fetch(Object.fromEntries(Object.entries(filters.value).map(([k, v]) => [k, v || undefined])))
    } finally {
      loading.value = false
    }
  }
  // Not when the person is leaving for another page.
  watch(signature, () => route.name === page && void load(), { immediate: true })

  function setFilter(key: string, value: string) {
    void router.replace({ query: { ...route.query, [key]: value || undefined } })
  }

  return { data, loading, filters, setFilter, load }
}
