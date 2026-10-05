/** Entity type codes used in sys_activity, sys_approval_request, sys_doc_link and sys_attachment. */
export const SAL_ENTITY = {
  ENQUIRY: 'SAL_ENQUIRY',
  QUOTATION: 'SAL_QUOTATION',
  ORDER: 'SAL_ORDER', // same code Purchase uses for a sales order it links to by number
  DELIVERY: 'SAL_DELIVERY',
  INVOICE: 'SAL_INVOICE',
  PROFORMA: 'SAL_PROFORMA',
  CASH_SALE: 'SAL_CASH_SALE',
  DEBIT_NOTE: 'SAL_DEBIT_NOTE',
  RETURN: 'SAL_RETURN',
  CANCEL_ORDER: 'SAL_CANCEL_ORDER',
} as const;

export type SalEntityType = (typeof SAL_ENTITY)[keyof typeof SAL_ENTITY];

/** Numbering keys in sys_number_sequence (module "sales"). */
export const SAL_DOC_TYPE = {
  ENQUIRY: 'EQ',
  QUOTATION: 'QT',
  ORDER: 'SO',
  DELIVERY: 'DO',
  INVOICE: 'INV',
  CASH_SALE: 'CS',
  DEBIT_NOTE: 'DN',
  RETURN: 'SR',
  PROFORMA: 'PF',
  CANCEL_ORDER: 'CO',
} as const;

/** Edge names in sys_doc_link (from the earlier document to the later one). */
export const SAL_LINK = {
  QUOTED: 'QUOTED', // enquiry → quotation
  ORDERED: 'ORDERED', // quotation or enquiry → sales order
  DELIVERED: 'DELIVERED', // sales order → delivery order
  INVOICED: 'INVOICED', // delivery order (or sales order) → invoice
  REQUESTED: 'REQUESTED', // sales order → proforma
  DEPOSIT_USED: 'DEPOSIT_USED', // proforma → invoice
  RETURNED: 'RETURNED', // invoice → sales return
  DEBITED: 'DEBITED', // invoice → debit note
  CANCELLED: 'CANCELLED', // sales order → cancel order
} as const;

/** Roles from Master Data that Sales cares about. */
export const SAL_ROLE = {
  AGENT: 'SALES_AGENT',
  BILLING: 'SALES_BILLING',
  STORE: 'SALES_STORE',
  COUNTER: 'COUNTER_STAFF',
  MANAGER: 'SALES_MANAGER',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
} as const;

/** Documents a credit rule can apply to (S29). */
export const CREDIT_DOC = {
  QUOTATION: 'QUOTATION',
  SALES_ORDER: 'SALES_ORDER',
  DELIVERY: 'DELIVERY',
  INVOICE: 'INVOICE',
  CASH_SALE: 'CASH_SALE',
} as const;

/** What happens on a credit breach. */
export const CREDIT_ACTION = { ALLOW: 'ALLOW', WARN: 'WARN', APPROVAL: 'APPROVAL', BLOCK: 'BLOCK' } as const;

/** Events Sales publishes (EVENTS.md → Sales publishes). */
export const SAL_EVENT = {
  ORDER_RELEASED: 'sales.order.released',
  ORDER_BALANCE_CANCELLED: 'sales.order.balance_cancelled',
  SHIPMENT_REQUESTED: 'sales.shipment.requested',
  INVOICE_RELEASED: 'sales.invoice.released',
  RETURN_RELEASED: 'sales.return.released',
  DEBIT_NOTE_RELEASED: 'sales.debit_note.released',
  CASH_SALE_RELEASED: 'sales.cash_sale.released',
} as const;
