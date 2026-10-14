/**
 * Core seed checks (CLAUDE.md → Phase 3, docs/design/CORE_SEED_DATA.md). Core adds no demo documents: it takes over
 * the master data the Purchase and Sales seeds already load, so these checks cover what Core itself sets up, and the
 * numbers the Core home (C01) shows, computed by the same query the screen uses.
 */
import { CoreDashboardQuery } from '../../src/core/dashboard/dashboard.query';
import { latestValidByKey } from '../../src/master-data/master-data.rules';
import type { ClockService } from '../../src/platform/clock/clock.service';
import type { RequestContext } from '../../src/platform/context/request-context';
import { formatDocNo } from '../../src/platform/numbering/numbering.rules';
import type { PrismaService } from '../../src/platform/prisma/prisma.service';
import { day, type SeedCtx } from './util';
import type { Check } from './verify';

const TODAY = '2026-09-29';

export async function verifyCoreSeed(ctx: SeedCtx): Promise<Check[]> {
  const { prisma, tenantId } = ctx;
  const checks: Check[] = [];
  const expect = (check: string, expected: string, actual: string) => checks.push({ check: `Core · ${check}`, expected, actual, ok: expected === actual });

  const seqs = await prisma.sysNumberSequence.findMany({ where: { tenantId, module: 'core' }, orderBy: { docType: 'asc' } });
  expect('Next customer and supplier codes', 'C-0103 S-0072', seqs.map((s) => formatDocNo(s.prefix, s.digits, s.nextValue)).join(' '));

  const admin = await prisma.mdmUser.findFirst({ where: { tenantId, code: 'ADM' }, select: { roles: true } });
  expect('Admin is the Master Data Admin', 'yes', (admin?.roles as string[] | undefined)?.includes('MASTER_DATA_ADMIN') ? 'yes' : 'no');

  const [groups, categories, areas, terms] = await Promise.all([
    prisma.mdmItemGroup.count({ where: { tenantId, isActive: true } }),
    prisma.mdmCustomerCategory.count({ where: { tenantId, isActive: true } }),
    prisma.mdmArea.count({ where: { tenantId, isActive: true } }),
    prisma.mdmCreditTerm.findMany({ where: { tenantId, isActive: true }, orderBy: { days: 'asc' } }),
  ]);
  expect('Reference lists (item groups · categories · areas · credit terms)', '19 · 6 · 2 · Cash, 30 days', `${groups} · ${categories} · ${areas} · ${terms.map((t) => t.name).join(', ')}`);

  const taxes = await prisma.mdmTaxCode.findMany({ where: { tenantId }, orderBy: [{ code: 'asc' }, { validFrom: 'asc' }] });
  expect('Tax codes and their type', 'EXEMPT EXEMPT · SST10 SALES_TAX · SVC8 SERVICE_TAX', [...new Map(taxes.map((t) => [t.code, `${t.code} ${t.type}`])).values()].join(' · '));
  expect(
    'Tax rates valid on 29 Sep 2026',
    'EXEMPT 0.0000 · SST10 0.1000 · SVC8 0.0800',
    latestValidByKey(taxes, (t) => t.code, day(TODAY)).map((t) => `${t.code} ${t.rate.toFixed(4)}`).join(' · '),
  );

  const prices = await prisma.mdmPriceListItem.findMany({ where: { tenantId }, select: { validFrom: true } });
  expect('Prices, all valid from 1 Jan 2026', '23 · 2026-01-01', `${prices.length} · ${[...new Set(prices.map((p) => p.validFrom.toISOString().slice(0, 10)))].join(' ')}`);

  const [brnCustomers, brnSuppliers] = await Promise.all([
    prisma.mdmCustomer.count({ where: { tenantId, idType: 'BRN' } }),
    prisma.mdmSupplier.count({ where: { tenantId, idType: 'BRN' } }),
  ]);
  expect('ID type BRN (customers · suppliers)', '6 · 10', `${brnCustomers} · ${brnSuppliers}`);

  // What Core or an e2e journey changed on a seeded record goes back on every reseed.
  const changed = { tenantId, OR: [{ version: { not: 1 } }, { updatedBy: { not: null } }] };
  const leftovers = await Promise.all([
    prisma.mdmItem.count({ where: changed }),
    prisma.mdmCustomer.count({ where: changed }),
    prisma.mdmSupplier.count({ where: changed }),
    prisma.mdmUom.count({ where: changed }),
    prisma.mdmTaxCode.count({ where: changed }),
    prisma.mdmPriceList.count({ where: changed }),
    prisma.mdmWarehouse.count({ where: changed }),
    prisma.mdmLocation.count({ where: changed }),
  ]);
  expect('Master data as seeded (rows changed since the seed)', '0', String(leftovers.reduce((a, b) => a + b, 0)));

  // C01 Needs attention, from the screen's own query.
  const clock = { todayDate: () => day(TODAY) } as ClockService;
  const home = await new CoreDashboardQuery(prisma as PrismaService, clock).summary({ tenantId } as RequestContext);
  expect(
    'Needs attention on the Core home',
    '39 items · 8 suppliers · 6 customers · 3 purchasable items · Item groups “Service” and “Services”',
    home.attention.map((a) => (a.key.startsWith('look-alike') ? `${a.lead} ${a.text.replace(' look like the same group.', '')}` : a.lead)).join(' · '),
  );
  expect('Core home cards (items · customers · suppliers · tax codes)', '39 · 7 · 10 · 3', ['items', 'customers', 'suppliers', 'tax-codes'].map((k) => home.cards.find((c) => c.key === k)?.total).join(' · '));
  return checks;
}
