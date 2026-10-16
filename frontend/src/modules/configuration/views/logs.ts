import type { AuditRow, LogPeriod } from '../types'

/** The period filter of the security log and the audit trail; "Last 7 days" when none is picked. */
export const PERIOD_OPTIONS: { value: LogPeriod; label: string }[] = [
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
]

/** Where a changed record opens: its own screen in its module (route strings only, no module imports). */
const RECORD_ROUTES: Record<string, string> = {
  PUR_REQUEST: '/purchase/requests',
  PUR_RFQ: '/purchase/rfqs',
  PUR_ORDER: '/purchase/orders',
  PUR_RECEIPT: '/purchase/receipts',
  PUR_CANCEL_ORDER: '/purchase/cancel-orders',
  PUR_INVOICE: '/purchase/invoices',
  PUR_CASH_PURCHASE: '/purchase/cash-purchases',
  PUR_DEBIT_NOTE: '/purchase/debit-notes',
  PUR_RETURN: '/purchase/returns',
  SAL_ENQUIRY: '/sales/enquiries',
  SAL_QUOTATION: '/sales/quotations',
  SAL_ORDER: '/sales/orders',
  SAL_DELIVERY: '/sales/deliveries',
  SAL_CANCEL_ORDER: '/sales/cancel-orders',
  SAL_PROFORMA: '/sales/proformas',
  SAL_INVOICE: '/sales/invoices',
  SAL_CASH_SALE: '/sales/cash-sales',
  SAL_DEBIT_NOTE: '/sales/debit-notes',
  SAL_RETURN: '/sales/returns',
  MDM_ITEM: '/core/items',
  MDM_CUSTOMER: '/core/customers',
  MDM_SUPPLIER: '/core/suppliers',
  MDM_PRICE_LIST: '/core/price-lists',
  SYS_USER: '/config/users',
  SYS_ROLE: '/config/roles',
}
/** Screens that are one list without a page per record. */
const LIST_ROUTES: Record<string, string> = {
  MDM_UOM: '/core/uoms',
  MDM_TAX_CODE: '/core/tax-codes',
  MDM_REFERENCE: '/core/reference',
  MDM_WAREHOUSE: '/core/warehouses',
  SYS_LEGAL_ENTITY: '/config/company',
  SYS_BRANCH: '/config/branches',
  SYS_SETTING: '/config/sign-in-settings',
}

/** The link for a row's record, or null (deleted records still link: their page says not found). */
export function recordLink(row: Pick<AuditRow, 'entityType' | 'entityId'>): string | null {
  const page = RECORD_ROUTES[row.entityType]
  if (page) return `${page}/${row.entityId}`
  return LIST_ROUTES[row.entityType] ?? null
}
