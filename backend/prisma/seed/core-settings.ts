/**
 * Core settings (CLAUDE.md → Phase 3): customer and supplier numbering. Codes continue after the highest seeded
 * one, so the first customer Core creates is C-0103 and the first supplier S-0072. Other Core codes are typed.
 */
import type { SeedCtx } from './util';

/** 1 + the highest running number among codes like "C-0102" (codes such as C-CASH are skipped). */
export function nextAfter(codes: string[], prefix: string): number {
  const numbers = codes.map((c) => (c.startsWith(prefix) ? Number(c.slice(prefix.length)) : NaN)).filter((n) => Number.isInteger(n));
  return Math.max(0, ...numbers) + 1;
}

export async function seedCoreSettings(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;
  const [customers, suppliers] = await Promise.all([
    prisma.mdmCustomer.findMany({ where: { tenantId }, select: { code: true } }),
    prisma.mdmSupplier.findMany({ where: { tenantId }, select: { code: true } }),
  ]);
  const sequences = [
    { docType: 'CUSTOMER', name: 'Customer', prefix: 'C-', next: nextAfter(customers.map((c) => c.code), 'C-') },
    { docType: 'SUPPLIER', name: 'Supplier', prefix: 'S-', next: nextAfter(suppliers.map((s) => s.code), 'S-') },
  ];
  for (const s of sequences) {
    const data = { module: 'core', name: s.name, prefix: s.prefix, digits: 4, nextValue: s.next, format: null, resetEvery: 'NEVER', periodKey: null, perBranch: false };
    await prisma.sysNumberSequence.upsert({
      where: { tenantId_docType: { tenantId, docType: s.docType } },
      update: data,
      create: { tenantId, docType: s.docType, ...data },
    });
  }
}
