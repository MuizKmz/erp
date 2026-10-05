import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type { CustomerOption, InboxDetail, InboxList, ItemSearchResult, OrderDetail, OrderInput, OrderListItem, SalesDashboard } from '../types'

export const salesApi = {
  dashboard: () => api<SalesDashboard>('/sales/dashboard'),
  approvalsCount: () => api<{ waitingForMe: number }>('/sales/approvals/count', { silent: true }),
}

export const salesOrdersApi = {
  list: (query: ListQuery) => api<ListResponse<OrderListItem>>('/sales/orders', { query }),
  get: (id: string) => api<OrderDetail>(`/sales/orders/${id}`),
  create: (input: OrderInput) => api<OrderDetail>('/sales/orders', { method: 'POST', body: input }),
  update: (id: string, input: Partial<OrderInput> & { version: number }) => api<OrderDetail>(`/sales/orders/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/sales/orders/${id}`, { method: 'DELETE', query: { version } }),
  requestApproval: (id: string, version: number, reason: string) =>
    api<OrderDetail>(`/sales/orders/${id}/request-approval`, { method: 'POST', body: { version, reason } }),
  release: (id: string, version: number, silent = false) => api<OrderDetail>(`/sales/orders/${id}/release`, { method: 'POST', body: { version }, silent }),
}

export const salesApprovalsApi = {
  list: (status: 'waiting' | 'approved' | 'rejected') => api<InboxList>('/sales/approvals', { query: { status } }),
  get: (id: string) => api<InboxDetail>(`/sales/approvals/${id}`),
  approve: (id: string, comment: string) => api<{ outcome: string; docNo: string }>(`/sales/approvals/${id}/approve`, { method: 'POST', body: { comment } }),
  reject: (id: string, comment: string) => api<{ outcome: string; docNo: string }>(`/sales/approvals/${id}/reject`, { method: 'POST', body: { comment } }),
}

export const salesLookupsApi = {
  customers: (q: string) => api<{ items: CustomerOption[] }>('/sales/lookups/customers', { query: { q } }),
  items: (query: { q?: string; customerCode?: string; branchCode?: string; group?: string; sellableOnly?: string }) =>
    api<ItemSearchResult>('/sales/lookups/items', { query }),
  agents: () => api<{ items: { code: string; name: string; branchCodes: string[] }[] }>('/sales/lookups/agents'),
  branches: () => api<{ items: { code: string; name: string }[] }>('/sales/lookups/branches'),
}
