/**
 * Core seed checks (CLAUDE.md → Phase 3). Core adds no demo documents: it takes over the master data the Purchase
 * and Sales seeds already load, so these checks cover what Core itself sets up.
 */
import { formatDocNo } from '../../src/platform/numbering/numbering.rules';
import type { SeedCtx } from './util';
import type { Check } from './verify';

export async function verifyCoreSeed(ctx: SeedCtx): Promise<Check[]> {
  const { prisma, tenantId } = ctx;
  const checks: Check[] = [];
  const expect = (check: string, expected: string, actual: string) => checks.push({ check: `Core · ${check}`, expected, actual, ok: expected === actual });

  const seqs = await prisma.sysNumberSequence.findMany({ where: { tenantId, module: 'core' }, orderBy: { docType: 'asc' } });
  expect('Next customer and supplier codes', 'C-0103 S-0072', seqs.map((s) => formatDocNo(s.prefix, s.digits, s.nextValue)).join(' '));

  const admin = await prisma.mdmUser.findFirst({ where: { tenantId, code: 'ADM' }, select: { roles: true } });
  expect('Admin is the Master Data Admin', 'yes', (admin?.roles as string[] | undefined)?.includes('MASTER_DATA_ADMIN') ? 'yes' : 'no');

  const [items, customers, suppliers] = await Promise.all([
    prisma.mdmItem.count({ where: { tenantId } }),
    prisma.mdmCustomer.count({ where: { tenantId } }),
    prisma.mdmSupplier.count({ where: { tenantId } }),
  ]);
  checks.push({ check: 'Core · Records Core now maintains (items · customers · suppliers)', expected: 'info', actual: `${items} · ${customers} · ${suppliers}`, ok: true });
  return checks;
}
