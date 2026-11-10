import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from './useSession'

/**
 * Which of the person's branches a page shows. The top bar decides: one branch (sent with every request as
 * x-view-branch), or all of them. While it shows all, a list's Branch filter may narrow that one list with `?branch=`
 * in the URL. The server narrows the data scope (never wider than the person's own branches), so every row follows.
 */
export function useViewBranch() {
  const route = useRoute()
  const router = useRouter()
  const { state } = useSession()

  const branches = computed(() => state.me?.branches ?? [])
  /** The Branch column only appears for someone working in more than one branch. */
  const several = computed(() => branches.value.length > 1)
  /** The top bar shows one branch: lists hide their Branch filter, everything is already narrowed. */
  const fromTopBar = computed(() => several.value && !state.viewAll)
  /** A list's Branch filter: only while the top bar shows all branches. */
  const canFilter = computed(() => several.value && state.viewAll)
  const nameOf = (code: string | null | undefined) => (code ? (branches.value.find((b) => b.code === code)?.name ?? code) : '')

  /** The branch shown, or '' for all of the person's branches. */
  const code = computed(() => {
    if (fromTopBar.value) return state.me?.branchCode ?? ''
    const raw = route.query.branch
    const value = typeof raw === 'string' ? raw : ''
    return branches.value.some((b) => b.code === value) ? value : ''
  })
  /** "Showing: JB Tiong Nam (HQ), Penang" or "Showing: Penang". */
  const showing = computed(() => `Showing: ${code.value ? nameOf(code.value) : branches.value.map((b) => b.name).join(', ')}`)
  /** Query to send with the page's requests (the top bar's branch already travels as a header). */
  const query = computed((): Record<string, string> => (!fromTopBar.value && code.value ? { branch: code.value } : {}))

  function set(value: string) {
    const next = { ...route.query, branch: value || undefined, page: undefined }
    void router.replace({ path: route.path, query: next })
  }

  return { branches, several, canFilter, fromTopBar, code, showing, query, nameOf, set }
}
