import type { MdmCustomer, MdmItem, MdmSupplier, MdmTaxCode, MdmUser, MdmWarehouse, PrismaClient } from '@prisma/client';
import { dec, type DecimalInput } from '../../src/platform/http/decimal';
import { documentTotals, lineTotals, type LineTotals } from '../../src/purchase/shared/totals.rules';

/** Fixed id so logs, tests and docs can refer to the one tenant. */
export const TENANT_ID = '00000000-0000-4000-8000-000000000001';

/** Everything the seed steps share: the client, the tenant and lookups by business code. */
export interface SeedCtx {
  prisma: PrismaClient;
  tenantId: string;
  users: Map<string, MdmUser>;
  items: Map<string, MdmItem>;
  suppliers: Map<string, MdmSupplier>;
  taxes: Map<string, MdmTaxCode>;
  warehouses: Map<string, MdmWarehouse>;
  customers: Map<string, MdmCustomer>;
  /** docNo → id and entity type of every seeded document, for links, activity and approvals. */
  docs: Map<string, { id: string; type: string }>;
}

/** A calendar date (DATE column): day('2026-09-29'). */
/** A reseed puts a seeded master-data row back as it was, whatever Core or an e2e journey changed on it. */
export const AS_SEEDED = { version: 1, updatedBy: null } as const;

export function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** A moment in Malaysia time, stored as UTC: kl('2026-09-23', '11:02') → 03:02Z. */
export function kl(isoDate: string, time = '09:00'): Date {
  return new Date(`${isoDate}T${time}:00.000+08:00`);
}

function must<T>(map: Map<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (!value) throw new Error(`Seed: unknown ${what} "${key}"`);
  return value;
}

export const user = (ctx: SeedCtx, code: string) => must(ctx.users, code, 'user');
export const item = (ctx: SeedCtx, code: string) => must(ctx.items, code, 'item');
export const supplier = (ctx: SeedCtx, code: string) => must(ctx.suppliers, code, 'supplier');
export const warehouse = (ctx: SeedCtx, code: string) => must(ctx.warehouses, code, 'warehouse');
export const doc = (ctx: SeedCtx, docNo: string) => must(ctx.docs, docNo, 'document');
export const customer = (ctx: SeedCtx, code: string) => must(ctx.customers, code, 'customer');

/** Display name of a user code, including the system user. */
export function nameOf(ctx: SeedCtx, code: string): string {
  return code === 'SYSTEM' ? 'System' : user(ctx, code).name;
}

/** Item reference + snapshot for a document line. `taxCode` overrides the item's purchase tax code. */
export function snapshot(ctx: SeedCtx, itemCode: string, taxCode?: string) {
  const it = item(ctx, itemCode);
  const tax = must(ctx.taxes, taxCode ?? it.purchaseTaxCode, 'tax code');
  return {
    itemId: it.id,
    itemCode: it.code,
    itemName: it.name,
    uomCode: it.purchaseUom ?? it.baseUom,
    taxCode: tax.code,
    taxRate: tax.rate,
  };
}

/** Snapshot plus price, quantity and the rounded amount and tax (totals.rules). */
export function pricedLine(ctx: SeedCtx, itemCode: string, qty: DecimalInput, unitPrice: DecimalInput, taxCode?: string) {
  const snap = snapshot(ctx, itemCode, taxCode);
  const totals = lineTotals({ qty, unitPrice, taxRate: snap.taxRate });
  return { ...snap, qty: dec(qty), unitPrice: dec(unitPrice), ...totals };
}

/** Header subtotal / taxTotal / total from lines. */
export function headerTotals(lines: LineTotals[]) {
  return documentTotals(lines);
}

/** createdAt/By and updatedAt/By for a document. */
export function audit(by: string, at: Date, updatedAt?: Date) {
  return { createdBy: by, createdAt: at, updatedBy: by, updatedAt: updatedAt ?? at };
}

/** Records a seeded document so later steps can link to it by number. */
export function remember(ctx: SeedCtx, docNo: string, type: string, id: string): void {
  ctx.docs.set(docNo, { id, type });
}

/**
 * A small valid one-page PDF with a title line, used as a stand-in for supplier letters, quotes and invoices.
 * Built by hand so the seed needs no PDF library; the xref offsets are computed.
 */
export function placeholderPdf(title: string): Buffer {
  const safe = title.replace(/[()\\]/g, '');
  const content = `BT /F1 20 Tf 72 760 Td (${safe}) Tj 0 -30 Td /F1 12 Tf (Sample document - Zora Pro ERP demo seed data) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
