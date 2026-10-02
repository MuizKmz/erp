/** Where each kind of linked document opens. Types match the backend's entity type codes. */
const PATHS: Record<string, string> = {
  PUR_REQUEST: '/purchase/requests',
  PUR_RFQ: '/purchase/rfqs',
  PUR_ORDER: '/purchase/orders',
  PUR_RECEIPT: '/purchase/receipts',
  PUR_INVOICE: '/purchase/invoices',
  PUR_CANCEL_ORDER: '/purchase/cancel-orders',
  PUR_CASH_PURCHASE: '/purchase/cash-purchases',
  PUR_DEBIT_NOTE: '/purchase/debit-notes',
  PUR_RETURN: '/purchase/returns',
}

/** Route of a document, or null for documents outside Purchase (e.g. a sales order before Sales exists). */
export function docRoute(type: string, id: string | null): string | null {
  const base = PATHS[type]
  return base && id ? `${base}/${id}` : null
}

/** Documents brought over from the old system (the "-L-" series, e.g. PO-L-0877) are shown, not opened. */
export function isLegacyNo(docNo: string): boolean {
  return /-L-/.test(docNo)
}
