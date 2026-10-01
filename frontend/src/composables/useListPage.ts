import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryValue } from 'vue-router'
import type { ListQuery, ListResponse } from '@/api/list'

/**
 * List pages keep their state — status tab, filters, page — in the URL query, so Back and Refresh
 * return to the same view (CLAUDE.md → Frontend rules). The URL is the only source of truth: changing a
 * filter rewrites the query, and the watcher reloads the data.
 */
export function useListPage<R extends ListResponse<unknown>>(options: {
  /** Extra query keys this list understands besides page, pageSize, status, q, sort, dateFrom, dateTo. */
  filterKeys?: string[]
  pageSize?: number
  fetch: (query: ListQuery) => Promise<R>
}) {
  const route = useRoute()
  const router = useRouter()
  const path = route.path
  const keys = ['status', 'q', 'sort', 'dateFrom', 'dateTo', ...(options.filterKeys ?? [])]

  const one = (v: LocationQueryValue | LocationQueryValue[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? ''

  type Params = Record<string, string> & { status: string; page: number; pageSize: number }
  const params = computed<Params>(() => {
    const p: Record<string, string> = {}
    for (const key of keys) p[key] = one(route.query[key])
    return {
      ...p,
      status: p.status || 'all',
      page: Math.max(1, Number(one(route.query.page)) || 1),
      pageSize: Number(one(route.query.pageSize)) || options.pageSize || 20,
    } as Params
  })

  const data = shallowRef<R | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  let requestNo = 0

  async function load() {
    const mine = ++requestNo
    loading.value = true
    failed.value = false
    try {
      const { status, ...rest } = params.value
      const result = await options.fetch({ ...rest, status: status === 'all' ? undefined : status })
      if (mine === requestNo) data.value = result
    } catch {
      if (mine === requestNo) failed.value = true
    } finally {
      if (mine === requestNo) loading.value = false
    }
  }

  // Reload whenever this page's query changes (not when navigating away).
  const stop = watch(
    () => route.fullPath,
    () => {
      if (route.path === path) void load()
    },
    { immediate: true },
  )
  onBeforeUnmount(stop)

  function update(patch: Record<string, string | number | undefined>, resetPage = true) {
    const query: Record<string, string> = {}
    const merged = { ...route.query, ...(resetPage ? { page: undefined } : {}), ...patch }
    for (const [k, v] of Object.entries(merged)) {
      const value = Array.isArray(v) ? v[0] : v
      if (value !== undefined && value !== null && value !== '') query[k] = String(value)
    }
    void router.replace({ path, query })
  }

  return {
    params,
    data,
    loading,
    failed,
    reload: load,
    setStatus: (status: string) => update({ status: status === 'all' ? undefined : status }),
    setFilter: (key: string, value: string | undefined) => update({ [key]: value || undefined }),
    setFilters: (patch: Record<string, string | undefined>) => update(patch),
    setPage: (page: number) => update({ page: page === 1 ? undefined : page }, false),
  }
}
