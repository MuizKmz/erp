import { CORE_ROLE_GRANTS } from '../src/core/core.permissions';
import { PermissionRegistry } from '../src/platform/context/permission.registry';
import { permissionsOf, toRoleGrants } from '../src/platform/context/permission.rules';
import { PURCHASE_ROLE_GRANTS } from '../src/purchase/purchase.permissions';
import { SALES_ROLE_GRANTS } from '../src/sales/sales.permissions';
import { TENANT_ID } from '../prisma/seed/util';
import { reseed, startApi, type Api } from './e2e-helpers';

interface Me {
  user: { code: string; roles: string[]; branchCodes: string[] };
  branchCode: string;
  permissions: string[];
}

/**
 * Configuration module journeys (CLAUDE.md → Phase 4), against the API on fresh demo data. Each build step adds its
 * journey here; A1 checks the module is open, the home's numbers, that users and roles moved without changing what
 * anybody can do, and that a role change applies on the next request.
 */
describe('Configuration (end to end)', () => {
  let api: Api;
  const USERS = ['ADM', 'AZ', 'AR', 'FO', 'HAF', 'LMY', 'LWJ', 'NA', 'NUR', 'RAH', 'RI', 'SIT', 'SC1', 'TWL'];

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  describe('A1 · Module, schema and shell', () => {
    it('opens Configuration from the launcher', async () => {
      const modules = await api.get<{ items: { code: string; state: string; route: string | null }[] }>('me/modules', 'LMY');
      expect(modules.items.find((m) => m.code === 'config')).toMatchObject({ state: 'OPEN', route: '/config' });
    });

    it('shows the A01 numbers and what needs attention, to the Administrator only', async () => {
      const home = await api.get<{ cards: { key: string; value: string; sub: string }[]; attention: { key: string; lead: string; text: string; to: string }[]; security: unknown[] }>(
        'config/dashboard',
      );
      expect(home.cards.map((c) => `${c.key} ${c.value} · ${c.sub}`)).toEqual([
        'companies 1 · CLB Groups Sdn Bhd',
        'branches 2 · HQ Shah Alam · Penang Branch',
        'users 14 · 14 active · 0 locked',
        'roles 16 · 16 starter roles · 0 custom',
        'sessions 0 · Sessions on any device',
        'two-factor 0 of 2 · users who must use it have set it up',
        'failed 0 · in the last 24 hours',
        'permissions 54 · declared by Purchase, Sales, Core and Configuration',
      ]);
      expect(home.attention.map((a) => a.lead)).toEqual(['2 users', 'Auditor', 'Company']);
      expect(home.attention[0]!.text).toContain(': Admin, Rosnah Ismail.');
      expect(home.attention[2]!.text).toBe('has demo values for its TIN and registration number. Replace them before the first real e-Invoice.');
      expect(home.security).toEqual([]);

      const denied = await api.call('GET', 'config/dashboard', 'LMY');
      expect(denied.status).toBe(403);
    });

    it('leaves every user able to do exactly what the code grants allowed before', async () => {
      const fromCode = toRoleGrants(PURCHASE_ROLE_GRANTS, SALES_ROLE_GRANTS, CORE_ROLE_GRANTS);
      for (const code of USERS) {
        const me = await api.get<Me>('me', code);
        expect({ code, permissions: me.permissions }).toEqual({ code, permissions: permissionsOf(fromCode, me.user.roles) });
      }
      const lmy = await api.get<Me>('me', 'LMY');
      expect(lmy.user).toMatchObject({ roles: ['PURCHASE_BUYER', 'AP_CLERK'], branchCodes: ['HQ', 'PNG'] });
      expect(lmy.branchCode).toBe('HQ');
      expect((await api.get<Me>('me', 'TWL')).branchCode).toBe('PNG');
    });

    it('keeps Core reading branches and sales agents, now through the port', async () => {
      const form = await api.get<{ branches: { code: string }[]; agents: { code: string }[] }>('core/lookups/customer-form');
      expect(form.branches.map((b) => b.code)).toEqual(['HQ', 'PNG']);
      expect(form.agents.map((a) => a.code)).toEqual(['AR', 'FO', 'LWJ']);
    });

    it('applies a role change on the next request, and stops an expired role on the day after its last day', async () => {
      const prisma = api.prisma;
      const buyer = await prisma.sysRole.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'PURCHASE_BUYER' } });
      await prisma.sysRolePermission.deleteMany({ where: { roleId: buyer.id, permission: 'purchase.order.release' } });
      api.app.get(PermissionRegistry).invalidate(); // what the role editor (A4) does after saving
      expect((await api.get<Me>('me', 'LMY')).permissions).not.toContain('purchase.order.release');
      await prisma.sysRolePermission.create({ data: { tenantId: TENANT_ID, roleId: buyer.id, permission: 'purchase.order.release' } });
      api.app.get(PermissionRegistry).invalidate();
      expect((await api.get<Me>('me', 'LMY')).permissions).toContain('purchase.order.release');

      // Today in the demo is 29 Sep 2026.
      const ri = await prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'RI' } });
      const finance = await prisma.sysRole.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'FINANCE_MANAGER' } });
      const assignment = { userId_roleId: { userId: ri.id, roleId: finance.id } };
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: new Date('2026-09-29T00:00:00.000Z') } });
      expect((await api.get<Me>('me', 'RI')).user.roles).toEqual(['FINANCE_DIRECTOR', 'FINANCE_MANAGER']);
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: new Date('2026-09-28T00:00:00.000Z') } });
      const after = await api.get<Me>('me', 'RI');
      expect(after.user.roles).toEqual(['FINANCE_DIRECTOR']);
      expect(after.permissions).not.toContain('core.customer.credit');
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: null } });
    });

    it('stamps the request on the activity it writes, so the audit trail can group a change', async () => {
      const base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
      const correlationId = '7d3c1e9a-4b2f-4c8e-9a51-0e6f2b7d8c41';
      const res = await fetch(`${base}/core/reference/areas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-user': 'ADM', 'x-correlation-id': correlationId },
        body: JSON.stringify({ name: 'Southern' }),
      });
      expect(res.status).toBe(201);
      const rows = await api.prisma.sysActivity.findMany({ where: { tenantId: TENANT_ID, correlationId } });
      expect(rows.map((r) => r.message)).toEqual([expect.stringContaining('Southern')]);
    });
  });
});
