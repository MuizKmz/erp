import { api } from '@/api/http'
import type { SalesDashboard } from '../types'

export const salesApi = {
  dashboard: () => api<SalesDashboard>('/sales/dashboard'),
  approvalsCount: () => api<{ waitingForMe: number }>('/sales/approvals/count', { silent: true }),
}
