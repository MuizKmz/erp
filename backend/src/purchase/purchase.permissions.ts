import { PUR_ROLE } from './shared/purchase.constants';

/**
 * Which role may do what in Purchase. Registered with the platform PermissionRegistry at start-up and
 * checked by @RequirePermission(...). ADMIN holds everything.
 * Approving is not a permission here: approval steps name a role or person (platform approvals).
 */
export const PURCHASE_PERMISSIONS = {
  VIEW: 'purchase.view',
  REQUEST_CREATE: 'purchase.request.create',
  REQUEST_PROCESS: 'purchase.request.process', // convert to RFQ/PO, reject
  RFQ_MANAGE: 'purchase.rfq.manage',
  ORDER_EDIT: 'purchase.order.edit',
  ORDER_RELEASE: 'purchase.order.release',
  RECEIPT_EDIT: 'purchase.receipt.edit',
  RECEIPT_CONFIRM: 'purchase.receipt.confirm',
  INVOICE_EDIT: 'purchase.invoice.edit',
  CANCEL_ORDER_EDIT: 'purchase.cancel_order.edit',
  CANCEL_ORDER_RELEASE: 'purchase.cancel_order.release',
  CASH_PURCHASE_EDIT: 'purchase.cash_purchase.edit',
  CASH_PURCHASE_RELEASE: 'purchase.cash_purchase.release',
  DEBIT_NOTE_EDIT: 'purchase.debit_note.edit',
  RETURN_EDIT: 'purchase.return.edit',
  RETURN_RELEASE: 'purchase.return.release',
  SETTINGS_MANAGE: 'purchase.settings.manage',
} as const;

const P = PURCHASE_PERMISSIONS;

/** Role → permissions (UX guide → "People"). */
export const PURCHASE_ROLE_GRANTS: Record<string, string[]> = {
  [PUR_ROLE.REQUESTER]: [P.VIEW, P.REQUEST_CREATE, P.CASH_PURCHASE_EDIT],
  [PUR_ROLE.STORE]: [P.VIEW, P.REQUEST_CREATE, P.RECEIPT_EDIT, P.RECEIPT_CONFIRM, P.RETURN_EDIT, P.CASH_PURCHASE_EDIT],
  [PUR_ROLE.BUYER]: [
    P.VIEW, P.REQUEST_CREATE, P.REQUEST_PROCESS, P.RFQ_MANAGE, P.ORDER_EDIT, P.ORDER_RELEASE, P.RECEIPT_EDIT,
    P.CANCEL_ORDER_EDIT, P.CASH_PURCHASE_EDIT, P.CASH_PURCHASE_RELEASE, P.RETURN_EDIT, P.RETURN_RELEASE,
    P.DEBIT_NOTE_EDIT, P.INVOICE_EDIT,
  ],
  [PUR_ROLE.AP_CLERK]: [P.VIEW, P.INVOICE_EDIT, P.DEBIT_NOTE_EDIT],
  [PUR_ROLE.MANAGER]: [
    P.VIEW, P.REQUEST_PROCESS, P.RFQ_MANAGE, P.ORDER_EDIT, P.ORDER_RELEASE, P.CANCEL_ORDER_EDIT,
    P.CANCEL_ORDER_RELEASE, P.CASH_PURCHASE_RELEASE, P.RETURN_RELEASE, P.SETTINGS_MANAGE,
  ],
  [PUR_ROLE.BRANCH_MANAGER]: [P.VIEW],
  [PUR_ROLE.FINANCE_DIRECTOR]: [P.VIEW],
};
