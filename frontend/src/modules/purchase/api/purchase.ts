import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type {
  ApprovalCheck,
  DemandReport,
  InboxDetail,
  InboxList,
  ItemOption,
  OrderDetail,
  OrderInput,
  OrderListItem,
  PurchaseDashboard,
  RequestDetail,
  RequestInput,
  RequestListItem,
  ReplyInput,
  RfqDetail,
  RfqInput,
  RfqListItem,
  RfqOpenReply,
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

export type RequestList = ListResponse<RequestListItem> & { departments: string[] }

export const demandApi = {
  get: (branch?: string) => api<DemandReport>('/purchase/demand', { query: { branch } }),
}

export const requestsApi = {
  list: (query: ListQuery) => api<RequestList>('/purchase/requests', { query }),
  get: (id: string) => api<RequestDetail>(`/purchase/requests/${id}`),
  create: (body: RequestInput) => api<RequestDetail>('/purchase/requests', { method: 'POST', body }),
  fromDemand: (lines: { itemCode: string; qty: string }[]) =>
    api<RequestDetail>('/purchase/requests/from-demand', { method: 'POST', body: { lines } }),
  update: (id: string, body: RequestInput & { version: number }) =>
    api<RequestDetail>(`/purchase/requests/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) =>
    api<{ deleted: boolean; docNo: string }>(`/purchase/requests/${id}`, { method: 'DELETE', query: { version } }),
  submit: (id: string, version: number) =>
    api<RequestDetail>(`/purchase/requests/${id}/submit`, { method: 'POST', body: { version } }),
  reject: (id: string, version: number, reason: string) =>
    api<RequestDetail>(`/purchase/requests/${id}/reject`, { method: 'POST', body: { version, reason } }),
  toPo: (id: string, body: { version: number; groups: { supplierCode: string; lineNos: number[] }[] }) =>
    api<{ orders: { id: string; docNo: string }[]; request: RequestDetail }>(`/purchase/requests/${id}/to-po`, {
      method: 'POST',
      body,
    }),
}

export type RfqList = ListResponse<RfqListItem> & { openReplies: RfqOpenReply[] }

export const rfqsApi = {
  list: (query: ListQuery) => api<RfqList>('/purchase/rfqs', { query }),
  get: (id: string) => api<RfqDetail>(`/purchase/rfqs/${id}`),
  create: (body: RfqInput) => api<RfqDetail>('/purchase/rfqs', { method: 'POST', body }),
  recordReply: (id: string, body: ReplyInput) => api<RfqDetail>(`/purchase/rfqs/${id}/replies`, { method: 'POST', body }),
  addSupplier: (id: string, version: number, supplierCode: string) =>
    api<RfqDetail>(`/purchase/rfqs/${id}/suppliers`, { method: 'POST', body: { version, supplierCode } }),
  remind: (id: string, supplierCode?: string) => api<RfqDetail>(`/purchase/rfqs/${id}/remind`, { method: 'POST', body: { supplierCode } }),
  award: (id: string, body: { version: number; supplierCode: string; reason?: string }) =>
    api<{ order: { id: string; docNo: string }; rfq: RfqDetail }>(`/purchase/rfqs/${id}/award`, { method: 'POST', body }),
  close: (id: string, version: number, reason: string) =>
    api<RfqDetail>(`/purchase/rfqs/${id}/close`, { method: 'POST', body: { version, reason } }),
}

export const attachmentsApi = {
  upload: (file: File, kind: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    return api<{ id: string; fileName: string }>('/attachments', { method: 'POST', body: form })
  },
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
