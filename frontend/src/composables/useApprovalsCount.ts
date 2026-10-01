import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ModuleDef } from '@/modules/registry'
import { useSession } from './useSession'

const REFRESH_MS = 60_000

/** The Approvals badge in the top bar: how many approvals wait for the current user. */
export function useApprovalsCount(module: () => ModuleDef) {
  const { state } = useSession()
  const count = ref<number | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  async function load() {
    try {
      count.value = (await module().approvalsCount()).waitingForMe
    } catch {
      count.value = null
    }
  }

  onMounted(() => {
    void load()
    timer = setInterval(() => void load(), REFRESH_MS)
  })
  onBeforeUnmount(() => clearInterval(timer))
  watch(() => state.version, () => void load())

  return { count, refresh: load }
}
