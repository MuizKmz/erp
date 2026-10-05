import { computed, reactive, readonly } from 'vue'
import { ApiError, setDevUser } from '@/api/http'
import { sessionApi, type DevUser, type Me } from '@/api/session'

/**
 * Who is using the app. No login yet: the Dev user switcher picks a seeded user, which is remembered in
 * localStorage and sent as x-dev-user. When login arrives, only this file and http.ts change.
 */

const STORAGE_KEY = 'zora.devUser'

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function store(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

const state = reactive({
  ready: false,
  error: '' as string,
  userCode: readStored(),
  me: null as Me | null,
  users: [] as DevUser[],
  tenantName: '' as string,
  /** server now − browser now, so the top-bar clock follows DEV_TODAY */
  clockOffsetMs: 0,
  /** Bumps on every user switch; pages are keyed on it so they reload their data. */
  version: 0,
})

async function loadMe(): Promise<void> {
  setDevUser(state.userCode)
  const me = await sessionApi.me()
  state.me = me
  state.clockOffsetMs = new Date(me.now).getTime() - Date.now()
}

/** Dev only: open a link with ?as=AZ to act as that user (handy for testing approvals and screenshots). */
function userFromLink(): string {
  const code = new URLSearchParams(window.location.search).get('as')
  return code ? code.trim().toUpperCase() : ''
}

/** Called once by App.vue. */
async function start(): Promise<void> {
  state.error = ''
  try {
    const users = await sessionApi.devUsers()
    state.users = users.items
    state.tenantName = users.tenantName ?? ''
    const linked = userFromLink()
    if (linked && users.items.some((u) => u.code === linked)) {
      state.userCode = linked
      store(linked)
    }
    if (!state.userCode || !users.items.some((u) => u.code === state.userCode)) {
      state.userCode = users.defaultUser ?? users.items[0]?.code ?? ''
    }
    await loadMe()
    state.ready = true
  } catch (error) {
    state.error = error instanceof ApiError ? error.message : 'Could not start the app.'
  }
}

async function switchUser(code: string): Promise<void> {
  if (code === state.userCode) return
  state.userCode = code
  store(code)
  await loadMe()
  state.version += 1
}

export function useSession() {
  return {
    state: readonly(state),
    start,
    switchUser,
    user: computed(() => state.me?.user ?? null),
    today: computed(() => state.me?.today ?? ''),
    /** Current time on the business clock. */
    now: () => new Date(Date.now() + state.clockOffsetMs),
    can: (permission: string) => {
      const permissions = state.me?.permissions ?? []
      return permissions.includes('*') || permissions.includes(permission)
    },
  }
}

const ROLE_LABELS: Record<string, string> = {
  PURCHASE_BUYER: 'Buyer',
  PURCHASE_MANAGER: 'Purchasing Manager',
  BRANCH_MANAGER: 'Branch Manager',
  FINANCE_DIRECTOR: 'Finance Director',
  STORE: 'Store',
  AP_CLERK: 'AP clerk',
  REQUESTER: 'Requester',
  ADMIN: 'Admin',
  SALES_AGENT: 'Sales agent',
  SALES_BILLING: 'Billing clerk',
  SALES_STORE: 'Store · delivery',
  COUNTER_STAFF: 'Counter staff',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_MANAGER: 'Finance Manager',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}
