import type { ModulePermissions } from '../platform/context/permission.rules';
import { PUR_ROLE } from './shared/purchase.constants';

/**
 * Which role may do what in Purchase. Declared to the platform PermissionCatalogue at start-up and checked by
 * @RequirePermission(...). ADMIN holds everything.
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

/** The Purchase catalogue: labels for the role editor (A09), and the grants above as the starter roles. */
export const PURCHASE_PERMISSION_CATALOGUE: ModulePermissions = {
  module: 'purchase',
  label: 'Purchase',
  viewKey: P.VIEW,
  permissions: [
    { key: P.VIEW, object: 'Purchase', action: 'View' },
    { key: P.REQUEST_CREATE, object: 'Request', action: 'Create' },
    { key: P.REQUEST_PROCESS, object: 'Request', action: 'Convert or reject' },
    { key: P.RFQ_MANAGE, object: 'Request for quotation', action: 'Manage' },
    { key: P.ORDER_EDIT, object: 'Purchase order', action: 'Edit' },
    { key: P.ORDER_RELEASE, object: 'Purchase order', action: 'Release' },
    { key: P.RECEIPT_EDIT, object: 'Goods receipt', action: 'Edit' },
    { key: P.RECEIPT_CONFIRM, object: 'Goods receipt', action: 'Confirm' },
    { key: P.INVOICE_EDIT, object: 'Supplier invoice', action: 'Edit' },
    { key: P.CANCEL_ORDER_EDIT, object: 'Cancel order', action: 'Edit' },
    { key: P.CANCEL_ORDER_RELEASE, object: 'Cancel order', action: 'Release' },
    { key: P.CASH_PURCHASE_EDIT, object: 'Cash purchase', action: 'Edit' },
    { key: P.CASH_PURCHASE_RELEASE, object: 'Cash purchase', action: 'Release' },
    { key: P.DEBIT_NOTE_EDIT, object: 'Debit note', action: 'Edit' },
    { key: P.RETURN_EDIT, object: 'Purchase return', action: 'Edit' },
    { key: P.RETURN_RELEASE, object: 'Purchase return', action: 'Release' },
    { key: P.SETTINGS_MANAGE, object: 'Settings', action: 'Manage' },
  ],
  starterGrants: PURCHASE_ROLE_GRANTS,
};
