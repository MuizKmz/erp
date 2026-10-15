import { api } from './http'

export interface DevUser {
  code: string
  name: string
  email: string
  roles: string[]
  branchCodes: string[]
  department: string | null
}

export interface DevUsersResponse {
  tenantName?: string
  defaultUser: string | null
  items: DevUser[]
}

export interface Me {
  user: {
    id: string
    tenantId: string
    code: string
    name: string
    email: string
    roles: string[]
    branchCodes: string[]
    department: string | null
    jobTitle: string | null
  }
  tenantId: string
  /** "CLB Groups" */
  tenantName: string
  authMode: AuthMode
  branchCode: string
  /** The user's branches with their names, default first (top bar's branch switch). */
  branches: { code: string; name: string }[]
  permissions: string[]
  /** Business date, YYYY-MM-DD (DEV_TODAY pins it to 29 Sep 2026 in the demo). */
  today: string
  /** Server "now" as ISO, shifted to `today` when DEV_TODAY is set. */
  now: string
  timeZone: string
}

export type AuthMode = 'dev' | 'jwt'

export interface AuthModeInfo {
  mode: AuthMode
  tenantName: string
  signIn: { lockoutAttempts: number; lockoutMinutes: number; refreshDays: number; idleMinutes: number }
}

/** What sign-in, refresh and branch switch answer; the refresh token travels in an httpOnly cookie. */
export interface Issued {
  accessToken: string
  expiresAt: string
  branchCode: string
}

/** A03 · a new authenticator secret: the key to type and the QR code to scan. */
export interface TwoFactorSetup {
  key: string
  otpauthUrl: string
  /** PNG data URL */
  qr: string
}

/** Sign-in answers: done, or a code from the app still to come (A03). The ticket lives 10 minutes and only opens the next step. */
export type SignInAnswer =
  | ({ step: 'DONE' } & Issued)
  | { step: 'TWO_FACTOR'; ticket: string; demoBypassCode?: string }
  | { step: 'TWO_FACTOR_SETUP'; ticket: string; setup: TwoFactorSetup; reason: string; demoBypassCode?: string }

/** What a reset or set-password link is for (shown before the new password is typed). */
export interface LinkInfo {
  kind: 'RESET_PASSWORD' | 'SET_PASSWORD'
  user: { code: string; name: string; email: string }
  expiresAt: string
  passwordMinLength: number
  refuseCommonPasswords: boolean
}

/** A11 · My account. */
export interface Account {
  me: { code: string; name: string; email: string; roles: string[] }
  /** false with AUTH_MODE=dev: passwords and devices matter only with sign-in on */
  signInOn: boolean
  password: { hint: string; changedAt: string | null; changeDue: boolean }
  twoFactor: { enabled: boolean; required: boolean; recoveryCodesLeft: number }
  sessions: { id: string; device: string; ipAddress: string | null; createdAt: string; lastActivityAt: string; current: boolean }[]
  idleMinutes: number
  refreshDays: number
}

export interface ModuleTile {
  code: 'core' | 'purchase' | 'sales' | 'mes' | 'wms' | 'config'
  name: string
  tag: string
  state: 'OPEN' | 'EXISTING' | 'LATER'
  route: string | null
}

export const sessionApi = {
  devUsers: () => api<DevUsersResponse>('/dev/users', { silent: true }),
  me: () => api<Me>('/me', { silent: true }),
  modules: () => api<{ items: ModuleTile[] }>('/me/modules'),
}

/** Sign-in (AUTH_MODE=jwt). */
export const authApi = {
  mode: () => api<AuthModeInfo>('/auth/mode', { silent: true }),
  signIn: (identifier: string, password: string) => api<SignInAnswer>('/auth/sign-in', { method: 'POST', body: { identifier, password }, silent: true }),
  twoFactor: (ticket: string, code: string) => api<Issued & { recoveryCodesLeft?: number }>('/auth/two-factor', { method: 'POST', body: { ticket, code }, silent: true }),
  completeSetup: (ticket: string, code: string) => api<Issued & { recoveryCodes: string[] }>('/auth/two-factor/setup', { method: 'POST', body: { ticket, code }, silent: true }),
  forgot: (identifier: string) => api<{ message: string }>('/auth/forgot', { method: 'POST', body: { identifier }, silent: true }),
  link: (token: string) => api<LinkInfo>('/auth/link', { method: 'POST', body: { token }, silent: true }),
  reset: (token: string, newPassword: string) => api<{ code: string }>('/auth/reset', { method: 'POST', body: { token, newPassword }, silent: true }),
  signOut: () => api<{ signedOut: boolean }>('/auth/sign-out', { method: 'POST', silent: true }),
  switchBranch: (branchCode: string) => api<Issued>('/auth/switch-branch', { method: 'POST', body: { branchCode } }),
}

/** A11 · My account: signed in, no permission needed. */
export const accountApi = {
  get: (silent = false) => api<Account>('/account', { silent }),
  changePassword: (currentPassword: string, newPassword: string) => api<Account>('/account/password', { method: 'POST', body: { currentPassword, newPassword } }),
  endSession: (id: string) => api<Account>(`/account/sessions/${id}`, { method: 'DELETE' }),
  endOthers: () => api<Account>('/account/sessions/sign-out-others', { method: 'POST' }),
  startTwoFactor: () => api<TwoFactorSetup>('/account/two-factor/setup', { method: 'POST' }),
  enableTwoFactor: (code: string) => api<{ recoveryCodes: string[]; account: Account }>('/account/two-factor/enable', { method: 'POST', body: { code } }),
  disableTwoFactor: (password: string) => api<Account>('/account/two-factor/disable', { method: 'POST', body: { password } }),
  newRecoveryCodes: (password: string) => api<{ recoveryCodes: string[]; account: Account }>('/account/two-factor/recovery-codes', { method: 'POST', body: { password } }),
}
