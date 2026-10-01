import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type {
  ApprovalCheck,
  InboxDetail,
  InboxList,
  ItemOption,
  OrderDetail,
  OrderInput,
  OrderListItem,
  PurchaseDashboard,
  SupplierOption,
  WarehouseOption,
} from '../types'

export type OrderList = ListResponse<OrderListItem> & { summary: { count: number; total: string } }

export const purchaseApi = {
  dashboard: () => api<PurchaseDashboard>('/purchase/dashboard'),
  approvalsCount: () => api<{ waitingForMe: number }>('/purchase/approvals/count', { silent: true }),
}

export const ordersApi = {
  list: (query: ListQuery) => api<OrderList>('/purchase/orders', { query }),
  get: (id: string) => api<OrderDetail>(`/purchase/orders/${id}`),
  create: (body: OrderInput) => api<OrderDetail>('/purchase/orders', { method: 'POST', body }),
  update: (id: string, body: OrderInput & { version: number }) =>
    api<OrderDetail>(`/purchase/orders/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) =>
    api<{ deleted: boolean; docNo: string }>(`/purchase/orders/${id}`, { method: 'DELETE', query: { version } }),
  approvalCheck: (id: string) => api<ApprovalCheck>(`/purchase/orders/${id}/approval-check`),
  submit: (id: string, body: { version: number; note?: string; approverCode?: string }) =>
    api<OrderDetail>(`/purchase/orders/${id}/submit-for-approval`, { method: 'POST', body }),
  release: (id: string, version: number) =>
    api<OrderDetail>(`/purchase/orders/${id}/release`, { method: 'POST', body: { version } }),
  email: (id: string) => api<{ sentTo: string }>(`/purchase/orders/${id}/email`, { method: 'POST', body: {} }),
}

export const approvalsApi = {
  list: (status: 'waiting' | 'approved' | 'rejected') => api<InboxList>('/purchase/approvals', { query: { status } }),
  get: (id: string) => api<InboxDetail>(`/purchase/approvals/${id}`),
  approve: (id: string, comment: string) =>
    api<{ outcome: string; docNo: string }>(`/purchase/approvals/${id}/approve`, { method: 'POST', body: { comment } }),
  reject: (id: string, comment: string) =>
    api<{ outcome: string; docNo: string }>(`/purchase/approvals/${id}/reject`, { method: 'POST', body: { comment } }),
}

export const lookupsApi = {
  suppliers: (q: string) => api<{ items: SupplierOption[] }>('/purchase/lookups/suppliers', { query: { q } }),
  items: (q: string, supplierCode?: string) =>
    api<{ items: ItemOption[] }>('/purchase/lookups/items', { query: { q, supplierCode } }),
  warehouses: () => api<{ items: WarehouseOption[] }>('/purchase/lookups/warehouses'),
  branches: () => api<{ items: { code: string; name: string }[] }>('/purchase/lookups/branches'),
  users: (role: string, branchCode?: string) =>
    api<{ items: { code: string; name: string; email: string }[] }>('/purchase/lookups/users', {
      query: { role, branchCode },
    }),
}
