import type { ModulePermissions } from '../platform/context/permission.rules';
import { CORE_ROLE } from './core.constants';

/** Core permissions (CLAUDE.md → Phase 3 · Roles and permissions). Put on actions with @RequirePermission. */
export const CORE_PERMISSIONS = {
  VIEW: 'core.view',
  ITEM_EDIT: 'core.item.edit',
  CUSTOMER_EDIT: 'core.customer.edit',
  /** Credit limit, overdue limit, credit term and credit scope of a customer. */
  CUSTOMER_CREDIT: 'core.customer.credit',
  SUPPLIER_EDIT: 'core.supplier.edit',
  /** A contract price lets an order skip the RFQ (Purchase rule 4), so it has its own permission. */
  SUPPLIER_CONTRACT: 'core.supplier.contract',
  PRICE_LIST_EDIT: 'core.price_list.edit',
  TAX_EDIT: 'core.tax.edit',
  REFERENCE_EDIT: 'core.reference.edit',
  WAREHOUSE_EDIT: 'core.warehouse.edit',
  IMPORT: 'core.import',
} as const;

const P = CORE_PERMISSIONS;

/** Every role that works in Purchase or Sales may look things up in Core. Role names come from Master Data. */
const VIEWERS = [
  'BRANCH_MANAGER', 'FINANCE_DIRECTOR', 'STORE', 'AP_CLERK', 'REQUESTER',
  'SALES_AGENT', 'SALES_BILLING', 'SALES_STORE', 'COUNTER_STAFF', 'SALES_MANAGER',
];

/**
 * Role → permissions. ADMIN holds every permission already. Buyers also maintain suppliers (SRS §3.3); only the
 * Purchasing Manager and the Master Data Admin change contract prices; the Finance Manager also changes credit.
 */
export const CORE_ROLE_GRANTS: Record<string, string[]> = {
  ...Object.fromEntries(VIEWERS.map((role) => [role, [P.VIEW]])),
  [CORE_ROLE.MASTER_DATA_ADMIN]: Object.values(P),
  [CORE_ROLE.FINANCE_MANAGER]: [P.VIEW, P.CUSTOMER_CREDIT],
  [CORE_ROLE.PURCHASE_BUYER]: [P.VIEW, P.SUPPLIER_EDIT],
  [CORE_ROLE.PURCHASE_MANAGER]: [P.VIEW, P.SUPPLIER_EDIT, P.SUPPLIER_CONTRACT],
};

/** The Core catalogue: labels for the role editor (A09), and the grants above as the starter roles. */
export const CORE_PERMISSION_CATALOGUE: ModulePermissions = {
  module: 'core',
  label: 'Core',
  viewKey: P.VIEW,
  permissions: [
    { key: P.VIEW, object: 'Core', action: 'View' },
    { key: P.IMPORT, object: 'Core', action: 'Import' },
    { key: P.ITEM_EDIT, object: 'Item and unit', action: 'Edit' },
    { key: P.CUSTOMER_EDIT, object: 'Customer', action: 'Edit' },
    { key: P.CUSTOMER_CREDIT, object: 'Customer', action: 'Change credit' },
    { key: P.SUPPLIER_EDIT, object: 'Supplier', action: 'Edit' },
    { key: P.SUPPLIER_CONTRACT, object: 'Supplier', action: 'Contract prices' },
    { key: P.PRICE_LIST_EDIT, object: 'Price list', action: 'Edit' },
    { key: P.TAX_EDIT, object: 'Tax code', action: 'Edit' },
    { key: P.REFERENCE_EDIT, object: 'Reference list', action: 'Edit' },
    { key: P.WAREHOUSE_EDIT, object: 'Warehouse', action: 'Edit' },
  ],
  starterGrants: CORE_ROLE_GRANTS,
};
