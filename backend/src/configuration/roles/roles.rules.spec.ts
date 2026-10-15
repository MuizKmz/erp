import type { ModulePermissions } from '../../platform/context/permission.rules';
import {
  ADMIN_LOCKED,
  AUDITOR_ROLE,
  compareText,
  deleteRoleRefusal,
  groupCatalogue,
  isAsStarter,
  permissionChangeText,
  permissionCount,
  permissionDiff,
  personText,
  ROLE_CODE,
  roleSubtitle,
  scopeText,
  STARTER_ROLES,
  starterPermissions,
  unknownKeys,
} from './roles.rules';

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

describe('roles and permissions (A08 to A10)', () => {
  const sales = mod('sales', ['view', 'margin.view', 'return.edit'], {});
  const order = sales.permissions.map((p) => p.key);

  it('takes codes of capitals, digits and underscores, starting with a letter', () => {
    expect(ROLE_CODE.test('QA_LEAD')).toBe(true);
    expect(ROLE_CODE.test('Q')).toBe(false);
    expect(ROLE_CODE.test('1QA')).toBe(false);
    expect(ROLE_CODE.test('qa_lead')).toBe(false);
  });

  it('lets a role hold only keys from the catalogue (rule 5), and says what a save adds and removes', () => {
    expect(unknownKeys(['sales.view', 'sales.fly'], new Set(order))).toEqual(['sales.fly']);
    expect(permissionDiff(['sales.view', 'sales.return.edit'], ['sales.margin.view', 'sales.view'], order)).toEqual({ added: ['sales.margin.view'], removed: ['sales.return.edit'] });
    const label = (k: string) => ({ 'sales.margin.view': 'See margin (Sales)', 'sales.return.edit': 'Edit (Sales return)' })[k] ?? k;
    expect(permissionChangeText(['sales.margin.view'], ['sales.return.edit'], label)).toBe('added See margin (Sales); removed Edit (Sales return)');
    expect(permissionChangeText([], [], label)).toBeNull();
  });

  it('deletes only a custom role nobody holds (rules 2 and 4)', () => {
    expect(deleteRoleRefusal({ code: 'ADMIN', name: 'Administrator', isStarter: true }, [])).toBe(ADMIN_LOCKED);
    expect(deleteRoleRefusal({ code: 'SALES_AGENT', name: 'Sales agent', isStarter: true }, [])).toBe('Sales agent is a starter role, so it stays. Take its permissions away or reset it instead.');
    expect(deleteRoleRefusal({ code: 'QA_LEAD', name: 'QA lead', isStarter: false }, ['NZ'])).toBe('QA lead is held by 1 user (NZ). Take it away from them first.');
    expect(deleteRoleRefusal({ code: 'QA_LEAD', name: 'QA lead', isStarter: false }, [])).toBeNull();
  });

  it('writes the lines A08 to A10 show', () => {
    expect(scopeText(true)).toBe('Own customers only');
    expect(scopeText(false)).toBe('Their branches');
    expect(roleSubtitle('SALES_AGENT', 9, 3, true)).toBe('9 permissions · 3 users · own customers only');
    expect(roleSubtitle('ADMIN', 54, 1, false)).toBe('All permissions · 1 user · their branches');
    const agent = { name: 'Sales agent', agentScope: true, keys: new Set(['a', 'b', 'c']) };
    const manager = { name: 'Sales Manager', agentScope: false, keys: new Set(['a', 'b', 'd']) };
    expect(compareText(agent, manager)).toBe('Both roles give 2 permissions. Sales agent sees only its own customers; Sales Manager sees all customers in its branches.');
    expect(compareText(manager, { ...manager, name: 'Buyer' })).toBe('Both roles give 3 permissions. Both see all customers in their branches.');
    expect(personText('Aina Rahman', 16, 3, ['Sales agent'])).toBe('Aina Rahman holds 16 permissions from 3 roles. Sales agent limits them to their own customers.');
    expect(personText('Nurul', 4, 1, [])).toBe('Nurul holds 4 permissions from 1 role.');
  });

  it('lays the catalogue out per object, and knows when a role is as it started', () => {
    expect(groupCatalogue([sales])).toEqual([
      {
        module: 'sales',
        label: 'sales',
        objects: [
          { object: 'view', actions: [{ key: 'sales.view', action: 'Do' }] },
          { object: 'margin.view', actions: [{ key: 'sales.margin.view', action: 'Do' }] },
          { object: 'return.edit', actions: [{ key: 'sales.return.edit', action: 'Do' }] },
        ],
      },
    ]);
    expect(isAsStarter(['b', 'a'], ['a', 'b'], { customers: true, documents: true }, true)).toBe(true);
    expect(isAsStarter(['a'], ['a', 'b'], { customers: true, documents: true }, true)).toBe(false);
    expect(isAsStarter(['a', 'b'], ['a', 'b'], { customers: true, documents: false }, true)).toBe(false);
  });
});
