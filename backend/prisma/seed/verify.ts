/**
 * After seeding, recompute the numbers the mockups show and compare. Also checks that header totals equal
 * their lines (totals.rules) and that PO running quantities agree with the receipts, returns and invoices.
 * The seed fails if any check fails.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Prisma } from '@prisma/client';
import { dec, toMoney } from '../../src/platform/http/decimal';
import { formatDocNo } from '../../src/platform/numbering/numbering.rules';
import { suggestPurchase } from '../../src/purchase/demand/demand.rules';
import { documentTotals } from '../../src/purchase/shared/totals.rules';
import type { SeedCtx } from './util';

interface Check {
  check: string;
  expected: string;
  actual: string;
  ok: boolean;
}

const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), dec(0));
/** JSON with object keys sorted, so {"DRAFT":1,"DONE":2} and {"DONE":2,"DRAFT":1} compare equal. */
const json = (v: unknown) =>
  JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );

function countBy<T extends string>(rows: { status: T }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export async function verifySeed(ctx: SeedCtx, uploadRoot: string): Promise<Check[]> {
  const { prisma, tenantId } = ctx;
  const where = { tenantId };
  const checks: Check[] = [];
  const expect = (check: string, expected: unknown, actual: unknown) => {
    const e = typeof expected === 'string' ? expected : json(expected);
    const a = typeof actual === 'string' ? actual : json(actual);
    checks.push({ check, expected: e, actual: a, ok: e === a });
  };

  // ── Purchase orders (PoList, PurHome, GrnList) ──
  const pos = await prisma.purPurchaseOrder.findMany({ where, include: { lines: true } });
  expect('PO count · total incl. tax', '11 · 96450.00', `${pos.length} · ${toMoney(sum(pos.map((p) => p.total)))}`);
  expect('PO status tabs', { DRAFT: 2, PENDING_APPROVAL: 1, RELEASED: 3, PARTIAL: 2, DONE: 3 }, countBy(pos));
  const waiting = pos
    .filter((p) => p.status === 'RELEASED' || p.status === 'PARTIAL')
    .map((p) => ({ p, open: sum(p.lines.map((l) => l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty))) }))
    .filter((x) => x.open.gt(0));
  expect('Waiting to be received · units', '5 · 163', `${waiting.length} · ${sum(waiting.map((x) => x.open)).toFixed(0)}`);

  // ── Requests, RFQs, receipts ──
  expect('Request tabs (9)', { DRAFT: 1, SUBMITTED: 1, CONVERTED: 6, REJECTED: 1 }, countBy(await prisma.purRequest.findMany({ where, select: { status: true } })));
  expect('RFQ tabs (6)', { WAITING: 2, AWARDED: 3, CLOSED: 1 }, countBy(await prisma.purRfq.findMany({ where, select: { status: true } })));
  const grns = await prisma.purGoodsReceipt.findMany({ where, select: { status: true } });
  expect('Goods receipts', '6', String(grns.length));

  // ── Invoices (PiList) ──
  const pis = await prisma.purInvoice.findMany({ where });
  expect('Invoice tabs (5)', { TO_MATCH: 1, PENDING_APPROVAL: 1, APPROVED: 2, REJECTED: 1 }, countBy(pis));
  expect('Invoices billed in September', '32982.00', toMoney(sum(pis.map((p) => p.total))));
  expect('Matched · waiting for Finance', '5434.00', toMoney(sum(pis.filter((p) => p.status === 'APPROVED').map((p) => p.total))));

  // ── Fixes and small buys ──
  expect('Cancel order tabs (5)', { DRAFT: 1, RELEASED: 4 }, countBy(await prisma.purCancelOrder.findMany({ where, select: { status: true } })));
  const cps = await prisma.purCashPurchase.findMany({ where });
  expect('Cash purchase tabs (5)', { DRAFT: 1, RELEASED: 4 }, countBy(cps));
  expect('Cash purchases in September · card · petty cash', '678.20 · 382.80 · 295.40', [
    toMoney(sum(cps.map((c) => c.total))),
    toMoney(sum(cps.filter((c) => c.paidBy === 'COMPANY_CARD').map((c) => c.total))),
    toMoney(sum(cps.filter((c) => c.paidBy === 'PETTY_CASH').map((c) => c.total))),
  ].join(' · '));
  const pdns = await prisma.purDebitNote.findMany({ where });
  expect('Debit notes · total', '{"DRAFT":1,"RELEASED":2} · 726.00', `${json(countBy(pdns))} · ${toMoney(sum(pdns.map((d) => d.total)))}`);
  const prts = await prisma.purReturn.findMany({ where, include: { lines: true } });
  expect('Returns · waiting for credit · units back', '{"RELEASED":1,"SETTLED":2} · 440.00 · 16', [
    json(countBy(prts)),
    toMoney(sum(prts.filter((r) => r.status === 'RELEASED').map((r) => r.total))),
    sum(prts.flatMap((r) => r.lines.map((l) => l.qty))).toFixed(0),
  ].join(' · '));

  // ── Approvals inbox (Ahmad Zaki) ──
  const waitingForAz = await prisma.sysApprovalRequest.findMany({
    where: { tenantId, status: 'PENDING', steps: { some: { status: 'WAITING', approverCode: 'AZ' } } },
    orderBy: { docNo: 'asc' },
  });
  expect('Waiting for Ahmad Zaki', 'PI-0002, PO-0003', waitingForAz.map((a) => a.docNo).join(', '));

  // ── Main case ──
  const po1 = pos.find((p) => p.docNo === 'PO-0001')!;
  const pi1 = pis.find((p) => p.docNo === 'PI-0001')!;
  const prt1 = prts.find((r) => r.docNo === 'PRT-0001')!;
  expect('Main case: PO-0001 · received · PI-0001 billed → recorded · PRT-0001', '4400.00 · 95 · 4400.00 → 4180.00 · 440.00', [
    toMoney(po1.total), po1.lines[0]!.receivedQty.toFixed(0), `${toMoney(pi1.billedTotal)} → ${toMoney(pi1.total)}`, toMoney(prt1.total),
  ].join(' · '));

  // ── Demand list (PurDemand) ──
  const items = await prisma.mdmItem.findMany({ where: { tenantId, isPurchasable: true, status: 'ACTIVE' } });
  const stock = await prisma.invStockSnapshot.findMany({ where });
  const sales = await prisma.salDemandStub.findMany({ where: { tenantId, kind: 'DIRECT' } });
  const history = await prisma.purPriceHistory.findMany({ where, orderBy: { docDate: 'desc' } });
  const openStatuses = new Set(['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL']);
  const toBuy: string[] = [];
  const covered: string[] = [];
  let estimate = dec(0);
  for (const it of items) {
    const onHand = sum(stock.filter((s) => s.itemCode === it.code).map((s) => s.onHand));
    const onOrder = sum(pos.filter((p) => openStatuses.has(p.status)).flatMap((p) => p.lines)
      .filter((l) => l.itemCode === it.code).map((l) => l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty)));
    const salesNeed = sum(sales.filter((s) => s.itemCode === it.code).map((s) => s.qty));
    const r = suggestPurchase({ onHand, onOrder, reorderLevel: it.reorderLevel, salesNeed, packSize: it.packSize });
    if (r.status === 'NEEDS_BUYING') {
      toBuy.push(`${it.code} ${r.suggestedQty.toFixed(0)}`);
      const lastPrice = history.find((h) => h.itemCode === it.code)?.unitPrice ?? dec(0);
      estimate = estimate.add(r.suggestedQty.mul(lastPrice));
    } else if (r.status === 'COVERED') {
      covered.push(it.code);
    }
  }
  expect('Demand: items to buy', 'CH-DIN-01 90, SC-WOD-08 20, TB-DIN-06 31, VR-LAC-01 8', toBuy.sort().join(', '));
  expect('Demand: estimated value', '40040.00', toMoney(estimate));
  checks.push({
    check: 'Demand: already covered (mockup lists 3: FB-OAK-01, FM-SEA-05, SF-CUS-03)',
    expected: 'info', actual: covered.sort().join(', '), ok: true,
  });

  // ── Numbering ──
  const seqs = await prisma.sysNumberSequence.findMany({ where, orderBy: { docType: 'asc' } });
  expect('Next numbers', 'CP-0003 GRN-0004 PCO-0002 PDN-0002 PI-0004 PO-0007 PRQ-0007 PRT-0002 RFQ-0005',
    seqs.map((s) => formatDocNo(s.prefix, s.digits, s.nextValue)).join(' '));

  // ── Integrity: header totals = sum of lines ──
  const mismatches: string[] = [];
  const compare = (docNo: string, header: { subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; total: Prisma.Decimal }, lines: { amount: Prisma.Decimal; taxAmount: Prisma.Decimal }[]) => {
    const t = documentTotals(lines);
    if (!t.subtotal.eq(header.subtotal) || !t.taxTotal.eq(header.taxTotal) || !t.total.eq(header.total)) mismatches.push(docNo);
  };
  for (const p of pos) compare(p.docNo, p, p.lines);
  for (const p of await prisma.purInvoice.findMany({ where, include: { lines: true } })) compare(p.docNo, p, p.lines);
  for (const c of await prisma.purCashPurchase.findMany({ where, include: { lines: true } })) compare(c.docNo, c, c.lines);
  for (const d of await prisma.purDebitNote.findMany({ where, include: { lines: true } })) compare(d.docNo, d, d.lines);
  for (const r of prts) compare(r.docNo, r, r.lines);
  expect('Header totals = sum of lines (PO, PI, CP, PDN, PRT)', 'all match', mismatches.length ? mismatches.join(', ') : 'all match');

  // ── Integrity: PO running quantities agree with the documents ──
  const qtyIssues: string[] = [];
  const grnLines = await prisma.purGoodsReceiptLine.findMany({ where: { tenantId, grn: { status: 'CONFIRMED' } } });
  const returnLines = await prisma.purReturnLine.findMany({ where: { tenantId, purReturn: { status: { in: ['RELEASED', 'SETTLED'] } } } });
  const billedLines = await prisma.purInvoiceLine.findMany({ where: { tenantId, invoice: { status: { in: ['APPROVED', 'PAID'] } } } });
  for (const p of pos) {
    for (const l of p.lines) {
      const received = sum(grnLines.filter((g) => g.poLineId === l.id).map((g) => g.receivedQty));
      const returned = sum(returnLines.filter((r) => r.poLineId === l.id).map((r) => r.qty));
      const billed = sum(billedLines.filter((b) => b.poLineId === l.id).map((b) => b.qty));
      if (!received.eq(l.receivedQty)) qtyIssues.push(`${p.docNo} received ${l.receivedQty} vs GRNs ${received}`);
      if (!returned.eq(l.returnedQty)) qtyIssues.push(`${p.docNo} returned ${l.returnedQty} vs returns ${returned}`);
      // Migrated POs may carry billed balances from old-system invoices that are not in the seed.
      if (!p.isMigrated && !billed.eq(l.billedQty)) qtyIssues.push(`${p.docNo} billed ${l.billedQty} vs invoices ${billed}`);
      if (l.receivedQty.add(l.cancelledQty).gt(l.orderedQty)) qtyIssues.push(`${p.docNo} received more than ordered`);
    }
  }
  expect('PO running quantities = receipts, returns, invoices', 'all agree', qtyIssues.length ? qtyIssues.join('; ') : 'all agree');

  // ── Outbox and attachments ──
  const events = await prisma.sysOutbox.findMany({ where, select: { name: true, status: true } });
  expect('Outbox events waiting (no module connected yet)', '13 PENDING', `${events.filter((e) => e.status === 'PENDING').length} ${events.every((e) => e.status === 'PENDING') ? 'PENDING' : 'mixed'}`);
  const files = await prisma.sysAttachment.findMany({ where });
  const missing = files.filter((f) => !existsSync(path.join(uploadRoot, ...f.storageKey.split('/'))));
  expect('Attachments with a file on disk', '15 / 15', `${files.length - missing.length} / ${files.length}`);

  return checks;
}
