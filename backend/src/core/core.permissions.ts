import { CORE_ROLE } from './core.constants';

/** Core permissions (CLAUDE.md → Phase 3 · Roles and permissions). Put on actions with @RequirePermission. */
export const CORE_PERMISSIONS = {
  VIEW: 'core.view',
  EDIT: 'core.edit',
  /** Credit limit, overdue limit, credit term and credit scope of a customer. */
  CUSTOMER_CREDIT: 'core.customer.credit',
} as const;

const P = CORE_PERMISSIONS;

/** Every role that works in Purchase or Sales may look things up in Core. Role names come from Master Data. */
const VIEWERS = [
  'PURCHASE_BUYER', 'PURCHASE_MANAGER', 'BRANCH_MANAGER', 'FINANCE_DIRECTOR', 'STORE', 'AP_CLERK', 'REQUESTER',
  'SALES_AGENT', 'SALES_BILLING', 'SALES_STORE', 'COUNTER_STAFF', 'SALES_MANAGER',
];

/** Role → permissions. ADMIN holds every permission already. */
export const CORE_ROLE_GRANTS: Record<string, string[]> = {
  ...Object.fromEntries(VIEWERS.map((role) => [role, [P.VIEW]])),
  [CORE_ROLE.MASTER_DATA_ADMIN]: [P.VIEW, P.EDIT, P.CUSTOMER_CREDIT],
  [CORE_ROLE.FINANCE_MANAGER]: [P.VIEW, P.CUSTOMER_CREDIT],
};
