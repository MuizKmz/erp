import { PermissionRegistry } from '../platform/context/permission.registry';
import { CORE_PERMISSIONS as P, CORE_ROLE_GRANTS } from './core.permissions';

/** Who may change what in Core (CLAUDE.md → Phase 3, decision 2). */
describe('Core grants', () => {
  const registry = new PermissionRegistry();
  for (const [role, granted] of Object.entries(CORE_ROLE_GRANTS)) registry.grant(role, granted);
  const can = (role: string, permission: string) => registry.has([role], permission);

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
    expect(registry.permissionsFor(['SALES_AGENT'])).toEqual([P.VIEW]);
  });
});
