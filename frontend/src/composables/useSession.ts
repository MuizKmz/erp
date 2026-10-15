import { computed, reactive, readonly } from 'vue'
import { ApiError, onSignedOut, refreshAccess, setAccessToken, setDevBranch, setDevUser } from '@/api/http'
import { authApi, sessionApi, type AuthMode, type AuthModeInfo, type DevUser, type Me } from '@/api/session'

/**
 * Who is using the app, in two modes (CLAUDE.md → Phase 4 · A5):
 * - dev (AUTH_MODE=dev): the Dev user switcher picks a seeded user, remembered in localStorage and sent as x-dev-user;
 *   the branch switch sends x-branch.
 * - jwt (AUTH_MODE=jwt): the user signs in. The access token lives in memory, the refresh token in an httpOnly cookie,
 *   so a reload signs back in silently; a lost sign-in opens the sign-in page.
 */

const STORAGE_KEY = 'zora.devUser'
const BRANCH_KEY = 'zora.devBranch'

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function store(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

const state = reactive({
  ready: false,
  error: '' as string,
  mode: 'dev' as AuthMode,
  /** Sign-in mode: nobody is signed in on this device (the router opens /sign-in). */
  signedOut: false,
  /** Why the last sign-in ended ("Signed out after 30 minutes without activity."), shown on the sign-in page. */
  signedOutMessage: '' as string,
  info: null as AuthModeInfo | null,
  userCode: readStored(STORAGE_KEY),
  me: null as Me | null,
  users: [] as DevUser[],
  tenantName: '' as string,
  /** server now − browser now, so the top-bar clock follows DEV_TODAY */
  clockOffsetMs: 0,
  /** Bumps on every user or branch switch; pages are keyed on it so they reload their data. */
  version: 0,
})

async function loadMe(): Promise<void> {
  if (state.mode === 'dev') setDevUser(state.userCode)
  const me = await sessionApi.me()
  state.me = me
  state.tenantName = me.tenantName || state.tenantName
  state.clockOffsetMs = new Date(me.now).getTime() - Date.now()
}

/** Dev only: open a link with ?as=AZ to act as that user (handy for testing approvals and screenshots). */
function userFromLink(): string {
  const code = new URLSearchParams(window.location.search).get('as')
  return code ? code.trim().toUpperCase() : ''
}

/** A sign-in the server no longer accepts (signed out elsewhere, idle, deactivated). */
onSignedOut((message) => {
  if (state.mode !== 'jwt' || state.signedOut) return
  state.me = null
  state.signedOut = true
  state.signedOutMessage = message
})

/** Called once by App.vue. */
async function start(): Promise<void> {
  state.error = ''
  try {
    state.info = await authApi.mode()
    state.mode = state.info.mode
    state.tenantName = state.info.tenantName
    if (state.mode === 'jwt') {
      setDevUser('')
      setDevBranch('')
      if (await refreshAccess()) await loadMe()
      else state.signedOut = true
      state.ready = true
      return
    }
    const users = await sessionApi.devUsers()
    state.users = users.items
    state.tenantName = users.tenantName ?? state.tenantName
    const linked = userFromLink()
    if (linked && users.items.some((u) => u.code === linked)) {
      state.userCode = linked
      store(STORAGE_KEY, linked)
    }
    if (!state.userCode || !users.items.some((u) => u.code === state.userCode)) {
      state.userCode = users.defaultUser ?? users.items[0]?.code ?? ''
    }
    // A remembered branch only while the user still works there.
    const branch = readStored(BRANCH_KEY)
    setDevBranch(users.items.find((u) => u.code === state.userCode)?.branchCodes.includes(branch) ? branch : '')
    await loadMe()
    state.ready = true
  } catch (error) {
    state.error = error instanceof ApiError ? error.message : 'Could not start the app.'
  }
}

async function switchUser(code: string): Promise<void> {
  if (code === state.userCode) return
  state.userCode = code
  store(STORAGE_KEY, code)
  setDevBranch('')
  store(BRANCH_KEY, '')
  await loadMe()
  state.version += 1
}

/** Sign-in mode: email or user code and password. Throws the server's answer (wrong password, locked …). */
async function signIn(identifier: string, password: string): Promise<void> {
  const issued = await authApi.signIn(identifier, password)
  setAccessToken(issued.accessToken)
  await loadMe()
  state.signedOut = false
  state.signedOutMessage = ''
  state.version += 1
}

/** Ends this device's session; dev mode has nothing to end. */
async function signOut(): Promise<void> {
  if (state.mode !== 'jwt') return
  try {
    await authApi.signOut()
  } finally {
    setAccessToken(null)
    state.me = null
    state.signedOut = true
    state.signedOutMessage = 'You signed out.'
  }
}

/** Work in another of the user's branches (FR-SEC-021): a new access token, or the x-branch header in dev mode. */
async function switchBranch(code: string): Promise<void> {
  if (code === state.me?.branchCode) return
  if (state.mode === 'jwt') {
    setAccessToken((await authApi.switchBranch(code)).accessToken)
  } else {
    setDevBranch(code)
    store(BRANCH_KEY, code)
  }
  await loadMe()
  state.version += 1
}

export function useSession() {
  return {
    state: readonly(state),
    start,
    switchUser,
    signIn,
    signOut,
    switchBranch,
    isJwt: computed(() => state.mode === 'jwt'),
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
  MASTER_DATA_ADMIN: 'Master Data Admin',
  AUDITOR: 'Auditor',
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
