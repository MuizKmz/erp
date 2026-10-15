/**
 * Configuration seed checks (CLAUDE.md → Phase 4, docs/design/CONFIG_SEED_DATA.md). Configuration adds no people: it
 * takes over the users and branches the Purchase and Sales seeds load, and turns the code grants into roles. These
 * checks prove nobody can do more or less than before, that MasterDataPort gives the same answers, and the numbers
 * the Configuration home (A01) shows, computed by the screen's own query.
 */
import { ConfigDashboardQuery } from '../../src/configuration/dashboard/dashboard.query';
import { CORE_ROLE_GRANTS } from '../../src/core/core.permissions';
import { PrismaMasterDataAdapter } from '../../src/master-data/prisma-master-data.adapter';
import type { ClockService } from '../../src/platform/clock/clock.service';
import { PermissionCatalogue } from '../../src/platform/context/permission-catalogue';
import { permissionsOf, toRoleGrants } from '../../src/platform/context/permission.rules';
import type { RequestContext } from '../../src/platform/context/request-context';
import type { PrismaService } from '../../src/platform/prisma/prisma.service';
import { PURCHASE_ROLE_GRANTS } from '../../src/purchase/purchase.permissions';
import { SALES_ROLE_GRANTS } from '../../src/sales/sales.permissions';
import { CATALOGUE, SEEDED_USERS } from './configuration';
import { day, kl, type SeedCtx } from './util';
import type { Check } from './verify';

const TODAY = '2026-09-29';

export async function verifyConfigSeed(ctx: SeedCtx): Promise<Check[]> {
  const { prisma, tenantId } = ctx;
  const checks: Check[] = [];
  const expect = (check: string, expected: string, actual: string) => checks.push({ check: `Configuration · ${check}`, expected, actual, ok: expected === actual });

  expect(
    'Permission catalogue (per module · total)',
    'Purchase 17 · Sales 19 · Core 11 · Configuration 7 · 54',
    [...CATALOGUE.map((m) => `${m.label} ${m.permissions.length}`), String(CATALOGUE.reduce((n, m) => n + m.permissions.length, 0))].join(' · '),
  );

  const roles = await prisma.sysRole.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
    select: { code: true, name: true, agentScopeCustomers: true, _count: { select: { users: true, permissions: true } } },
  });
  expect(
    'Starter roles (users / permissions; ADMIN holds all 54 without rows)',
    'Administrator 1/0, AP clerk 1/4, Auditor 0/6, Billing 3/6, Branch Manager 1/2, Buyer 1/16, Counter staff 1/3, Finance Director 1/2, Finance Manager 1/3, ' +
      'Master Data Admin 1/11, Purchasing Manager 1/13, Requester 4/4, Sales agent 3/9, Sales Manager 1/10, Sales store 2/5, Store 2/7',
    roles.map((r) => `${r.name} ${r._count.users}/${r._count.permissions}`).join(', '),
  );
  expect('Agent-scoped roles', 'SALES_AGENT', roles.filter((r) => r.agentScopeCustomers).map((r) => r.code).join(', '));

  // Nobody can do more or less than with the grants in code: every user's permissions from the roles in the database.
  const adapter = new PrismaMasterDataAdapter(prisma as PrismaService, { todayDate: () => day(TODAY) } as ClockService);
  const users = await adapter.listUsers(tenantId);
  const rows = await prisma.sysRolePermission.findMany({ where: { tenantId }, select: { permission: true, role: { select: { code: true } } } });
  const fromDb = toRoleGrants(Object.fromEntries(roles.map((r) => [r.code, rows.filter((x) => x.role.code === r.code).map((x) => x.permission)])));
  const fromCode = toRoleGrants(PURCHASE_ROLE_GRANTS, SALES_ROLE_GRANTS, CORE_ROLE_GRANTS);
  const same = users.filter((u) => permissionsOf(fromDb, u.roles).join() === permissionsOf(fromCode, u.roles).join());
  expect('Users who can do exactly what the code grants gave them', '14 of 14', `${same.length} of ${users.length}`);

  // MasterDataPort answers as it did from mdm_user: the same roles in the same order, the default branch first.
  const seeded = new Map(SEEDED_USERS.map((u) => [u.code, `${u.roles.join('+')} @ ${u.branchCodes.join('+')}`]));
  const answered = users.filter((u) => u.isActive && seeded.get(u.code) === `${u.roles.join('+')} @ ${u.branchCodes.join('+')}`);
  expect('Users the port answers as before (roles · branches)', '14 of 14', `${answered.length} of ${seeded.size}`);

  const branches = await prisma.sysBranch.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, select: { code: true, legalEntity: { select: { code: true } }, _count: { select: { users: true } } } });
  expect('Branches (company · users)', 'HQ CLB 12, PNG CLB 9', branches.map((b) => `${b.code} ${b.legalEntity.code} ${b._count.users}`).join(', '));

  // A01 from the screen's own query, at 10:15 on 29 Sep 2026.
  const catalogue = new PermissionCatalogue();
  for (const m of CATALOGUE) catalogue.register(m);
  const clock = { todayDate: () => day(TODAY), now: () => kl(TODAY, '10:15') } as ClockService;
  const home = await new ConfigDashboardQuery(prisma as PrismaService, clock, catalogue).summary({ tenantId } as RequestContext);
  expect(
    'Configuration home cards',
    'Companies 1 · Branches 2 · Users 14 · Roles 16 · Signed in now 0 · Two-factor 0 of 2 · Failed sign-ins 0 · Permissions 54',
    home.cards.map((c) => `${c.label} ${c.value}`).join(' · '),
  );
  expect(
    'Needs attention on the Configuration home',
    '2 users (Admin, Rosnah Ismail) · Auditor · Company',
    home.attention.map((a) => (a.key === 'two-factor' ? `${a.lead} (${a.text.slice(a.text.indexOf(': ') + 2, a.text.indexOf('. '))})` : a.lead)).join(' · '),
  );
  return checks;
}
