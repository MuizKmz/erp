import { hasPermission, permissionsOf, toRoleGrants } from '../platform/context/permission.rules';
import { CORE_PERMISSIONS as P, CORE_ROLE_GRANTS } from './core.permissions';

/** Who may change what in Core (CLAUDE.md → Phase 3, decision 2). */
describe('Core grants', () => {
  const grants = toRoleGrants(CORE_ROLE_GRANTS);
  const can = (role: string, permission: string) => hasPermission(grants, [role], permission);

  it('lets the Master Data Admin do everything in Core', () => {
    for (const permission of Object.values(P)) expect(can('MASTER_DATA_ADMIN', permission)).toBe(true);
  });

  it('lets buyers change suppliers but not contract prices; the Purchasing Manager may do both', () => {
    expect(can('PURCHASE_BUYER', P.SUPPLIER_EDIT)).toBe(true);
    expect(can('PURCHASE_BUYER', P.SUPPLIER_CONTRACT)).toBe(false);
    expect(can('PURCHASE_MANAGER', P.SUPPLIER_CONTRACT)).toBe(true);
    expect(can('PURCHASE_BUYER', P.ITEM_EDIT)).toBe(false);
  });

  it('lets the Finance Manager change customer credit only', () => {
    expect(can('FINANCE_MANAGER', P.CUSTOMER_CREDIT)).toBe(true);
    expect(can('FINANCE_MANAGER', P.CUSTOMER_EDIT)).toBe(false);
  });

  it('lets sales agents look but never change master data', () => {
    expect(permissionsOf(grants, ['SALES_AGENT'])).toEqual([P.VIEW]);
  });
});
