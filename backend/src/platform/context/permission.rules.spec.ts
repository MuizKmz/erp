import { catalogueError, hasPermission, permissionsOf, toRoleGrants, type ModulePermissions } from './permission.rules';
import { PermissionRegistry } from './permission.registry';

const shop: ModulePermissions = {
  module: 'shop',
  label: 'Shop',
  viewKey: 'shop.view',
  permissions: [
    { key: 'shop.view', object: 'Shop', action: 'View' },
    { key: 'shop.order.edit', object: 'Order', action: 'Edit' },
  ],
  starterGrants: { CLERK: ['shop.view', 'shop.order.edit'], VIEWER: ['shop.view'] },
};

describe('role grants', () => {
  const grants = toRoleGrants({ CLERK: ['shop.view', 'shop.order.edit'] }, { VIEWER: ['shop.view'], CLERK: ['shop.view'] });

  it('gives a user the sum of their roles, and Administrator everything', () => {
    expect(hasPermission(grants, ['VIEWER'], 'shop.order.edit')).toBe(false);
    expect(hasPermission(grants, ['VIEWER', 'CLERK'], 'shop.order.edit')).toBe(true);
    expect(hasPermission(grants, ['ADMIN'], 'anything.at.all')).toBe(true);
    expect(hasPermission(grants, [], 'shop.view')).toBe(false);
  });

  it('lists the permissions sorted and once, and ["*"] for Administrator', () => {
    expect(permissionsOf(grants, ['CLERK', 'VIEWER'])).toEqual(['shop.order.edit', 'shop.view']);
    expect(permissionsOf(grants, ['VIEWER', 'ADMIN'])).toEqual(['*']);
    expect(permissionsOf(grants, ['UNKNOWN'])).toEqual([]);
  });
});

describe('catalogueError', () => {
  it('accepts a module that declares its own keys and grants only those', () => {
    expect(catalogueError([], shop)).toBeNull();
  });

  it('refuses a second declaration, a foreign or doubled key, a missing label or view key, and grants of undeclared keys', () => {
    expect(catalogueError([shop], shop)).toBe('Permissions for "shop" are already declared');
    expect(catalogueError([], { ...shop, permissions: [...shop.permissions, { key: 'sales.view', object: 'Sales', action: 'View' }] })).toBe('sales.view does not start with "shop."');
    expect(catalogueError([], { ...shop, permissions: [...shop.permissions, shop.permissions[0]!] })).toBe('shop.view is declared twice');
    expect(catalogueError([], { ...shop, permissions: [{ key: 'shop.view', object: 'Shop', action: ' ' }] })).toBe('shop.view needs an object and an action label');
    expect(catalogueError([], { ...shop, viewKey: 'shop.look' })).toBe('The view permission shop.look is not in the "shop" catalogue');
    expect(catalogueError([], { ...shop, starterGrants: { CLERK: ['shop.order.release'] } })).toBe('CLERK is granted shop.order.release, which "shop" does not declare');
    expect(catalogueError([], { ...shop, starterGrants: { ADMIN: ['shop.view'] } })).toBe('ADMIN holds every permission already; it takes no starter grants');
  });
});

describe('PermissionRegistry', () => {
  function registryWith(rows: { role: string; permission: string }[]) {
    const findMany = jest.fn(async () => rows.map((r) => ({ permission: r.permission, role: { code: r.role } })));
    const registry = new PermissionRegistry({ sysRolePermission: { findMany } } as never);
    return { registry, findMany, rows };
  }

  it('reads the grants once, and again after a role change', async () => {
    const { registry, findMany, rows } = registryWith([{ role: 'CLERK', permission: 'shop.view' }]);
    await registry.refresh('t1');
    await registry.refresh('t1');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(registry.has(['CLERK'], 'shop.view')).toBe(true);
    expect(registry.has(['CLERK'], 'shop.order.edit')).toBe(false);

    rows.push({ role: 'CLERK', permission: 'shop.order.edit' });
    registry.invalidate();
    await registry.refresh('t1');
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(registry.permissionsFor(['CLERK'])).toEqual(['shop.order.edit', 'shop.view']);
  });

  it('does not count a load that started before a role change as fresh', async () => {
    const { registry, findMany } = registryWith([]);
    const first = registry.refresh('t1');
    registry.invalidate();
    await first;
    await registry.refresh('t1');
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
