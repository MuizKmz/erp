import { api } from '@/api/http'
import type { CoreDashboard } from '../types'

/** Core API (/api/v1/core). Each build step adds its resources here. */
export const coreApi = {
  dashboard: () => api<CoreDashboard>('/core/dashboard'),
}
