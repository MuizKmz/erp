import { api } from '@/api/http'
import type { ConfigDashboard } from '../types'

/** Configuration API (/api/v1/config). Each build step adds its resources here. */
export const configApi = {
  dashboard: () => api<ConfigDashboard>('/config/dashboard'),
}
