import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from './useSession'

/**
 * Which of the person's branches a home or list shows: `?branch=PNG` in the URL, or all their branches when empty.
 * The server narrows the data scope to it (never wider than their own branches), so every number and row follows.
 * The top-bar branch is different: it only stamps new documents.
 */
export function useViewBranch() {
  const route = useRoute()
  const router = useRouter()
  const { state } = useSession()

  const branches = computed(() => state.me?.branches ?? [])
  /** The picker and the Branch column only appear for someone working in more than one branch. */
  const several = computed(() => branches.value.length > 1)
  const nameOf = (code: string | null | undefined) => (code ? (branches.value.find((b) => b.code === code)?.name ?? code) : '')

  /** The branch chosen, or '' for all of the person's branches. */
  const code = computed(() => {
    const raw = route.query.branch
    const value = typeof raw === 'string' ? raw : ''
    return branches.value.some((b) => b.code === value) ? value : ''
  })
  /** "Showing: JB Tiong Nam (HQ), Penang" or "Showing: Penang". */
  const showing = computed(() => `Showing: ${code.value ? nameOf(code.value) : branches.value.map((b) => b.name).join(', ')}`)
  /** Query to send with the page's requests. */
  const query = computed((): Record<string, string> => (code.value ? { branch: code.value } : {}))

  function set(value: string) {
    const next = { ...route.query, branch: value || undefined, page: undefined }
    void router.replace({ path: route.path, query: next })
  }

  return { branches, several, code, showing, query, nameOf, set }
}
