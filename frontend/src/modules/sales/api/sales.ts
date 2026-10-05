import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type {
  CustomerCardData,
  CustomerOption,
  DeliveryDetail,
  DeliveryInput,
  DeliveryListItem,
  DeliveryOverview,
  EnquiryDetail,
  EnquiryInput,
  EnquiryListItem,
  EnquiryTypeOption,
  InboxDetail,
  InboxList,
  ItemSearchResult,
  OrderDetail,
  OrderInput,
  OrderListItem,
  QuotationDetail,
  QuotationInput,
  QuotationListItem,
  SalesDashboard,
} from '../types'

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

export type QuotationList = ListResponse<QuotationListItem> & { expiringSoon: { docNo: string; validUntil: string }[] }

export const salesQuotationsApi = {
  list: (query: ListQuery) => api<QuotationList>('/sales/quotations', { query }),
  get: (id: string) => api<QuotationDetail>(`/sales/quotations/${id}`),
  create: (input: QuotationInput) => api<QuotationDetail>('/sales/quotations', { method: 'POST', body: input }),
  update: (id: string, input: Partial<QuotationInput> & { version: number }) => api<QuotationDetail>(`/sales/quotations/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/sales/quotations/${id}`, { method: 'DELETE', query: { version } }),
  requestApproval: (id: string, version: number, reason: string) =>
    api<QuotationDetail>(`/sales/quotations/${id}/request-approval`, { method: 'POST', body: { version, reason } }),
  release: (id: string, version: number, silent = false) => api<QuotationDetail>(`/sales/quotations/${id}/release`, { method: 'POST', body: { version }, silent }),
  email: (id: string) => api<{ sentTo: string }>(`/sales/quotations/${id}/email`, { method: 'POST' }),
  revise: (id: string, version: number) => api<QuotationDetail>(`/sales/quotations/${id}/revise`, { method: 'POST', body: { version } }),
  lost: (id: string, version: number, reason: string) => api<QuotationDetail>(`/sales/quotations/${id}/lost`, { method: 'POST', body: { version, reason } }),
  transfer: (id: string, version: number, lineNos?: number[]) =>
    api<{ orderId: string; orderNo: string }>(`/sales/quotations/${id}/transfer`, { method: 'POST', body: { version, lineNos } }),
}

export const salesEnquiriesApi = {
  list: (query: ListQuery) => api<ListResponse<EnquiryListItem>>('/sales/enquiries', { query }),
  get: (id: string) => api<EnquiryDetail>(`/sales/enquiries/${id}`),
  create: (input: EnquiryInput) => api<EnquiryDetail>('/sales/enquiries', { method: 'POST', body: input }),
  update: (id: string, input: EnquiryInput & { version: number }) => api<EnquiryDetail>(`/sales/enquiries/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/sales/enquiries/${id}`, { method: 'DELETE', query: { version } }),
  forward: (id: string, version: number) => api<EnquiryDetail>(`/sales/enquiries/${id}/forward`, { method: 'POST', body: { version } }),
  createQuotation: (id: string) => api<QuotationDetail>(`/sales/enquiries/${id}/quotation`, { method: 'POST' }),
  lost: (id: string, version: number, reason: string) => api<EnquiryDetail>(`/sales/enquiries/${id}/lost`, { method: 'POST', body: { version, reason } }),
  customerCard: (code: string) => api<CustomerCardData | null>(`/sales/enquiries/customer-card/${encodeURIComponent(code)}`),
}

export const salesDeliveriesApi = {
  overview: () => api<DeliveryOverview>('/sales/deliveries/overview'),
  list: (query: ListQuery) => api<ListResponse<DeliveryListItem>>('/sales/deliveries', { query }),
  get: (id: string) => api<DeliveryDetail>(`/sales/deliveries/${id}`),
  create: (salesOrderId: string) => api<DeliveryDetail>('/sales/deliveries', { method: 'POST', body: { salesOrderId } }),
  update: (id: string, input: DeliveryInput) => api<DeliveryDetail>(`/sales/deliveries/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/sales/deliveries/${id}`, { method: 'DELETE', query: { version } }),
  requestApproval: (id: string, version: number, reason: string) =>
    api<DeliveryDetail>(`/sales/deliveries/${id}/request-approval`, { method: 'POST', body: { version, reason } }),
  confirm: (id: string, version: number) => api<DeliveryDetail>(`/sales/deliveries/${id}/confirm`, { method: 'POST', body: { version } }),
}

/** Files on a Sales document: uploaded straight onto the document (proof of delivery, photos). */
export const salesFilesApi = {
  upload: (file: File, kind: string, entityType: string, entityId: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    form.append('entityType', entityType)
    form.append('entityId', entityId)
    return api<{ id: string; fileName: string; mimeType: string; downloadUrl: string }>('/attachments', { method: 'POST', body: form })
  },
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
  enquiryTypes: () => api<{ types: EnquiryTypeOption[]; sources: { code: string; name: string }[] }>('/sales/lookups/enquiry-types'),
}
