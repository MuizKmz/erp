/** Where each kind of Sales document opens. Types match the backend's entity type codes. */
const PATHS: Record<string, string> = {
  SAL_ENQUIRY: '/sales/enquiries',
  SAL_QUOTATION: '/sales/quotations',
  SAL_ORDER: '/sales/orders',
  SAL_DELIVERY: '/sales/deliveries',
  SAL_INVOICE: '/sales/invoices',
  SAL_PROFORMA: '/sales/proformas',
  SAL_CASH_SALE: '/sales/cash-sales',
  SAL_DEBIT_NOTE: '/sales/debit-notes',
  SAL_RETURN: '/sales/returns',
  SAL_CANCEL_ORDER: '/sales/cancel-orders',
}

/** Route of a document, or null for documents brought over from the old system. */
export function docRoute(type: string, id: string | null): string | null {
  const base = PATHS[type]
  return base && id ? `${base}/${id}` : null
}
