/**
 * After seeding Sales, recompute the numbers the Sales mockups show (SALES_SEED_DATA.md) and compare.
 * Also checks that header totals equal their lines and that SO running quantities agree with the
 * deliveries, invoices, returns and cancellations. The seed fails if any check fails.
 */
import type { Prisma } from '@prisma/client';
import { dec, toMoney } from '../../src/platform/http/decimal';
import { formatDocNo, formatPattern, nextInSequence } from '../../src/platform/numbering/numbering.rules';
import { invoiceBalance, saleTotals, type TaxMode } from '../../src/sales/shared/totals.rules';
import { SEEDED_LISTENERS } from './event-history';
import type { Check } from './verify';
import type { SeedCtx } from './util';

const TODAY = '2026-09-29';
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), dec(0));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const json = (v: unknown) =>
  JSON.stringify(v, (_k, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
function countBy(rows: { status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export async function verifySalesSeed(ctx: SeedCtx): Promise<Check[]> {
  const { prisma, tenantId } = ctx;
  const where = { tenantId };
  const checks: Check[] = [];
  const expect = (check: string, expected: unknown, actual: unknown) => {
    const e = typeof expected === 'string' ? expected : json(expected);
    const a = typeof actual === 'string' ? actual : json(actual);
    checks.push({ check: `Sales · ${check}`, expected: e, actual: a, ok: e === a });
  };

  // ── Invoices and what customers owe (S17, S02, S29) ──
  const invoices = await prisma.salInvoice.findMany({ where, include: { lines: true } });
  const receipts = await prisma.finReceiptStub.findMany({ where });
  const paid = (no: string) => sum(receipts.filter((r) => r.appliesToNo === no).map((r) => r.amount));
  const open = invoices
    .filter((v) => v.status === 'RELEASED')
    .map((v) => ({ v, balance: invoiceBalance({ total: v.total, debited: v.debitedAmount, credited: v.creditedAmount, deposit: v.depositApplied, paid: paid(v.docNo) }) }))
    .filter((x) => x.balance.gt(0));
  const overdue = open.filter((x) => x.v.dueDate && iso(x.v.dueDate)! < TODAY);
  expect('Invoices · draft or pending · released', '31 · 1 · 30', `${invoices.length} · ${invoices.filter((v) => v.status !== 'RELEASED').length} · ${invoices.filter((v) => v.status === 'RELEASED').length}`);
  expect('Unpaid invoices · balance due', '14 · 84640.00', `${open.length} · ${toMoney(sum(open.map((x) => x.balance)))}`);
  expect('Overdue invoices · customers · amount', '6 · 5 · 36900.00', `${overdue.length} · ${new Set(overdue.map((x) => x.v.customerCode)).size} · ${toMoney(sum(overdue.map((x) => x.balance)))}`);
  const balanceOf = (no: string) => toMoney(open.find((x) => x.v.docNo === no)?.balance ?? 0);
  expect('INV-0001 · INV-0002 balance due', '15125.00 · 6545.00', `${balanceOf('INV-0001')} · ${balanceOf('INV-0002')}`);
  const owed = (code: string) => sum(open.filter((x) => x.v.customerCode === code).map((x) => x.balance));
  const overdueOf = (code: string) => sum(overdue.filter((x) => x.v.customerCode === code).map((x) => x.balance));
  expect('Owed by customer', { 'C-0012': '27125.00', 'C-0031': '18400.00', 'C-0045': '18000.00', 'C-0056': '11815.00', 'C-0078': '9300.00' },
    Object.fromEntries(['C-0012', 'C-0031', 'C-0045', 'C-0056', 'C-0078'].map((c) => [c, toMoney(owed(c))])));

  // ── Credit checks shown on S12 and S02 ──
  const customers = await prisma.mdmCustomer.findMany({ where });
  const limit = (code: string, field: 'creditLimit' | 'overdueLimit') => customers.find((c) => c.code === code)![field]!;
  const orders = await prisma.salSalesOrder.findMany({ where, include: { lines: true } });
  const so = (no: string) => orders.find((o) => o.docNo === no)!;
  expect('SO-0008 over credit limit by', '50778.00', toMoney(owed('C-0031').add(so('SO-0008').total).sub(limit('C-0031', 'creditLimit'))));
  expect('SO-0002 over credit · overdue limit by', '2400.00 · 2000.00',
    `${toMoney(owed('C-0045').add(so('SO-0002').total).sub(limit('C-0045', 'creditLimit')))} · ${toMoney(overdueOf('C-0045').sub(limit('C-0045', 'overdueLimit')))}`);
  expect('QT-0012 headroom note: owed + quotation − limit', '50778.00', toMoney(owed('C-0031').add('92378.00').sub(limit('C-0031', 'creditLimit'))));

  // ── Sales orders (S10, S05, S01) ──
  const newOrders = orders.filter((o) => !o.isMigrated);
  const september = newOrders.filter((o) => iso(o.docDate)!.startsWith('2026-09'));
  const septemberNos = new Set(september.map((o) => o.docNo));
  expect('Sales order tabs (18)', { DRAFT: 1, PENDING_APPROVAL: 2, RELEASED: 2, PARTIAL: 2, DONE: 10, CANCELLED: 1 }, countBy(orders));
  expect('September ordered · orders', '274098.00 · 8', `${toMoney(sum(september.map((o) => o.total)))} · ${september.length}`);
  expect('September invoiced (before returns)', '32890.00', toMoney(sum(invoices.filter((v) => v.salesOrderNo && septemberNos.has(v.salesOrderNo) && v.status === 'RELEASED').map((v) => v.total))));
  const byAgent = (code: string) => september.filter((o) => o.agentCode === code);
  expect('Ordered by agent', 'AR 3 134860.00 · LWJ 2 113498.00 · FO 3 25740.00',
    ['AR', 'LWJ', 'FO'].map((a) => `${a} ${byAgent(a).length} ${toMoney(sum(byAgent(a).map((o) => o.total)))}`).join(' · '));

  // ── Enquiries and quotations (S06, S08, S31) ──
  const enquiries = await prisma.salEnquiry.findMany({ where });
  expect('Enquiry tabs (24)', { NEW: 6, FORWARDED: 4, QUOTED: 11, LOST: 3 }, countBy(enquiries));
  const tally = (key: 'enquiryTypeCode' | 'sourceCode', onlyQuoted = false) => {
    const out: Record<string, number> = {};
    for (const e of enquiries) if (!onlyQuoted || e.quotationNo) out[e[key]] = (out[e[key]] ?? 0) + 1;
    return out;
  };
  expect('Enquiries by type', { BULK: 9, CUSTOM: 6, RESELLER: 4, OFFICE: 3, HOSPITALITY: 2 }, tally('enquiryTypeCode'));
  expect('Enquiries by source · became quotations', `${json({ PHONE: 7, EMAIL: 6, WEBSITE: 5, WALKIN: 4, REFERRAL: 2 })} · ${json({ PHONE: 5, EMAIL: 4, WEBSITE: 2, WALKIN: 1 })}`,
    `${json(tally('sourceCode'))} · ${json(tally('sourceCode', true))}`);
  const quotes = await prisma.salQuotation.findMany({ where, include: { lines: true } });
  const latest = [...new Map(quotes.sort((a, b) => a.revision - b.revision).map((q) => [q.docNo, q])).values()];
  const expired = latest.filter((q) => q.status === 'RELEASED' && q.validUntil && iso(q.validUntil)! < TODAY);
  expect('Quotations (14) by status · expired', `${json({ DRAFT: 4, RELEASED: 3, ORDERED: 5, LOST: 2 })} · QT-0005`, `${json(countBy(latest))} · ${expired.map((q) => q.docNo).join(', ')}`);
  const soon = latest.filter((q) => q.status === 'RELEASED' && q.validUntil && iso(q.validUntil)! >= TODAY && iso(q.validUntil)! <= '2026-10-02');
  expect('Released quotations expiring within 3 days', 'QT-0004', soon.map((q) => q.docNo).join(', '));
  const qt12 = latest.find((q) => q.docNo === 'QT-0012')!;
  const qt12Net = qt12.subtotal.sub(qt12.discountTotal);
  expect('QT-0012 total · margin', '92378.00 · 28.6', `${toMoney(qt12.total)} · ${qt12Net.sub(qt12.costTotal!).div(qt12Net).mul(100).toFixed(1)}`);

  // ── Delivery (S15) ──
  const drafts = await prisma.salCancelOrder.findMany({ where: { tenantId, status: 'DRAFT' }, select: { salesOrderNo: true } });
  const beingCancelled = new Set(drafts.map((d) => d.salesOrderNo));
  const waiting = orders
    .filter((o) => (o.status === 'RELEASED' || o.status === 'PARTIAL') && !beingCancelled.has(o.docNo))
    .map((o) => ({ o, open: sum(o.lines.map((l) => l.orderedQty.sub(l.deliveredQty).sub(l.cancelledQty))) }))
    .filter((x) => x.open.gt(0));
  expect('Orders waiting to be delivered · units', 'SO-0001, SO-0003, SO-0007 · 84', `${waiting.map((x) => x.o.docNo).sort().join(', ')} · ${sum(waiting.map((x) => x.open)).toFixed(0)}`);
  const deliveries = await prisma.salDelivery.findMany({ where, include: { lines: true } });
  const deliveredThisMonth = deliveries.filter((d) => !d.isMigrated && d.status === 'CONFIRMED' && iso(d.docDate)!.startsWith('2026-09'));
  expect('Delivered this month · DOs', '72 · 2', `${sum(deliveredThisMonth.flatMap((d) => d.lines.map((l) => l.qty))).toFixed(0)} · ${deliveredThisMonth.length}`);

  // ── Proformas (S21) ──
  const proformas = await prisma.salProforma.findMany({ where });
  const received = sum(proformas.map((p) => paid(p.docNo)));
  expect('Proformas requested · received · waiting', '43153.00 · 27665.00 · 15488.00',
    `${toMoney(sum(proformas.map((p) => p.amount)))} · ${toMoney(received)} · ${toMoney(sum(proformas.filter((p) => paid(p.docNo).eq(0)).map((p) => p.amount)))}`);

  // ── Cash sales (S23) ──
  const cash = await prisma.salCashSale.findMany({ where, include: { lines: true } });
  const sept = cash.filter((c) => iso(c.docDate)!.startsWith('2026-09'));
  const byMethod = (m: string) => toMoney(sum(sept.filter((c) => c.paymentMethod === m).map((c) => c.total)));
  expect('Cash sales in September · total · today', '38 · 18920.00 · 550.00',
    `${sept.length} · ${toMoney(sum(sept.map((c) => c.total)))} · ${toMoney(sum(cash.filter((c) => iso(c.docDate) === TODAY).map((c) => c.total)))}`);
  expect('Cash sales by card · DuitNow · cash', '9838.00 · 5865.00 · 3217.00', `${byMethod('CARD')} · ${byMethod('DUITNOW')} · ${byMethod('CASH')}`);

  // ── Returns, cancellations, debit notes (S27, S13, S25) ──
  const returns = await prisma.salReturn.findMany({ where, include: { lines: true } });
  expect('Returns credited this month', '1969.00', toMoney(sum(returns.filter((r) => r.status === 'RELEASED' && iso(r.docDate)!.startsWith('2026-09')).map((r) => r.total))));
  const cancels = await prisma.salCancelOrder.findMany({ where, include: { lines: true } });
  expect('Cancellations since August · value', '4 · 10010.00', `${cancels.length} · ${toMoney(sum(cancels.map((c) => c.total)))}`);
  const debitNotes = await prisma.salDebitNote.findMany({ where, include: { lines: true } });
  expect('DN-0001 total (350.00 + service tax 8%)', '378.00', toMoney(debitNotes.find((d) => d.docNo === 'DN-0001')!.total));

  // ── Approvals (S02) ──
  const approvals = await prisma.sysApprovalRequest.findMany({ where: { tenantId, entityType: { startsWith: 'SAL_' } } });
  expect('Waiting for Nor Azlina', 'INV-0003, SO-0002, SO-0008', approvals.filter((a) => a.status === 'PENDING').map((a) => a.docNo).sort().join(', '));
  const inv3Request = await prisma.sysApprovalRequest.findFirst({ where: { tenantId, docNo: 'INV-0003', status: 'PENDING' }, include: { steps: { orderBy: { stepNo: 'asc' } } } });
  expect('INV-0003 approval: price, then credit', 'Nor Azlina WAITING → Rosnah Ismail QUEUED', (inv3Request?.steps ?? []).map((st) => `${st.approverName} ${st.status}`).join(' → '));
  expect('Approved · rejected', '12 · 2', `${approvals.filter((a) => a.status === 'APPROVED').length} · ${approvals.filter((a) => a.status === 'REJECTED').length}`);

  // ── Settings ──
  const excluded = await prisma.salExcludedItem.findMany({ where });
  expect('Active exclusions', '5', String(excluded.filter((e) => !e.removedAt && (!e.untilDate || iso(e.untilDate)! >= TODAY)).length));
  const seqs = await prisma.sysNumberSequence.findMany({ where: { tenantId, module: 'sales' }, orderBy: { docType: 'asc' } });
  expect('Next numbers', 'CO-0003 CS-0005 DN-0002 DO-0004 EQ-2609-0011 INV-0004 PF-0005 QT-0013 SO-0009 SR-0003',
    seqs.map((s) => {
      const value = nextInSequence({ nextValue: s.nextValue, resetEvery: s.resetEvery, periodKey: s.periodKey }, TODAY).value;
      return s.format ? formatPattern(s.format, value, TODAY) : formatDocNo(s.prefix, s.digits, value);
    }).join(' '));

  // ── Integrity: header totals = sum of lines (documents made in Sales, not migrated) ──
  const mismatches: string[] = [];
  const compare = (docNo: string, mode: TaxMode, header: { total: Prisma.Decimal; taxTotal: Prisma.Decimal }, lines: { grossAmount?: Prisma.Decimal; discountAmount?: Prisma.Decimal; amount: Prisma.Decimal; taxAmount: Prisma.Decimal }[]) => {
    const t = saleTotals(lines.map((l) => ({ grossAmount: l.grossAmount ?? l.amount, discountAmount: l.discountAmount ?? dec(0), amount: l.amount, taxAmount: l.taxAmount })), mode, true);
    if (!t.total.eq(header.total) || !t.taxTotal.eq(header.taxTotal)) mismatches.push(docNo);
  };
  for (const q of quotes.filter((x) => !x.isMigrated)) compare(`${q.docNo} r${q.revision}`, 'EXCLUSIVE', q, q.lines);
  for (const o of newOrders) compare(o.docNo, 'EXCLUSIVE', o, o.lines);
  for (const v of invoices.filter((x) => !x.isMigrated)) compare(v.docNo, 'EXCLUSIVE', v, v.lines);
  for (const c of cash.filter((x) => !x.isMigrated)) compare(c.docNo, 'INCLUSIVE', c, c.lines);
  for (const d of debitNotes.filter((x) => !x.isMigrated)) compare(d.docNo, 'EXCLUSIVE', d, d.lines);
  for (const r of returns.filter((x) => !x.isMigrated)) compare(r.docNo, 'EXCLUSIVE', r, r.lines);
  for (const c of cancels.filter((x) => !x.isMigrated)) compare(c.docNo, 'EXCLUSIVE', c, c.lines);
  expect('Header totals = sum of lines (QT, SO, INV, CS, DN, SR, CO)', 'all match', mismatches.length ? mismatches.join(', ') : 'all match');

  // ── Integrity: SO running quantities ──
  const invoiceLines = invoices.filter((v) => v.status === 'RELEASED').flatMap((v) => v.lines);
  const qtyIssues: string[] = [];
  for (const o of newOrders) {
    for (const l of o.lines) {
      const delivered = sum(deliveries.filter((d) => d.status === 'CONFIRMED').flatMap((d) => d.lines).filter((x) => x.soLineId === l.id).map((x) => x.qty));
      const invoiced = sum(invoiceLines.filter((x) => x.soLineId === l.id).map((x) => x.qty));
      const lineIds = new Set(invoiceLines.filter((x) => x.soLineId === l.id).map((x) => x.id));
      const returned = sum(returns.filter((r) => r.status === 'RELEASED').flatMap((r) => r.lines).filter((x) => x.invoiceLineId && lineIds.has(x.invoiceLineId)).map((x) => x.qty));
      const cancelled = sum(cancels.filter((c) => c.status === 'RELEASED').flatMap((c) => c.lines).filter((x) => x.soLineId === l.id).map((x) => x.cancelQty));
      if (!delivered.eq(l.deliveredQty) || !invoiced.eq(l.invoicedQty) || !returned.eq(l.returnedQty) || !cancelled.eq(l.cancelledQty)) {
        qtyIssues.push(`${o.docNo} ${l.itemCode}`);
      }
    }
  }
  expect('SO running quantities = deliveries, invoices, returns, cancels', 'all agree', qtyIssues.length ? qtyIssues.join('; ') : 'all agree');

  // ── Outbox ──
  const events = await prisma.sysOutbox.findMany({ where: { tenantId, name: { startsWith: 'sales.' } }, select: { status: true } });
  expect('Outbox events waiting (no module connected yet)', '13 PENDING', `${events.length} ${events.every((e) => e.status === 'PENDING') ? 'PENDING' : 'mixed'}`);

  // ── Buy to order (S10): seeded history is not replayed by the module listeners ──
  const unhandled: string[] = [];
  for (const { event, handler } of SEEDED_LISTENERS) {
    const rows = await prisma.sysOutbox.findMany({ where: { tenantId, name: event }, select: { id: true } });
    const done = await prisma.sysEventHandled.count({ where: { tenantId, handler, eventId: { in: rows.map((r) => r.id) } } });
    if (done !== rows.length) unhandled.push(`${handler} ${done}/${rows.length}`);
  }
  expect('Seeded events already handled by the module listeners', 'all', unhandled.length ? unhandled.join(', ') : 'all');
  const bto = await prisma.salSalesOrderLine.findMany({ where: { tenantId, isBuyToOrder: true }, select: { purchaseOrderNo: true, salesOrder: { select: { docNo: true } } } });
  expect('Buy-to-order lines and their PO', 'SO-0003 → PO-0003', bto.map((l) => `${l.salesOrder.docNo} → ${l.purchaseOrderNo ?? 'none'}`).join(', '));

  return checks;
}
