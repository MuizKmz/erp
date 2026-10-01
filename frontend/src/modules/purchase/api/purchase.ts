import { api } from '@/api/http'
import type { PurchaseDashboard } from '../types'

export const purchaseApi = {
  dashboard: () => api<PurchaseDashboard>('/purchase/dashboard'),
  approvalsCount: () => api<{ waitingForMe: number }>('/purchase/approvals/count', { silent: true }),
}
