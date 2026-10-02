import { api } from '@/api/http'
import type { ListQuery, ListResponse } from '@/api/list'
import type {
  ApprovalCheck,
  DemandReport,
  InboxDetail,
  InboxList,
  BillableOrder,
  CancelOrderDetail,
  CashOverview,
  CashPurchaseDetail,
  CashPurchaseInput,
  CashPurchaseListItem,
  CancelOrderInput,
  CancelOrderListItem,
  CancelOrderTemplate,
  DebitCheck,
  DebitNoteDetail,
  DebitNoteInput,
  DebitNoteListItem,
  InvoiceDetail,
  InvoiceInput,
  InvoiceKpis,
  InvoiceListItem,
  InvoiceTemplate,
  ItemOption,
  OpenBalance,
  PaymentMethodOption,
  OrderDetail,
  OrderInput,
  OrderListItem,
  PurchaseDashboard,
  RequestDetail,
  RequestInput,
  ReceiptDetail,
  ReceiptInput,
  ReceiptListItem,
  ReceiptTemplate,
  ReceiptWaiting,
  RequestListItem,
  ReturnDetail,
  ReturnInput,
  ReturnListItem,
  ReturnOverview,
  ReturnTemplate,
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

export const receiptsApi = {
  waiting: () => api<ReceiptWaiting>('/purchase/receipts/waiting'),
  list: (query: ListQuery) => api<ListResponse<ReceiptListItem>>('/purchase/receipts', { query }),
  template: (poId: string) => api<ReceiptTemplate>('/purchase/receipts/new', { query: { poId } }),
  get: (id: string) => api<ReceiptDetail>(`/purchase/receipts/${id}`),
  create: (body: ReceiptInput & { poId: string }) => api<ReceiptDetail>('/purchase/receipts', { method: 'POST', body }),
  update: (id: string, body: ReceiptInput & { version: number }) => api<ReceiptDetail>(`/purchase/receipts/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) =>
    api<{ deleted: boolean; docNo: string }>(`/purchase/receipts/${id}`, { method: 'DELETE', query: { version } }),
  confirm: (id: string, version: number) => api<ReceiptDetail>(`/purchase/receipts/${id}/confirm`, { method: 'POST', body: { version } }),
}

export type InvoiceList = ListResponse<InvoiceListItem> & { month: { name: string; count: number; total: string } }

export const invoicesApi = {
  list: (query: ListQuery) => api<InvoiceList>('/purchase/invoices', { query }),
  kpis: () => api<InvoiceKpis>('/purchase/invoices/kpis'),
  billableOrders: (supplierCode: string) => api<{ items: BillableOrder[] }>('/purchase/invoices/billable-orders', { query: { supplierCode } }),
  template: (poId: string) => api<InvoiceTemplate>('/purchase/invoices/new', { query: { poId } }),
  get: (id: string) => api<InvoiceDetail>(`/purchase/invoices/${id}`),
  create: (body: InvoiceInput & { poId: string; supplierInvoiceNo: string; invoiceDate: string }) =>
    api<InvoiceDetail>('/purchase/invoices', { method: 'POST', body }),
  update: (id: string, body: InvoiceInput & { version: number }) => api<InvoiceDetail>(`/purchase/invoices/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) =>
    api<{ deleted: boolean; docNo: string }>(`/purchase/invoices/${id}`, { method: 'DELETE', query: { version } }),
  decide: (id: string, body: { version: number; action: 'record' | 'hold' | 'acceptAsBilled'; message?: string; note?: string }) =>
    api<InvoiceDetail>(`/purchase/invoices/${id}/decide`, { method: 'POST', body }),
}

export const cancelOrdersApi = {
  list: (query: ListQuery) => api<ListResponse<CancelOrderListItem> & { reasons: string[] }>('/purchase/cancel-orders', { query }),
  openBalances: () => api<{ items: OpenBalance[] }>('/purchase/cancel-orders/open-balances'),
  cancellableOrders: () =>
    api<{ items: { id: string; docNo: string; isMigrated: boolean; supplierName: string; openText: string }[] }>('/purchase/cancel-orders/cancellable-orders'),
  template: (poId: string) => api<CancelOrderTemplate>('/purchase/cancel-orders/new', { query: { poId } }),
  get: (id: string) => api<CancelOrderDetail>(`/purchase/cancel-orders/${id}`),
  create: (body: CancelOrderInput & { poId: string; reason: string }) => api<CancelOrderDetail>('/purchase/cancel-orders', { method: 'POST', body }),
  update: (id: string, body: CancelOrderInput & { version: number }) => api<CancelOrderDetail>(`/purchase/cancel-orders/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) =>
    api<{ deleted: boolean; docNo: string }>(`/purchase/cancel-orders/${id}`, { method: 'DELETE', query: { version } }),
  release: (id: string, version: number) => api<CancelOrderDetail>(`/purchase/cancel-orders/${id}/release`, { method: 'POST', body: { version } }),
}

export const returnsApi = {
  list: (query: ListQuery) => api<ListResponse<ReturnListItem> & { reasons: string[] }>('/purchase/returns', { query }),
  overview: () => api<ReturnOverview>('/purchase/returns/overview'),
  returnableReceipts: () =>
    api<{ items: { id: string; docNo: string; docDate: string; poNo: string; supplierName: string; returnableText: string }[] }>('/purchase/returns/returnable-receipts'),
  template: (grnId: string) => api<ReturnTemplate>('/purchase/returns/new', { query: { grnId } }),
  get: (id: string) => api<ReturnDetail>(`/purchase/returns/${id}`),
  create: (body: ReturnInput & { grnId: string; reason: string }) => api<ReturnDetail>('/purchase/returns', { method: 'POST', body }),
  update: (id: string, body: ReturnInput & { version: number }) => api<ReturnDetail>(`/purchase/returns/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/purchase/returns/${id}`, { method: 'DELETE', query: { version } }),
  release: (id: string, version: number) => api<ReturnDetail>(`/purchase/returns/${id}/release`, { method: 'POST', body: { version } }),
  remind: (id: string) => api<ReturnDetail>(`/purchase/returns/${id}/remind`, { method: 'POST', body: {} }),
  creditNote: (id: string, version: number, creditNoteNo: string) =>
    api<ReturnDetail>(`/purchase/returns/${id}/credit-note`, { method: 'POST', body: { version, creditNoteNo } }),
  replacement: (id: string, version: number, supplierDoNo: string) =>
    api<ReturnDetail>(`/purchase/returns/${id}/replacement`, { method: 'POST', body: { version, supplierDoNo } }),
}

export const debitNotesApi = {
  list: (query: ListQuery) =>
    api<ListResponse<DebitNoteListItem> & { reasons: string[]; totals: { count: number; total: string; since: string | null } }>('/purchase/debit-notes', { query }),
  invoices: (supplierCode: string) =>
    api<{ items: { id: string; docNo: string; supplierInvoiceNo: string; docDate: string; total: string; statusLabel: string }[] }>('/purchase/debit-notes/invoices', { query: { supplierCode } }),
  check: (invoiceId: string, items: string[], total: string) => {
    const params = new URLSearchParams({ invoiceId, total })
    for (const i of items) params.append('items', i)
    return api<DebitCheck>(`/purchase/debit-notes/check?${params.toString()}`, { silent: true })
  },
  get: (id: string) => api<DebitNoteDetail>(`/purchase/debit-notes/${id}`),
  create: (body: DebitNoteInput & { invoiceId: string; theirNoteNo: string; reason: string }) => api<DebitNoteDetail>('/purchase/debit-notes', { method: 'POST', body }),
  update: (id: string, body: DebitNoteInput & { version: number }) => api<DebitNoteDetail>(`/purchase/debit-notes/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/purchase/debit-notes/${id}`, { method: 'DELETE', query: { version } }),
  submit: (id: string, version: number, note?: string) =>
    api<DebitNoteDetail>(`/purchase/debit-notes/${id}/submit-for-approval`, { method: 'POST', body: { version, note } }),
  release: (id: string, version: number) => api<DebitNoteDetail>(`/purchase/debit-notes/${id}/release`, { method: 'POST', body: { version } }),
}

export const cashPurchasesApi = {
  list: (query: ListQuery) => api<ListResponse<CashPurchaseListItem>>('/purchase/cash-purchases', { query }),
  overview: () => api<CashOverview>('/purchase/cash-purchases/overview'),
  paymentMethods: () => api<{ items: PaymentMethodOption[] }>('/purchase/cash-purchases/payment-methods'),
  get: (id: string) => api<CashPurchaseDetail>(`/purchase/cash-purchases/${id}`),
  create: (body: CashPurchaseInput & { supplierCode: string; paymentMethodCode: string }) => api<CashPurchaseDetail>('/purchase/cash-purchases', { method: 'POST', body }),
  update: (id: string, body: CashPurchaseInput & { version: number }) => api<CashPurchaseDetail>(`/purchase/cash-purchases/${id}`, { method: 'PATCH', body }),
  remove: (id: string, version: number) => api<{ deleted: boolean; docNo: string }>(`/purchase/cash-purchases/${id}`, { method: 'DELETE', query: { version } }),
  release: (id: string, version: number) => api<CashPurchaseDetail>(`/purchase/cash-purchases/${id}/release`, { method: 'POST', body: { version } }),
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
  locations: (warehouseCode: string) =>
    api<{ items: { code: string; name: string; warehouseCode: string }[] }>('/purchase/lookups/locations', { query: { warehouseCode } }),
  users: (role: string, branchCode?: string) =>
    api<{ items: { code: string; name: string; email: string }[] }>('/purchase/lookups/users', {
      query: { role, branchCode },
    }),
}
