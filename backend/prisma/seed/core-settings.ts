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

/** "Cash" for 0 days, else "30 days". */
export function creditTermName(days: number): string {
  return days === 0 ? 'Cash' : `${days} days`;
}

/**
 * Reference lists (CORE_SEED_DATA.md → Reference lists): filled from the values the seeded records use, so every
 * item group, customer category, area and credit term in use is an active entry. "Service" and "Services" both stay
 * (choice 1).
 */
export async function seedCoreReferenceLists(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;
  const [items, customers] = await Promise.all([
    prisma.mdmItem.findMany({ where: { tenantId }, select: { itemGroup: true } }),
    prisma.mdmCustomer.findMany({ where: { tenantId }, select: { category: true, area: true, creditTermDays: true } }),
  ]);
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v && !!v.trim()))].sort();
  for (const name of distinct(items.map((i) => i.itemGroup))) {
    await prisma.mdmItemGroup.upsert({ where: { tenantId_name: { tenantId, name } }, update: { isActive: true }, create: { tenantId, name } });
  }
  for (const name of distinct(customers.map((c) => c.category))) {
    await prisma.mdmCustomerCategory.upsert({ where: { tenantId_name: { tenantId, name } }, update: { isActive: true }, create: { tenantId, name } });
  }
  for (const name of distinct(customers.map((c) => c.area))) {
    await prisma.mdmArea.upsert({ where: { tenantId_name: { tenantId, name } }, update: { isActive: true }, create: { tenantId, name } });
  }
  for (const days of [...new Set(customers.map((c) => c.creditTermDays))].sort((a, b) => a - b)) {
    const name = creditTermName(days);
    await prisma.mdmCreditTerm.upsert({ where: { tenantId_days: { tenantId, days } }, update: { name, isActive: true }, create: { tenantId, name, days } });
  }
}
