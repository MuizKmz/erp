import type { ModulePermissions } from '../platform/context/permission.rules';

/** WMS module: one permission, because it only shows data. */
export const WMS_PERMISSIONS = {
  VIEW: 'wms.view',
} as const;

const P = WMS_PERMISSIONS;

/**
 * Who starts with the read-only view. Shipping names every customer and a sales agent may only see their own, so agents
 * are left out, and so is Sales store, which agents can also hold. Store staff have the Store role. Counter staff,
 * billing, AP clerks and requesters do not need it. ADMIN holds every permission, and the Auditor gets every module's
 * view permission.
 */
const VIEWERS = ['PURCHASE_BUYER', 'PURCHASE_MANAGER', 'BRANCH_MANAGER', 'STORE', 'SALES_MANAGER', 'FINANCE_DIRECTOR', 'FINANCE_MANAGER', 'MASTER_DATA_ADMIN'];

export const WMS_ROLE_GRANTS: Record<string, string[]> = Object.fromEntries(VIEWERS.map((role) => [role, [P.VIEW]]));

export const WMS_PERMISSION_CATALOGUE: ModulePermissions = {
  module: 'wms',
  label: 'WMS',
  viewKey: P.VIEW,
  permissions: [{ key: P.VIEW, object: 'WMS', action: 'View' }],
  starterGrants: WMS_ROLE_GRANTS,
};
