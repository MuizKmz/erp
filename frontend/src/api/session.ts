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
  }
  tenantId: string
  branchCode: string
  permissions: string[]
  /** Business date, YYYY-MM-DD (DEV_TODAY pins it to 29 Sep 2026 in the demo). */
  today: string
  /** Server "now" as ISO, shifted to `today` when DEV_TODAY is set. */
  now: string
  timeZone: string
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
