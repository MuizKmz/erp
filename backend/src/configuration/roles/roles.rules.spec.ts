import type { ModulePermissions } from '../../platform/context/permission.rules';
import { AUDITOR_ROLE, permissionCount, STARTER_ROLES, starterPermissions } from './roles.rules';

const mod = (module: string, keys: string[], starterGrants: Record<string, string[]>): ModulePermissions => ({
  module,
  label: module,
  viewKey: `${module}.view`,
  permissions: keys.map((k) => ({ key: `${module}.${k}`, object: k, action: 'Do' })),
  starterGrants,
});

describe('starter roles', () => {
  const modules = [
    mod('buy', ['view', 'order.edit', 'order.release'], { BUYER: ['buy.order.release', 'buy.view', 'buy.order.edit'], CLERK: ['buy.view'] }),
    mod('sell', ['view', 'order.edit'], { CLERK: ['sell.view'] }),
    mod('config', ['view', 'audit.view', 'user.edit'], { [AUDITOR_ROLE]: ['config.view', 'config.audit.view'] }),
  ];

  it('gives a starter role what every module grants it, in catalogue order', () => {
    expect(starterPermissions(modules, 'BUYER')).toEqual(['buy.view', 'buy.order.edit', 'buy.order.release']);
    expect(starterPermissions(modules, 'CLERK')).toEqual(['buy.view', 'sell.view']);
    expect(starterPermissions(modules, 'NOBODY')).toEqual([]);
  });

  it('lets the Auditor view every module, and stores nothing for Administrator, who holds all', () => {
    expect(starterPermissions(modules, AUDITOR_ROLE)).toEqual(['buy.view', 'sell.view', 'config.view', 'config.audit.view']);
    expect(starterPermissions(modules, 'ADMIN')).toEqual([]);
    expect(permissionCount('ADMIN', 0, 54)).toBe(54);
    expect(permissionCount('SALES_AGENT', 9, 54)).toBe(9);
  });

  it('has the 16 starter roles once each, by name, with only Sales agent limited to its own customers', () => {
    const codes = STARTER_ROLES.map((r) => r.code);
    expect(new Set(codes).size).toBe(16);
    expect(codes).toEqual(expect.arrayContaining(['ADMIN', AUDITOR_ROLE, 'SALES_AGENT', 'MASTER_DATA_ADMIN']));
    const names = STARTER_ROLES.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    expect(STARTER_ROLES.filter((r) => r.agentScope).map((r) => r.code)).toEqual(['SALES_AGENT']);
  });
});
