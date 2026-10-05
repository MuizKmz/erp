import { SAL_ROLE } from './shared/sales.constants';

/**
 * Sales permissions (CLAUDE.md → Phase 2 · Roles and permissions). Put on actions with @RequirePermission.
 * Approving is not a permission here: approval steps name a role or person (platform approvals).
 */
export const SALES_PERMISSIONS = {
  VIEW: 'sales.view',
  ENQUIRY_EDIT: 'sales.enquiry.edit',
  QUOTATION_EDIT: 'sales.quotation.edit',
  QUOTATION_RELEASE: 'sales.quotation.release',
  ORDER_EDIT: 'sales.order.edit',
  ORDER_RELEASE: 'sales.order.release',
  DELIVERY_EDIT: 'sales.delivery.edit',
  DELIVERY_CONFIRM: 'sales.delivery.confirm',
  INVOICE_EDIT: 'sales.invoice.edit',
  INVOICE_RELEASE: 'sales.invoice.release',
  PROFORMA_EDIT: 'sales.proforma.edit',
  CASH_SALE_EDIT: 'sales.cash_sale.edit',
  DEBIT_NOTE_EDIT: 'sales.debit_note.edit',
  RETURN_EDIT: 'sales.return.edit',
  RETURN_RECEIVE: 'sales.return.receive',
  CANCEL_ORDER_EDIT: 'sales.cancel_order.edit',
  CANCEL_ORDER_RELEASE: 'sales.cancel_order.release',
  MARGIN_VIEW: 'sales.margin.view',
  SETTINGS_MANAGE: 'sales.settings.manage',
} as const;

const P = SALES_PERMISSIONS;

/** Role → permissions (SalesUxGuide.html → "Who does what"). ADMIN holds every permission already. */
export const SALES_ROLE_GRANTS: Record<string, string[]> = {
  [SAL_ROLE.AGENT]: [
    P.VIEW, P.ENQUIRY_EDIT, P.QUOTATION_EDIT, P.QUOTATION_RELEASE, P.ORDER_EDIT, P.ORDER_RELEASE, P.CANCEL_ORDER_EDIT, P.RETURN_EDIT,
  ],
  [SAL_ROLE.BILLING]: [P.VIEW, P.INVOICE_EDIT, P.INVOICE_RELEASE, P.PROFORMA_EDIT, P.DEBIT_NOTE_EDIT],
  [SAL_ROLE.STORE]: [P.VIEW, P.DELIVERY_EDIT, P.DELIVERY_CONFIRM, P.RETURN_RECEIVE],
  [SAL_ROLE.COUNTER]: [P.VIEW, P.CASH_SALE_EDIT],
  [SAL_ROLE.MANAGER]: [
    P.VIEW, P.ENQUIRY_EDIT, P.QUOTATION_EDIT, P.QUOTATION_RELEASE, P.ORDER_EDIT, P.ORDER_RELEASE, P.CANCEL_ORDER_EDIT,
    P.CANCEL_ORDER_RELEASE, P.MARGIN_VIEW,
  ],
  [SAL_ROLE.FINANCE_MANAGER]: [P.VIEW],
};
