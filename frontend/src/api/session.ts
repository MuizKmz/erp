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
  signIn: (identifier: string, password: string) => api<Issued>('/auth/sign-in', { method: 'POST', body: { identifier, password }, silent: true }),
  signOut: () => api<{ signedOut: boolean }>('/auth/sign-out', { method: 'POST', silent: true }),
  switchBranch: (branchCode: string) => api<Issued>('/auth/switch-branch', { method: 'POST', body: { branchCode } }),
}
