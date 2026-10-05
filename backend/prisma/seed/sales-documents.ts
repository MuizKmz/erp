/**
 * Sales documents (docs/design/SALES_SEED_DATA.md): enquiries, quotations, sales orders, deliveries, invoices,
 * proformas, cancel orders, cash sales, debit notes, returns, the Finance payments stub, and the platform
 * records around them (approvals, activity, links, emails, outbox, attachments).
 * Money comes from src/sales/shared/totals.rules.ts so seeded totals equal what the app calculates.
 * Rows marked "invented" in SALES_SEED_DATA.md exist only so the counts and totals add up.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { dec, roundMoney, toMoney, toQty } from '../../src/platform/http/decimal';
import { renderTemplate } from '../../src/purchase/shared/email-template.rules';
import { SAL_ENTITY, SAL_EVENT, SAL_LINK } from '../../src/sales/shared/sales.constants';
import { saleLineTotals, saleTotals, type TaxMode } from '../../src/sales/shared/totals.rules';
import { SALE_ITEMS } from './sales-master';
import { SALES_EMAIL_TEMPLATES } from './sales-settings';
import { audit, customer, day, doc, item, kl, nameOf, placeholderPdf, remember, user, type SeedCtx } from './util';

// ── Helpers ─────────────────────────────────────────────────────────────────

type LineSpec = [itemCode: string, qty: number | string, unitPrice: string, discountPct?: number];

function listPrice(priceList: string, itemCode: string): Prisma.Decimal | null {
  const i = SALE_ITEMS.find((x) => x.code === itemCode);
  const p = priceList === 'RES-2026' ? (i?.res ?? i?.std) : i?.std;
  return p ? dec(p) : null;
}

/** Item reference + snapshot + money for one sales line. */
function saleLine(ctx: SeedCtx, [code, qty, price, disc]: LineSpec, mode: TaxMode = 'EXCLUSIVE', priceList = 'STD-2026') {
  const it = item(ctx, code);
  const tax = ctx.taxes.get(it.salesTaxCode ?? it.purchaseTaxCode);
  if (!tax) throw new Error(`Seed: no tax code for ${code}`);
  const t = saleLineTotals({ qty, unitPrice: price, discountPct: disc ?? 0, taxRate: tax.rate }, mode);
  return {
    itemId: it.id, itemCode: it.code, itemName: it.name, uomCode: it.salesUom ?? it.baseUom, taxCode: tax.code, taxRate: tax.rate,
    qty: dec(qty), unitPrice: dec(price), discountPct: dec(disc ?? 0), listPrice: listPrice(priceList, code), unitCost: it.standardCost,
    ...t,
  };
}
type SaleLine = ReturnType<typeof saleLine>;

function totalsOf(lines: SaleLine[], mode: TaxMode = 'EXCLUSIVE') {
  const t = saleTotals(lines, mode, true);
  return { subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, rounding: t.rounding, total: t.total };
}

function party(ctx: SeedCtx, code: string) {
  const c = customer(ctx, code);
  return { customerId: c.id, customerCode: c.code, customerName: c.name };
}

function agent(ctx: SeedCtx, code: string) {
  return { agentCode: code, agentName: nameOf(ctx, code) };
}

const lineNo = <T>(rows: T[]) => rows.map((r, i) => ({ ...r, lineNo: i + 1 }));
const branchOf = (ctx: SeedCtx, customerCode: string) => customer(ctx, customerCode).branchCode;
const warehouseOf = (branchCode: string) => (branchCode === 'PNG' ? 'PNG-MAIN' : 'HQ-MAIN');
const plain = (v: Prisma.Decimal) => (v.isInteger() ? v.toFixed(0) : v.toFixed(2));

// ── Enquiries ───────────────────────────────────────────────────────────────

type EnqRow = [no: string, date: string, cust: string, status: 'NEW' | 'FORWARDED' | 'QUOTED' | 'LOST', agent: string, type: string, source: string, budget: string, quote: string | null, lost?: string];

const ENQUIRIES: EnqRow[] = [
  ['EQ-2609-0001', '2026-09-02', 'C-0056', 'QUOTED', 'FO', 'BULK', 'PHONE', '14000.00', 'QT-0003'],
  ['EQ-2609-0002', '2026-09-04', 'C-0078', 'QUOTED', 'FO', 'OFFICE', 'EMAIL', '4000.00', 'QT-0004'],
  ['EQ-2609-0003', '2026-09-08', 'C-0012', 'QUOTED', 'AR', 'HOSPITALITY', 'EMAIL', '75000.00', 'QT-0008'],
  ['EQ-2609-0004', '2026-09-10', 'C-0078', 'LOST', 'FO', 'OFFICE', 'PHONE', '8500.00', 'QT-0005', 'Quotation expired; the clinic bought elsewhere'],
  ['EQ-2609-0005', '2026-09-12', 'C-0056', 'QUOTED', 'FO', 'CUSTOM', 'PHONE', '13000.00', 'QT-0010'],
  ['EQ-2609-0006', '2026-09-18', 'C-0012', 'QUOTED', 'AR', 'BULK', 'EMAIL', '30000.00', 'QT-0001'],
  ['EQ-2609-0007', '2026-09-19', 'C-0045', 'QUOTED', 'FO', 'BULK', 'PHONE', '5000.00', 'QT-0009'],
  ['EQ-2609-0008', '2026-09-24', 'C-0056', 'FORWARDED', 'FO', 'CUSTOM', 'WALKIN', '12000.00', null],
  ['EQ-2609-0009', '2026-09-25', 'C-0031', 'QUOTED', 'LWJ', 'RESELLER', 'WEBSITE', '95000.00', 'QT-0012'],
  ['EQ-2609-0010', '2026-09-27', 'C-0102', 'NEW', 'AR', 'CUSTOM', 'REFERRAL', '80000.00', null],
  // Migrated in September (invented) so S31's counts add up to 24
  ['EQ-L-0301', '2026-09-01', 'C-0045', 'QUOTED', 'FO', 'BULK', 'PHONE', '9000.00', 'QT-0002'],
  ['EQ-L-0302', '2026-09-02', 'C-0012', 'QUOTED', 'AR', 'BULK', 'EMAIL', '12000.00', 'QT-0006'],
  ['EQ-L-0303', '2026-09-03', 'C-0031', 'QUOTED', 'LWJ', 'RESELLER', 'WEBSITE', '7000.00', 'QT-0007'],
  ['EQ-L-0304', '2026-09-04', 'C-0056', 'QUOTED', 'FO', 'CUSTOM', 'WALKIN', '3500.00', 'QT-L-0088'],
  ['EQ-L-0305', '2026-09-05', 'C-0031', 'NEW', 'LWJ', 'RESELLER', 'WEBSITE', '20000.00', null],
  ['EQ-L-0306', '2026-09-07', 'C-0078', 'NEW', 'FO', 'OFFICE', 'PHONE', '2500.00', null],
  ['EQ-L-0307', '2026-09-08', 'C-0012', 'NEW', 'AR', 'HOSPITALITY', 'EMAIL', '40000.00', null],
  ['EQ-L-0308', '2026-09-09', 'C-0045', 'NEW', 'FO', 'BULK', 'WEBSITE', '6000.00', null],
  ['EQ-L-0309', '2026-09-10', 'C-0031', 'NEW', 'LWJ', 'BULK', 'WALKIN', '15000.00', null],
  ['EQ-L-0310', '2026-09-11', 'C-0056', 'FORWARDED', 'FO', 'CUSTOM', 'PHONE', '4000.00', null],
  ['EQ-L-0311', '2026-09-12', 'C-0045', 'FORWARDED', 'FO', 'BULK', 'EMAIL', '8000.00', null],
  ['EQ-L-0312', '2026-09-14', 'C-0031', 'FORWARDED', 'LWJ', 'RESELLER', 'WEBSITE', '30000.00', null],
  ['EQ-L-0313', '2026-09-15', 'C-0012', 'LOST', 'AR', 'BULK', 'WALKIN', '10000.00', null, 'Bought from a competitor'],
  ['EQ-L-0314', '2026-09-16', 'C-0078', 'LOST', 'FO', 'CUSTOM', 'REFERRAL', '5000.00', null, 'Budget cut'],
];

async function seedEnquiries(ctx: SeedCtx): Promise<void> {
  for (const [no, date, cust, status, ag, type, source, budget, quote, lost] of ENQUIRIES) {
    const c = customer(ctx, cust);
    const prospect = no === 'EQ-2609-0010'; // Villa Damai Resort was a prospect when the enquiry came in
    const items = no === 'EQ-2609-0009'
      ? [{ code: 'CH-DIN-01', qty: 200, remarks: 'Natural finish' }, { code: 'TB-DIN-06', qty: 30, remarks: 'Same finish as chairs' }]
      : no === 'EQ-2609-0010' ? [{ code: 'BD-KNG-01', qty: 24, remarks: 'Teak, for the new villas' }] : [];
    const at = kl(date, '09:20');
    const row = await ctx.prisma.salEnquiry.create({
      data: {
        tenantId: ctx.tenantId, docNo: no, docDate: day(date), status, branchCode: c.branchCode,
        customerId: c.id, customerCode: c.code, customerName: c.name, isProspect: prospect,
        contactName: c.contactName, phone: c.phone, email: c.email, enquiryTypeCode: type, sourceCode: source, ...agent(ctx, ag),
        budget: dec(budget), quotationNo: quote, lostReason: lost ?? null,
        description: no === 'EQ-2609-0009'
          ? 'Restocking two showrooms in Penang. Wants 200 oak dining chairs and 30 six-seater tables, delivered in one lot. Asked about reseller pricing.'
          : no === 'EQ-2609-0010' ? 'Furnishing 24 new villas. Wants teak king beds and asked for a site visit.' : null,
        forwardedAt: status === 'NEW' ? null : kl(date, '09:30'),
        isMigrated: no.includes('-L-'), ...audit(ag, at),
        items: {
          create: items.map((i, idx) => {
            const it = item(ctx, i.code);
            return { tenantId: ctx.tenantId, lineNo: idx + 1, itemId: it.id, itemCode: it.code, itemName: it.name, uomCode: it.salesUom ?? it.baseUom, qty: dec(i.qty), remarks: i.remarks };
          }),
        },
      },
    });
    remember(ctx, no, SAL_ENTITY.ENQUIRY, row.id);
  }
}

// ── Quotations ──────────────────────────────────────────────────────────────

interface QtSeed {
  no: string; rev?: number; date: string; valid: string | null; cust: string; agent: string; lines: LineSpec[];
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'ORDERED' | 'LOST' | 'SUPERSEDED';
  enquiry?: string; so?: string; note?: string; lost?: string; approved?: string;
}

const QUOTATIONS: QtSeed[] = [
  {
    no: 'QT-0012', date: '2026-09-29', valid: '2026-10-13', cust: 'C-0031', agent: 'LWJ', status: 'DRAFT', enquiry: 'EQ-2609-0009',
    lines: [['CH-DIN-01', 200, '235.00', 5], ['TB-DIN-06', 30, '1380.00', 5]],
    note: 'Prices valid for 14 days. Delivery within 3 weeks of order confirmation, one lot to Penang.',
  },
  { no: 'QT-0011', date: '2026-09-28', valid: '2026-10-12', cust: 'C-0102', agent: 'AR', status: 'ORDERED', so: 'SO-0007', lines: [['BD-KNG-01', 24, '1400.00']] },
  { no: 'QT-0010', rev: 0, date: '2026-09-22', valid: '2026-10-06', cust: 'C-0056', agent: 'FO', status: 'SUPERSEDED', enquiry: 'EQ-2609-0005', lines: [['TB-RST-04', 10, '850.00'], ['SF-BTH-02', 1, '1190.00'], ['CH-DIN-01', 12, '250.00'], ['CU-SET-02', 4, '60.00']] },
  { no: 'QT-0010', rev: 1, date: '2026-09-25', valid: '2026-10-09', cust: 'C-0056', agent: 'FO', status: 'RELEASED', enquiry: 'EQ-2609-0005', approved: '2026-09-28', lines: [['TB-RST-04', 10, '850.00', 18], ['SF-BTH-02', 1, '1190.00'], ['CH-DIN-01', 12, '250.00'], ['CU-SET-02', 4, '60.00']] },
  { no: 'QT-0009', date: '2026-09-19', valid: '2026-10-03', cust: 'C-0045', agent: 'FO', status: 'ORDERED', enquiry: 'EQ-2609-0007', so: 'SO-0002', lines: [['CH-DIN-01', 16, '250.00']] },
  { no: 'QT-0008', date: '2026-09-24', valid: '2026-10-08', cust: 'C-0012', agent: 'AR', status: 'ORDERED', enquiry: 'EQ-2609-0003', so: 'SO-0003', lines: [['SF-CUS-03', 20, '3200.00']] },
  { no: 'QT-0001', date: '2026-09-18', valid: '2026-10-02', cust: 'C-0012', agent: 'AR', status: 'ORDERED', enquiry: 'EQ-2609-0006', so: 'SO-0001', lines: [['CH-DIN-01', 100, '250.00']] },
  { no: 'QT-0005', date: '2026-09-10', valid: '2026-09-24', cust: 'C-0078', agent: 'FO', status: 'RELEASED', enquiry: 'EQ-2609-0004', lines: [['CH-OFF-02', 26, '300.00']] },
  { no: 'QT-0003', date: '2026-09-21', valid: '2026-10-05', cust: 'C-0056', agent: 'FO', status: 'ORDERED', enquiry: 'EQ-2609-0001', so: 'SO-0004', lines: [['TB-RST-04', 7, '850.00'], ['SF-BTH-02', 5, '1190.00']] },
  { no: 'QT-0004', date: '2026-09-18', valid: '2026-10-02', cust: 'C-0078', agent: 'FO', status: 'RELEASED', enquiry: 'EQ-2609-0002', lines: [['CH-OFF-02', 10, '300.00']] },
  { no: 'QT-0002', date: '2026-09-03', valid: null, cust: 'C-0045', agent: 'FO', status: 'DRAFT', lines: [['TB-DIN-06', 6, '1450.00']] },
  { no: 'QT-0006', date: '2026-09-15', valid: null, cust: 'C-0012', agent: 'AR', status: 'DRAFT', lines: [['CH-DIN-02', 40, '280.00']] },
  { no: 'QT-0007', date: '2026-09-16', valid: null, cust: 'C-0031', agent: 'LWJ', status: 'DRAFT', lines: [['CH-BAR-01', 30, '180.00']] },
  { no: 'QT-L-0099', date: '2026-09-05', valid: '2026-09-19', cust: 'C-0056', agent: 'FO', status: 'LOST', lost: 'Customer chose a cheaper supplier', lines: [['TB-RST-04', 6, '850.00']] },
  { no: 'QT-L-0101', date: '2026-09-08', valid: '2026-09-22', cust: 'C-0031', agent: 'LWJ', status: 'LOST', lost: 'Price too high', lines: [['CH-DIN-02', 50, '265.00']] },
];

async function seedQuotations(ctx: SeedCtx): Promise<void> {
  for (const q of QUOTATIONS) {
    const c = customer(ctx, q.cust);
    const lines = q.lines.map((l) => saleLine(ctx, l, 'EXCLUSIVE', c.priceListCode));
    const totals = totalsOf(lines);
    const cost = lines.reduce((s, l) => s.add(dec(l.unitCost ?? 0).mul(l.qty)), dec(0));
    const released = ['RELEASED', 'ORDERED', 'LOST'].includes(q.status);
    const at = kl(q.date, '09:40');
    const row = await ctx.prisma.salQuotation.create({
      data: {
        tenantId: ctx.tenantId, docNo: q.no, revision: q.rev ?? 0, docDate: day(q.date), validUntil: q.valid ? day(q.valid) : null, status: q.status,
        branchCode: c.branchCode, ...party(ctx, q.cust), contactName: c.contactName, ...agent(ctx, q.agent),
        currency: 'MYR', taxMode: 'EXCLUSIVE', creditTermDays: c.creditTermDays, priceListCode: c.priceListCode,
        enquiryId: q.enquiry ? doc(ctx, q.enquiry).id : null, enquiryNo: q.enquiry ?? null, customerNote: q.note ?? null,
        ...totals, costTotal: roundMoney(cost),
        creditSnapshot: q.no === 'QT-0012'
          ? { scope: 'GROUP', checkedAt: kl('2026-09-29', '09:31').toISOString(), creditLimit: '60000.00', owed: '18400.00', otherOpen: '0.00', thisDocument: '92378.00', exposureAfter: '110778.00', overCredit: '50778.00', overdue: '12000.00', overdueLimit: '15000.00', overOverdue: '0.00', result: 'WARNED' }
          : Prisma.JsonNull,
        approvalRequired: Boolean(q.approved), approvedAt: q.approved ? kl(q.approved, '10:15') : null,
        releasedAt: released ? kl(q.approved ?? q.date, q.approved ? '10:30' : '09:55') : null, releasedByCode: released ? q.agent : null,
        emailedAt: released ? kl(q.approved ?? q.date, q.approved ? '10:32' : '09:57') : null,
        salesOrderNo: q.so ?? null, lostReason: q.lost ?? null, isMigrated: q.no.includes('-L-'), ...audit(q.agent, at),
        lines: {
          create: lineNo(lines).map((l) => ({
            tenantId: ctx.tenantId, lineNo: l.lineNo, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
            taxCode: l.taxCode, taxRate: l.taxRate, qty: l.qty, listPrice: l.listPrice, unitPrice: l.unitPrice, discountPct: l.discountPct,
            grossAmount: l.grossAmount, discountAmount: l.discountAmount, amount: l.amount, taxAmount: l.taxAmount, unitCost: l.unitCost,
          })),
        },
      },
    });
    if (q.status !== 'SUPERSEDED') remember(ctx, q.no, SAL_ENTITY.QUOTATION, row.id);
  }
}

// ── Sales orders ────────────────────────────────────────────────────────────

interface SoLineSeed { spec: LineSpec; delivered?: number; invoiced?: number; returned?: number; cancelled?: number; bto?: string }
interface SoSeed {
  no: string; date: string; cust: string; agent: string; status: 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'PARTIAL' | 'DONE' | 'CANCELLED';
  lines: SoLineSeed[]; type?: string; quote?: string; enquiry?: string; wanted?: string; promised?: string; poRef?: string; project?: string;
  released?: Date; credit?: { result: string; snap: Record<string, string> }; balanceCancelled?: boolean; approved?: Date; migrated?: boolean;
}

const snap = (s: Record<string, string>) => ({ scope: 'GROUP', ...s });

const ORDERS: SoSeed[] = [
  {
    no: 'SO-0001', date: '2026-09-18', cust: 'C-0012', agent: 'AR', status: 'PARTIAL', quote: 'QT-0001', enquiry: 'EQ-2609-0006',
    wanted: '2026-10-12', promised: '2026-10-05', poRef: 'HSB-PO-2231', project: 'Renovation Wing B', released: kl('2026-09-18', '10:12'),
    lines: [{ spec: ['CH-DIN-01', 100, '250.00'], delivered: 60, invoiced: 60, returned: 5 }],
    credit: { result: 'PASSED', snap: snap({ checkedAt: kl('2026-09-18', '10:06').toISOString(), creditLimit: '50000.00', owed: '12000.00', otherOpen: '0.00', thisDocument: '27500.00', exposureAfter: '39500.00', headroom: '10500.00', overCredit: '0.00', overdue: '0.00', overdueLimit: '5000.00', overOverdue: '0.00' }) },
  },
  {
    no: 'SO-0002', date: '2026-09-26', cust: 'C-0045', agent: 'FO', status: 'PENDING_APPROVAL', quote: 'QT-0009', enquiry: 'EQ-2609-0007',
    lines: [{ spec: ['CH-DIN-01', 16, '250.00'] }],
    credit: { result: 'OVER_LIMIT', snap: snap({ checkedAt: kl('2026-09-26', '15:06').toISOString(), creditLimit: '20000.00', owed: '18000.00', otherOpen: '0.00', thisDocument: '4400.00', exposureAfter: '22400.00', headroom: '-2400.00', overCredit: '2400.00', overdue: '5000.00', overdueLimit: '3000.00', overOverdue: '2000.00', overdueOver60: '5000.00' }) },
  },
  {
    no: 'SO-0003', date: '2026-09-27', cust: 'C-0012', agent: 'AR', status: 'RELEASED', type: 'BTO', quote: 'QT-0008', enquiry: 'EQ-2609-0003',
    wanted: '2026-10-30', promised: '2026-10-12', poRef: 'HSB-PO-2260', project: 'Renovation Wing B', released: kl('2026-09-27', '10:10'),
    lines: [{ spec: ['SF-CUS-03', 20, '3200.00'], bto: 'PO-0003' }],
    credit: { result: 'PASSED', snap: snap({ checkedAt: kl('2026-09-27', '10:02').toISOString(), creditLimit: '150000.00', owed: '27125.00', otherOpen: '11000.00', thisDocument: '70400.00', exposureAfter: '108525.00', headroom: '41475.00', overCredit: '0.00', overdue: '0.00', overdueLimit: '5000.00', overOverdue: '0.00' }) },
  },
  {
    no: 'SO-0004', date: '2026-09-22', cust: 'C-0056', agent: 'FO', status: 'DONE', quote: 'QT-0003', enquiry: 'EQ-2609-0001',
    wanted: '2026-09-25', released: kl('2026-09-22', '10:40'), approved: kl('2026-09-22', '10:30'),
    lines: [{ spec: ['TB-RST-04', 7, '850.00'], delivered: 7, invoiced: 7 }, { spec: ['SF-BTH-02', 5, '1190.00'], delivered: 5, invoiced: 5 }],
    credit: { result: 'APPROVED', snap: snap({ checkedAt: kl('2026-09-22', '09:05').toISOString(), creditLimit: '15000.00', owed: '5270.00', otherOpen: '0.00', thisDocument: '13090.00', exposureAfter: '18360.00', headroom: '-3360.00', overCredit: '3360.00', overdue: '0.00', overdueLimit: '3000.00', overOverdue: '0.00' }) },
  },
  {
    no: 'SO-0005', date: '2026-09-23', cust: 'C-0031', agent: 'LWJ', status: 'DRAFT', wanted: '2026-10-20',
    lines: [{ spec: ['CH-DIN-01', 80, '240.00'] }],
  },
  {
    no: 'SO-0006', date: '2026-09-12', cust: 'C-0078', agent: 'FO', status: 'PARTIAL', wanted: '2026-10-15', released: kl('2026-09-12', '11:00'),
    lines: [{ spec: ['CH-OFF-02', 25, '300.00'], delivered: 10, invoiced: 10 }],
    credit: { result: 'APPROVED', snap: snap({ checkedAt: kl('2026-09-25', '09:40').toISOString(), creditLimit: '15000.00', owed: '6000.00', otherOpen: '0.00', thisDocument: '8250.00', exposureAfter: '14250.00', headroom: '750.00', overCredit: '0.00', overdue: '4500.00', overdueLimit: '3000.00', overOverdue: '1500.00' }) },
  },
  {
    no: 'SO-0007', date: '2026-09-28', cust: 'C-0102', agent: 'AR', status: 'RELEASED', quote: 'QT-0011', wanted: '2026-10-15', promised: '2026-10-20',
    released: kl('2026-09-28', '14:00'), lines: [{ spec: ['BD-KNG-01', 24, '1400.00'] }],
    credit: { result: 'PASSED', snap: snap({ checkedAt: kl('2026-09-28', '13:55').toISOString(), creditLimit: '50000.00', owed: '0.00', otherOpen: '0.00', thisDocument: '36960.00', exposureAfter: '36960.00', headroom: '13040.00', overCredit: '0.00', overdue: '0.00', overdueLimit: '5000.00', overOverdue: '0.00' }) },
  },
  {
    no: 'SO-0008', date: '2026-09-28', cust: 'C-0031', agent: 'LWJ', status: 'PENDING_APPROVAL', enquiry: 'EQ-2609-0009', wanted: '2026-10-19',
    lines: [{ spec: ['CH-DIN-01', 200, '235.00', 5] }, { spec: ['TB-DIN-06', 30, '1380.00', 5] }],
    credit: { result: 'OVER_LIMIT', snap: snap({ checkedAt: kl('2026-09-28', '11:12').toISOString(), creditLimit: '60000.00', owed: '18400.00', otherOpen: '0.00', thisDocument: '92378.00', exposureAfter: '110778.00', headroom: '-50778.00', overCredit: '50778.00', overdue: '12000.00', overdueLimit: '15000.00', overOverdue: '0.00' }) },
  },
  // Migrated orders, all closed before September (invented)
  { no: 'SO-L-0981', date: '2026-08-25', cust: 'C-0056', agent: 'FO', status: 'DONE', balanceCancelled: true, migrated: true, lines: [{ spec: ['CH-DIN-01', 24, '250.00'], delivered: 20, invoiced: 20, cancelled: 4 }] },
  { no: 'SO-L-0952', date: '2026-08-14', cust: 'C-0031', agent: 'LWJ', status: 'CANCELLED', migrated: true, lines: [{ spec: ['ST-BAR-02', 12, '100.00'], cancelled: 12 }] },
  { no: 'SO-L-0930', date: '2026-08-05', cust: 'C-0045', agent: 'FO', status: 'DONE', balanceCancelled: true, migrated: true, lines: [{ spec: ['TB-RST-04', 30, '400.00'], delivered: 24, invoiced: 24, cancelled: 6 }] },
  { no: 'SO-L-0921', date: '2026-07-30', cust: 'C-0012', agent: 'AR', status: 'DONE', migrated: true, lines: [{ spec: ['CH-DIN-01', 32, '250.00'], delivered: 32, invoiced: 32 }] },
  { no: 'SO-L-0915', date: '2026-07-22', cust: 'C-0031', agent: 'LWJ', status: 'DONE', migrated: true, lines: [{ spec: ['CH-DIN-01', 40, '240.00'], delivered: 40, invoiced: 40 }] },
  { no: 'SO-L-0904', date: '2026-07-10', cust: 'C-0045', agent: 'FO', status: 'DONE', migrated: true, lines: [{ spec: ['CH-OFF-02', 16, '300.00'], delivered: 16, invoiced: 16 }] },
  { no: 'SO-L-0899', date: '2026-07-02', cust: 'C-0012', agent: 'AR', status: 'DONE', migrated: true, lines: [{ spec: ['TB-DIN-06', 9, '1450.00'], delivered: 9, invoiced: 9 }] },
  { no: 'SO-L-0887', date: '2026-06-24', cust: 'C-0078', agent: 'FO', status: 'DONE', migrated: true, lines: [{ spec: ['CH-OFF-02', 12, '300.00'], delivered: 12, invoiced: 12 }] },
  { no: 'SO-L-0876', date: '2026-06-15', cust: 'C-0056', agent: 'FO', status: 'DONE', migrated: true, lines: [{ spec: ['TB-RST-04', 4, '850.00'], delivered: 4, invoiced: 4 }] },
  { no: 'SO-L-0862', date: '2026-06-03', cust: 'C-0031', agent: 'LWJ', status: 'DONE', migrated: true, lines: [{ spec: ['CH-BAR-01', 20, '185.00'], delivered: 20, invoiced: 20 }] },
];

/** SO line ids by "SO-0001:CH-DIN-01", for deliveries, invoices and cancellations. */
const soLineIds = new Map<string, string>();

async function seedSalesOrders(ctx: SeedCtx): Promise<void> {
  for (const o of ORDERS) {
    const c = customer(ctx, o.cust);
    const lines = o.lines.map((l) => ({ seed: l, line: saleLine(ctx, l.spec, 'EXCLUSIVE', c.priceListCode), id: randomUUID() }));
    const totals = totalsOf(lines.map((l) => l.line));
    const at = kl(o.date, '10:05');
    const row = await ctx.prisma.salSalesOrder.create({
      data: {
        tenantId: ctx.tenantId, docNo: o.no, docDate: day(o.date), status: o.status, balanceCancelled: o.balanceCancelled ?? false,
        branchCode: c.branchCode, orderTypeCode: o.type ?? 'STD', ...party(ctx, o.cust), contactName: c.contactName, ...agent(ctx, o.agent),
        warehouseCode: warehouseOf(c.branchCode), deliveryWantedBy: o.wanted ? day(o.wanted) : null, promisedDate: o.promised ? day(o.promised) : null,
        currency: 'MYR', taxMode: 'EXCLUSIVE', creditTermDays: c.creditTermDays, priceListCode: c.priceListCode,
        customerPoRef: o.poRef ?? null, project: o.project ?? null, deliveryAddress: c.deliveryAddress,
        quotationId: o.quote ? doc(ctx, o.quote).id : null, quotationNo: o.quote ?? null, enquiryNo: o.enquiry ?? null,
        ...totals,
        creditResult: o.credit?.result ?? null, creditSnapshot: o.credit ? o.credit.snap : Prisma.JsonNull,
        approvalRequired: o.status === 'PENDING_APPROVAL' || Boolean(o.approved), approvedAt: o.approved ?? null,
        releasedAt: o.released ?? null, releasedByCode: o.released ? o.agent : null, releasedByName: o.released ? nameOf(ctx, o.agent) : null,
        isMigrated: o.migrated ?? false, ...audit(o.agent, at),
        lines: {
          create: lineNo(lines).map(({ seed, line: l, id, lineNo: n }) => ({
            id, tenantId: ctx.tenantId, lineNo: n, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
            taxCode: l.taxCode, taxRate: l.taxRate, listPrice: l.listPrice, unitPrice: l.unitPrice, discountPct: l.discountPct,
            orderedQty: l.qty, deliveredQty: dec(seed.delivered ?? 0), invoicedQty: dec(seed.invoiced ?? 0), returnedQty: dec(seed.returned ?? 0), cancelledQty: dec(seed.cancelled ?? 0),
            grossAmount: l.grossAmount, discountAmount: l.discountAmount, amount: l.amount, taxAmount: l.taxAmount,
            isBuyToOrder: Boolean(seed.bto), purchaseOrderNo: seed.bto ?? null,
          })),
        },
      },
    });
    for (const l of lines) soLineIds.set(`${o.no}:${l.line.itemCode}`, l.id);
    remember(ctx, o.no, SAL_ENTITY.ORDER, row.id);
  }
}

function soLine(no: string, itemCode: string): string {
  const id = soLineIds.get(`${no}:${itemCode}`);
  if (!id) throw new Error(`Seed: no line ${itemCode} on ${no}`);
  return id;
}

// ── Delivery orders ─────────────────────────────────────────────────────────

interface DoSeed {
  no: string; date: string; so: string; cust: string; status: 'DRAFT' | 'CONFIRMED'; by: string; lines: [itemCode: string, ordered: number, before: number, qty: number, invoiced: number][];
  vehicle?: string; driver?: string; cn?: string; receiver?: string; note?: string; confirmed?: Date; migrated?: boolean;
}

const DELIVERIES: DoSeed[] = [
  {
    no: 'DO-0001', date: '2026-09-21', so: 'SO-0001', cust: 'C-0012', status: 'CONFIRMED', by: 'AR', confirmed: kl('2026-09-21', '09:30'),
    vehicle: 'VKL 3321', driver: 'Rahim', cn: 'CN-778120', receiver: 'Pn. Zarina Aziz', note: 'Use loading bay B. Call receiver 30 minutes before arrival.',
    lines: [['CH-DIN-01', 100, 0, 60, 60]],
  },
  {
    no: 'DO-0002', date: '2026-09-22', so: 'SO-0004', cust: 'C-0056', status: 'CONFIRMED', by: 'FO', confirmed: kl('2026-09-22', '15:00'),
    vehicle: 'PKN 882', driver: 'Suresh', cn: 'CN-778431', receiver: 'Mr. Ravi Kumar', lines: [['TB-RST-04', 7, 0, 7, 7], ['SF-BTH-02', 5, 0, 5, 5]],
  },
  { no: 'DO-0003', date: '2026-09-29', so: 'SO-0007', cust: 'C-0102', status: 'DRAFT', by: 'AR', vehicle: 'VKL 3321', driver: 'Rahim', receiver: 'Mr. Daniel Wong', lines: [['BD-KNG-01', 24, 0, 24, 0]] },
  { no: 'DO-L-0388', date: '2026-09-13', so: 'SO-0006', cust: 'C-0078', status: 'CONFIRMED', by: 'FO', confirmed: kl('2026-09-13', '10:00'), migrated: true, lines: [['CH-OFF-02', 25, 0, 10, 10]] },
];

const doLineIds = new Map<string, string>();

async function seedDeliveries(ctx: SeedCtx): Promise<void> {
  for (const d of DELIVERIES) {
    const c = customer(ctx, d.cust);
    const row = await ctx.prisma.salDelivery.create({
      data: {
        tenantId: ctx.tenantId, docNo: d.no, docDate: day(d.date), status: d.status, branchCode: c.branchCode,
        salesOrderId: doc(ctx, d.so).id, salesOrderNo: d.so, customerCode: c.code, customerName: c.name, warehouseCode: warehouseOf(c.branchCode),
        vehicle: d.vehicle ?? null, driver: d.driver ?? null, consignmentNote: d.cn ?? null, deliverTo: c.deliveryAddress, receiver: d.receiver ?? null,
        warehouseNote: d.note ?? null, confirmedAt: d.confirmed ?? null, confirmedByCode: d.confirmed ? d.by : null, confirmedByName: d.confirmed ? nameOf(ctx, d.by) : null,
        isMigrated: d.migrated ?? false, ...audit(d.by, kl(d.date, '08:30'), d.confirmed),
        lines: {
          create: d.lines.map(([code, ordered, before, qty, invoiced], i) => {
            const it = item(ctx, code);
            const id = randomUUID();
            doLineIds.set(`${d.no}:${code}`, id);
            return {
              id, tenantId: ctx.tenantId, lineNo: i + 1, soLineId: soLine(d.so, code), itemId: it.id, itemCode: it.code, itemName: it.name, uomCode: it.salesUom ?? it.baseUom,
              orderedQty: dec(ordered), deliveredBeforeQty: dec(before), qty: dec(qty), invoicedQty: dec(invoiced),
            };
          }),
        },
      },
    });
    remember(ctx, d.no, SAL_ENTITY.DELIVERY, row.id);
  }
}

// ── Invoices ────────────────────────────────────────────────────────────────

interface InvSeed {
  no: string; date: string; cust: string; agent: string; total?: string; due?: string; status?: 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED';
  so?: string; delivery?: string; lines?: { spec: LineSpec; returned?: number }[]; kind?: 'FROM_ORDER' | 'DIRECT';
  credited?: string; deposit?: string; proforma?: string; receipts?: [date: string, amount: string][]; note?: string; emailed?: Date;
}

const INVOICES: InvSeed[] = [
  {
    no: 'INV-0001', date: '2026-09-21', cust: 'C-0012', agent: 'AR', due: '2026-10-21', so: 'SO-0001', delivery: 'DO-0001', credited: '1375.00', emailed: kl('2026-09-21', '14:05'),
    lines: [{ spec: ['CH-DIN-01', 60, '250.00'], returned: 5 }], note: 'First delivery of 60 chairs. The remaining 40 will be invoiced on delivery.',
  },
  {
    no: 'INV-0002', date: '2026-09-22', cust: 'C-0056', agent: 'FO', due: '2026-10-22', so: 'SO-0004', delivery: 'DO-0002', deposit: '6545.00', proforma: 'PF-0001',
    lines: [{ spec: ['TB-RST-04', 7, '850.00'] }, { spec: ['SF-BTH-02', 5, '1190.00'] }],
  },
  { no: 'INV-0003', date: '2026-09-29', cust: 'C-0078', agent: 'FO', status: 'PENDING_APPROVAL', kind: 'DIRECT', lines: [{ spec: ['CH-OFF-02', 10, '264.00'] }] },
  // Migrated, unpaid (12). Totals and dates invented except INV-L-0376 and INV-L-0398.
  { no: 'INV-L-0389', date: '2026-08-29', cust: 'C-0012', agent: 'AR', total: '12000.00', due: '2026-09-28' },
  { no: 'INV-L-0376', date: '2026-06-18', cust: 'C-0045', agent: 'FO', total: '8000.00', due: '2026-07-18', receipts: [['2026-08-15', '3000.00']] },
  { no: 'INV-L-0424', date: '2026-09-01', cust: 'C-0045', agent: 'FO', total: '6500.00', due: '2026-10-01' },
  { no: 'INV-L-0427', date: '2026-09-10', cust: 'C-0045', agent: 'FO', total: '6500.00', due: '2026-10-10' },
  { no: 'INV-L-0398', date: '2026-08-12', cust: 'C-0031', agent: 'LWJ', total: '6400.00', due: '2026-09-11' },
  { no: 'INV-L-0402', date: '2026-08-20', cust: 'C-0031', agent: 'LWJ', total: '5600.00', due: '2026-09-19' },
  { no: 'INV-L-0431', date: '2026-09-15', cust: 'C-0031', agent: 'LWJ', total: '6400.00', due: '2026-10-15' },
  { no: 'INV-L-0393', date: '2026-08-16', cust: 'C-0078', agent: 'FO', total: '4500.00', due: '2026-09-15' },
  { no: 'INV-L-0405', date: '2026-09-14', cust: 'C-0078', agent: 'FO', due: '2026-10-14', so: 'SO-0006', delivery: 'DO-L-0388', lines: [{ spec: ['CH-OFF-02', 10, '300.00'] }] },
  { no: 'INV-L-0436', date: '2026-09-20', cust: 'C-0078', agent: 'FO', total: '1500.00', due: '2026-10-20' },
  { no: 'INV-L-0385', date: '2026-08-26', cust: 'C-0056', agent: 'FO', total: '3400.00', due: '2026-09-25' },
  { no: 'INV-L-0433', date: '2026-09-18', cust: 'C-0056', agent: 'FO', total: '1870.00', due: '2026-10-18' },
  // Migrated, paid (16)
  { no: 'INV-L-0412', date: '2026-08-05', cust: 'C-0045', agent: 'FO', total: '6200.00', due: '2026-09-04', credited: '594.00', receipts: [['2026-08-20', '2106.00'], ['2026-09-02', '3500.00']], lines: [{ spec: ['CH-OFF-02', 2, '270.00'], returned: 2 }] },
  { no: 'INV-L-0355', date: '2026-08-12', cust: 'C-0012', agent: 'AR', total: '8800.00', due: '2026-09-11', receipts: [['2026-09-10', '8800.00']] },
  { no: 'INV-L-0388', date: '2026-07-20', cust: 'C-0045', agent: 'FO', total: '4800.00', due: '2026-08-19', receipts: [['2026-08-18', '4800.00']] },
  { no: 'INV-L-0301', date: '2026-07-03', cust: 'C-0012', agent: 'AR', total: '14300.00', due: '2026-08-02', receipts: [['2026-07-30', '14300.00']] },
  { no: 'INV-L-0419', date: '2026-07-12', cust: 'C-0031', agent: 'LWJ', due: '2026-08-11', lines: [{ spec: ['CH-DIN-01', 40, '240.00'] }], receipts: [['2026-08-10', '10560.00']] },
  { no: 'INV-L-0350', date: '2026-05-03', cust: 'C-0031', agent: 'LWJ', due: '2026-06-02', lines: [{ spec: ['CH-BAR-01', 20, '185.00'] }], receipts: [['2026-05-30', '4070.00']] },
  ...[
    ['INV-L-0331', '2026-06-04', 'C-0012', 'AR', '9900.00'], ['INV-L-0334', '2026-06-09', 'C-0056', 'FO', '3740.00'], ['INV-L-0338', '2026-06-16', 'C-0031', 'LWJ', '7480.00'],
    ['INV-L-0342', '2026-06-25', 'C-0078', 'FO', '3960.00'], ['INV-L-0347', '2026-07-01', 'C-0045', 'FO', '5280.00'], ['INV-L-0359', '2026-07-08', 'C-0012', 'AR', '11550.00'],
    ['INV-L-0363', '2026-07-15', 'C-0056', 'FO', '2860.00'], ['INV-L-0368', '2026-07-24', 'C-0031', 'LWJ', '8140.00'], ['INV-L-0371', '2026-07-28', 'C-0078', 'FO', '2420.00'],
    ['INV-L-0380', '2026-08-03', 'C-0012', 'AR', '6600.00'],
  ].map(([no, date, cust, ag, total]) => ({
    no: no!, date: date!, cust: cust!, agent: ag!, total, due: new Date(day(date!).getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
    receipts: [[new Date(day(date!).getTime() + 25 * 86_400_000).toISOString().slice(0, 10), total!]] as [string, string][],
  })),
];

const invLineIds = new Map<string, string>();
const receipts: { no: string; date: string; cust: string; type: string; applies: string; amount: string }[] = [];

async function seedInvoices(ctx: SeedCtx): Promise<void> {
  for (const v of INVOICES) {
    const c = customer(ctx, v.cust);
    const lines = (v.lines ?? []).map((l) => ({ seed: l, line: saleLine(ctx, l.spec, 'EXCLUSIVE', c.priceListCode), id: randomUUID() }));
    const migrated = v.no.includes('-L-');
    const fromLines = totalsOf(lines.map((l) => l.line));
    const headerTotals = v.total && (migrated && (v.lines === undefined || v.no === 'INV-L-0412'))
      ? { subtotal: roundMoney(dec(v.total).div('1.1')), discountTotal: dec(0), taxTotal: dec(v.total).sub(roundMoney(dec(v.total).div('1.1'))), rounding: dec(0), total: dec(v.total) }
      : fromLines;
    const status = v.status ?? 'RELEASED';
    const released = status === 'RELEASED';
    const at = kl(v.date, v.no === 'INV-0001' ? '13:58' : '09:00');
    const row = await ctx.prisma.salInvoice.create({
      data: {
        tenantId: ctx.tenantId, docNo: v.no, docDate: day(v.date), status, kind: v.kind ?? (v.so ? 'FROM_ORDER' : 'DIRECT'), branchCode: c.branchCode,
        ...party(ctx, v.cust), billTo: c.billingAddress, contactName: c.contactName, ...agent(ctx, v.agent), creditTermDays: c.creditTermDays,
        dueDate: v.due ? day(v.due) : null, currency: 'MYR', taxMode: 'EXCLUSIVE',
        salesOrderId: v.so ? doc(ctx, v.so).id : null, salesOrderNo: v.so ?? null, deliveryNos: v.delivery ?? null,
        customerPoRef: v.so === 'SO-0001' ? 'HSB-PO-2231' : null, note: v.note ?? null,
        ...headerTotals, creditedAmount: dec(v.credited ?? 0), debitedAmount: dec(0), depositApplied: dec(v.deposit ?? 0), proformaNo: v.proforma ?? null,
        approvalRequired: status === 'PENDING_APPROVAL',
        releasedAt: released ? kl(v.date, v.no === 'INV-0001' ? '14:02' : '16:00') : null, releasedByCode: released ? v.agent : null,
        emailedAt: v.emailed ?? null, isMigrated: migrated, ...audit(v.agent, at),
        lines: {
          create: lineNo(lines).map(({ seed, line: l, id, lineNo: n }) => ({
            id, tenantId: ctx.tenantId, lineNo: n, soLineId: v.so ? soLine(v.so, l.itemCode) : null,
            deliveryLineId: v.delivery ? (doLineIds.get(`${v.delivery}:${l.itemCode}`) ?? null) : null,
            itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxRate: l.taxRate,
            qty: l.qty, listPrice: l.listPrice, unitPrice: l.unitPrice, discountPct: l.discountPct, grossAmount: l.grossAmount,
            discountAmount: l.discountAmount, amount: l.amount, taxAmount: l.taxAmount, returnedQty: dec(seed.returned ?? 0),
          })),
        },
      },
    });
    for (const l of lines) invLineIds.set(`${v.no}:${l.line.itemCode}`, l.id);
    remember(ctx, v.no, SAL_ENTITY.INVOICE, row.id);
    for (const [date, amount] of v.receipts ?? []) receipts.push({ no: `OR-${String(receipts.length + 1).padStart(4, '0')}`, date, cust: v.cust, type: 'INVOICE', applies: v.no, amount });
  }
}

// ── Proformas ───────────────────────────────────────────────────────────────

const PROFORMAS = [
  { no: 'PF-0001', date: '2026-09-22', so: 'SO-0004', cust: 'C-0056', agent: 'FO', kind: 'DEPOSIT_PCT', pct: '50', status: 'USED' as const, payBy: '2026-09-22', paid: '2026-09-22', used: 'INV-0002' },
  { no: 'PF-0002', date: '2026-09-26', so: 'SO-0002', cust: 'C-0045', agent: 'FO', kind: 'PAY_BEFORE_RELEASE', pct: null, status: 'SENT' as const, payBy: '2026-10-02' },
  { no: 'PF-0003', date: '2026-09-27', so: 'SO-0003', cust: 'C-0012', agent: 'AR', kind: 'DEPOSIT_PCT', pct: '30', status: 'PAID' as const, payBy: '2026-10-02', paid: '2026-09-28' },
  { no: 'PF-0004', date: '2026-09-29', so: 'SO-0007', cust: 'C-0102', agent: 'AR', kind: 'DEPOSIT_PCT', pct: '30', status: 'DRAFT' as const, payBy: '2026-10-05', note: 'Delivery is scheduled once the deposit is received.' },
];

async function seedProformas(ctx: SeedCtx): Promise<void> {
  for (const p of PROFORMAS) {
    const c = customer(ctx, p.cust);
    const so = await ctx.prisma.salSalesOrder.findFirstOrThrow({ where: { tenantId: ctx.tenantId, docNo: p.so } });
    const amount = p.pct ? roundMoney(so.total.mul(dec(p.pct)).div(100)) : so.total;
    const row = await ctx.prisma.salProforma.create({
      data: {
        tenantId: ctx.tenantId, docNo: p.no, docDate: day(p.date), status: p.status, branchCode: c.branchCode, ...party(ctx, p.cust),
        attention: c.contactName, ...agent(ctx, p.agent), salesOrderId: so.id, salesOrderNo: p.so, payBy: day(p.payBy), currency: 'MYR',
        requestKind: p.kind, depositPct: p.pct ? dec(p.pct) : null, orderSubtotal: so.subtotal.sub(so.discountTotal), orderTax: so.taxTotal, orderTotal: so.total, amount,
        usedOnInvoice: p.used ?? null, usedAt: p.used ? kl(p.date, '16:00') : null, note: p.note ?? null,
        releasedAt: p.status === 'DRAFT' ? null : kl(p.date, '09:35'), releasedByCode: p.status === 'DRAFT' ? null : p.agent,
        ...audit(p.agent, kl(p.date, '09:30')),
      },
    });
    remember(ctx, p.no, SAL_ENTITY.PROFORMA, row.id);
    if (p.paid) receipts.push({ no: `OR-${String(receipts.length + 1).padStart(4, '0')}`, date: p.paid, cust: p.cust, type: 'PROFORMA', applies: p.no, amount: toMoney(amount) });
  }
}

// ── Cancel orders ───────────────────────────────────────────────────────────

const CANCELS = [
  { no: 'CO-0002', date: '2026-09-29', so: 'SO-0006', cust: 'C-0078', by: 'FO', status: 'DRAFT' as const, reason: 'Customer changed requirement', summary: '15 of 25 office chairs',
    askedBy: 'Dr. Nurul Huda', ref: 'Email, 28 Sep 2026', note: 'Clinic renovation reduced to one floor. Keep the 10 chairs already delivered.',
    lines: [['CH-OFF-02', '300.00', 25, 10, 10, 15]] as [string, string, number, number, number, number][] },
  { no: 'CO-0001', date: '2026-09-16', so: 'SO-L-0981', cust: 'C-0056', by: 'FO', status: 'RELEASED' as const, reason: 'Item discontinued', summary: '4 dining chairs', releasedBy: 'NA',
    lines: [['CH-DIN-01', '250.00', 24, 20, 20, 4]] as [string, string, number, number, number, number][] },
  { no: 'CO-L-0044', date: '2026-09-02', so: 'SO-L-0952', cust: 'C-0031', by: 'LWJ', status: 'RELEASED' as const, reason: 'Cancelled before delivery', summary: 'Whole order · 12 stools', releasedBy: 'NA',
    lines: [['ST-BAR-02', '100.00', 12, 0, 0, 12]] as [string, string, number, number, number, number][] },
  { no: 'CO-L-0041', date: '2026-08-20', so: 'SO-L-0930', cust: 'C-0045', by: 'FO', status: 'RELEASED' as const, reason: 'Out of stock, customer agreed', summary: '6 of 30 tables', releasedBy: 'NA',
    lines: [['TB-RST-04', '400.00', 30, 24, 24, 6]] as [string, string, number, number, number, number][] },
];

async function seedCancelOrders(ctx: SeedCtx): Promise<void> {
  for (const k of CANCELS) {
    const c = customer(ctx, k.cust);
    const lines = k.lines.map(([code, price, ordered, delivered, invoiced, cancel]) => ({ l: saleLine(ctx, [code, cancel, price]), ordered, delivered, invoiced, cancel }));
    const t = totalsOf(lines.map((x) => x.l));
    const released = k.status === 'RELEASED';
    const row = await ctx.prisma.salCancelOrder.create({
      data: {
        tenantId: ctx.tenantId, docNo: k.no, docDate: day(k.date), status: k.status, branchCode: c.branchCode,
        salesOrderId: doc(ctx, k.so).id, salesOrderNo: k.so, customerCode: c.code, customerName: c.name, reason: k.reason,
        askedBy: k.askedBy ?? null, customerRef: k.ref ?? null, summary: k.summary, note: k.note ?? null,
        subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total,
        releasedAt: released ? kl(k.date, '15:00') : null, releasedByCode: released ? (k.releasedBy ?? null) : null,
        isMigrated: k.no.includes('-L-'), ...audit(k.by, kl(k.date, '09:00')),
        lines: {
          create: lines.map(({ l, ordered, delivered, invoiced, cancel }, i) => ({
            tenantId: ctx.tenantId, lineNo: i + 1, soLineId: soLine(k.so, l.itemCode), itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName,
            uomCode: l.uomCode, taxCode: l.taxCode, taxRate: l.taxRate, unitPrice: l.unitPrice, orderedQty: dec(ordered), deliveredQty: dec(delivered),
            invoicedQty: dec(invoiced), balanceQty: dec(ordered - delivered), cancelQty: dec(cancel), amount: l.amount, taxAmount: l.taxAmount,
          })),
        },
      },
    });
    remember(ctx, k.no, SAL_ENTITY.CANCEL_ORDER, row.id);
  }
}

// ── Cash sales ──────────────────────────────────────────────────────────────

const CASH_SALES = [
  { no: 'CS-0004', date: '2026-09-29', time: '16:10', buyer: 'Encik Amir', phone: '+60 12-448 1200', method: 'CARD', ref: 'Terminal 2 · approval 448120', status: 'DRAFT' as const, lines: [['CH-DIN-01', 2, '275.00']] as LineSpec[] },
  { no: 'CS-0003', date: '2026-09-28', time: '15:20', buyer: 'Encik Faizal Hakim', tin: 'IG50012345080', own: true, method: 'DUITNOW', status: 'RELEASED' as const, lines: [['TB-COF-01', 1, '1320.00']] as LineSpec[] },
  { no: 'CS-0002', date: '2026-09-27', time: '11:45', method: 'CASH', status: 'RELEASED' as const, lines: [['ST-BAR-02', 4, '110.00']] as LineSpec[] },
  { no: 'CS-0001', date: '2026-09-26', time: '14:30', method: 'CARD', ref: 'Terminal 1 · approval 440913', status: 'RELEASED' as const, lines: [['TB-BED-01', 2, '308.00']] as LineSpec[] },
  { no: 'CS-L-0231', date: '2026-09-24', time: '12:00', method: 'CARD', status: 'RELEASED' as const, lines: [['CH-DIN-01', 6, '275.00']] as LineSpec[] },
  { no: 'CS-L-0230', date: '2026-09-24', time: '10:30', buyer: 'Puan Rohani', method: 'DUITNOW', status: 'RELEASED' as const, lines: [['CB-SHO-01', 1, '385.00']] as LineSpec[] },
];

/** The other 32 September cash sales from the old system (invented): amounts by payment method. */
const OLD_CASH: [method: string, amounts: number[]][] = [
  ['CARD', [550, 616, 385, 440, 275, 660, 495, 330, 1100, 385, 550, 220, 330, 686]],
  ['DUITNOW', [385, 550, 440, 275, 616, 330, 495, 660, 409]],
  ['CASH', [220, 330, 275, 385, 440, 165, 330, 275, 357]],
];

async function seedCashSales(ctx: SeedCtx): Promise<void> {
  const cash = customer(ctx, 'C-CASH');
  const server = user(ctx, 'SC1');
  const create = async (s: { no: string; date: string; time: string; buyer?: string; phone?: string; tin?: string; own?: boolean; method: string; ref?: string; status: 'DRAFT' | 'RELEASED'; lines?: LineSpec[]; total?: string }) => {
    const lines = (s.lines ?? []).map((l) => saleLine(ctx, l, 'INCLUSIVE'));
    const t = s.lines ? totalsOf(lines, 'INCLUSIVE') : (() => {
      const total = dec(s.total!);
      const tax = roundMoney(total.mul('0.1').div('1.1'));
      return { subtotal: total.sub(tax), discountTotal: dec(0), taxTotal: tax, rounding: dec(0), total };
    })();
    const at = kl(s.date, s.time);
    const row = await ctx.prisma.salCashSale.create({
      data: {
        tenantId: ctx.tenantId, docNo: s.no, docDate: day(s.date), status: s.status, branchCode: 'HQ', counterName: 'HQ Shah Alam showroom counter',
        customerId: cash.id, customerCode: cash.code, customerName: cash.name, servedByCode: server.code, servedByName: server.name,
        buyerName: s.buyer ?? null, buyerPhone: s.phone ?? null, buyerTin: s.tin ?? null, ownEInvoice: s.own ?? false, warehouseCode: 'HQ-MAIN',
        taxMode: 'INCLUSIVE', currency: 'MYR', paymentMethod: s.method, paymentRef: s.ref ?? null, amountReceived: t.total, changeAmount: dec(0),
        summary: lines.length ? lines.map((l) => `${l.itemName} ×${plain(l.qty)}`).join(', ') : 'Sale from the old system',
        ...t, releasedAt: s.status === 'RELEASED' ? at : null, releasedByCode: s.status === 'RELEASED' ? server.code : null,
        isMigrated: s.no.includes('-L-'), ...audit(server.code, at),
        lines: {
          create: lineNo(lines).map((l) => ({
            tenantId: ctx.tenantId, lineNo: l.lineNo, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode,
            taxRate: l.taxRate, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, grossAmount: l.grossAmount, discountAmount: l.discountAmount,
            amount: l.amount, taxAmount: l.taxAmount,
          })),
        },
      },
    });
    remember(ctx, s.no, SAL_ENTITY.CASH_SALE, row.id);
  };
  for (const s of CASH_SALES) await create(s);
  let n = 198;
  let dayOfMonth = 1;
  for (const [method, amounts] of OLD_CASH) {
    for (const a of amounts) {
      const date = `2026-09-${String(dayOfMonth).padStart(2, '0')}`;
      await create({ no: `CS-L-0${n++}`, date, time: '13:00', method, status: 'RELEASED', total: `${a}.00` });
      dayOfMonth = dayOfMonth >= 23 ? 1 : dayOfMonth + 1;
    }
  }
}

// ── Debit notes ─────────────────────────────────────────────────────────────

async function seedDebitNotes(ctx: SeedCtx): Promise<void> {
  const notes = [
    { no: 'DN-0001', date: '2026-09-29', invoice: 'INV-0001', cust: 'C-0012', by: 'AR', status: 'DRAFT' as const, reason: 'Extra service requested', summary: 'Extra delivery trip, Klang Valley',
      due: '2026-10-21', note: 'Second delivery trip requested by customer on 27 Sep 2026.', lines: [['SV-DEL-01', 1, '350.00']] as LineSpec[] },
    { no: 'DN-L-0033', date: '2026-09-10', invoice: 'INV-L-0398', cust: 'C-0031', by: 'LWJ', status: 'RELEASED' as const, reason: 'Price correction', summary: 'Price under-billed on 6 tables', total: '180.00' },
    { no: 'DN-L-0029', date: '2026-08-28', invoice: 'INV-L-0376', cust: 'C-0045', by: 'FO', status: 'RELEASED' as const, reason: 'Extra service requested', summary: 'Rush delivery charge', total: '250.00' },
  ];
  for (const d of notes) {
    const c = customer(ctx, d.cust);
    const lines = (d.lines ?? []).map((l) => saleLine(ctx, l));
    const t = d.lines ? totalsOf(lines) : { subtotal: dec(d.total!), taxTotal: dec(0), total: dec(d.total!) };
    const row = await ctx.prisma.salDebitNote.create({
      data: {
        tenantId: ctx.tenantId, docNo: d.no, docDate: day(d.date), status: d.status, branchCode: c.branchCode, ...party(ctx, d.cust),
        invoiceId: doc(ctx, d.invoice).id, invoiceNo: d.invoice, dueDate: d.due ? day(d.due) : null, reason: d.reason, summary: d.summary, note: d.note ?? null,
        subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total,
        releasedAt: d.status === 'RELEASED' ? kl(d.date, '11:00') : null, releasedByCode: d.status === 'RELEASED' ? d.by : null,
        isMigrated: d.no.includes('-L-'), ...audit(d.by, kl(d.date, '09:30')),
        lines: {
          create: lineNo(lines).map((l) => ({
            tenantId: ctx.tenantId, lineNo: l.lineNo, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
            taxCode: l.taxCode, taxRate: l.taxRate, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, taxAmount: l.taxAmount,
          })),
        },
      },
    });
    remember(ctx, d.no, SAL_ENTITY.DEBIT_NOTE, row.id);
  }
}

// ── Sales returns ───────────────────────────────────────────────────────────

async function seedReturns(ctx: SeedCtx): Promise<void> {
  const returns = [
    { no: 'SR-0002', date: '2026-09-29', invoice: 'INV-0002', so: 'SO-0004', cust: 'C-0056', by: 'FO', status: 'DRAFT' as const, reason: 'Scratched top', goodsTo: 'DAMAGED', wh: 'HQ-DMG', loc: 'HQ-DMG/Q-01',
      summary: '1 dining table', invoiced: 7, before: 0, line: ['TB-RST-04', 1, '850.00'] as LineSpec },
    { no: 'SR-0001', date: '2026-09-24', invoice: 'INV-0001', so: 'SO-0001', cust: 'C-0012', by: 'AR', status: 'RELEASED' as const, reason: 'Damaged in transit', goodsTo: 'DAMAGED', wh: 'HQ-DMG', loc: 'HQ-DMG/Q-01',
      summary: '5 dining chairs', ref: 'HSB-RMA-014', note: '5 chairs with cracked back rails. Photos attached by the receiver.', invoiced: 60, before: 0, line: ['CH-DIN-01', 5, '250.00'] as LineSpec },
    { no: 'SR-L-0019', date: '2026-09-05', invoice: 'INV-L-0412', so: null, cust: 'C-0045', by: 'FO', status: 'RELEASED' as const, reason: 'Wrong colour', goodsTo: 'STOCK', wh: 'HQ-MAIN', loc: 'HQ-MAIN/B-01',
      summary: '2 office chairs', invoiced: 2, before: 0, line: ['CH-OFF-02', 2, '270.00'] as LineSpec },
  ];
  for (const r of returns) {
    const c = customer(ctx, r.cust);
    const l = saleLine(ctx, r.line);
    const t = totalsOf([l]);
    const row = await ctx.prisma.salReturn.create({
      data: {
        tenantId: ctx.tenantId, docNo: r.no, docDate: day(r.date), status: r.status, branchCode: c.branchCode, ...party(ctx, r.cust),
        invoiceId: doc(ctx, r.invoice).id, invoiceNo: r.invoice, salesOrderNo: r.so, reason: r.reason, goodsTo: r.goodsTo, warehouseCode: r.wh, locationCode: r.loc,
        creditMethod: 'CREDIT_NOTE', customerRef: r.ref ?? null, summary: r.summary, note: r.note ?? null,
        subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total,
        releasedAt: r.status === 'RELEASED' ? kl(r.date, '11:42') : null, releasedByCode: r.status === 'RELEASED' ? r.by : null,
        isMigrated: r.no.includes('-L-'), ...audit(r.by, kl(r.date, '11:40'), r.status === 'RELEASED' ? kl(r.date, '11:42') : undefined),
        lines: {
          create: [{
            tenantId: ctx.tenantId, lineNo: 1, invoiceLineId: invLineIds.get(`${r.invoice}:${l.itemCode}`) ?? null, itemId: l.itemId, itemCode: l.itemCode,
            itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxRate: l.taxRate, invoicedQty: dec(r.invoiced), returnedBeforeQty: dec(r.before),
            qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, taxAmount: l.taxAmount,
          }],
        },
      },
    });
    remember(ctx, r.no, SAL_ENTITY.RETURN, row.id);
  }
}

// ── Payments (Finance stub) ─────────────────────────────────────────────────

async function seedReceipts(ctx: SeedCtx): Promise<void> {
  await ctx.prisma.finReceiptStub.createMany({
    data: receipts.map((r) => ({
      tenantId: ctx.tenantId, receiptNo: r.no, receiptDate: day(r.date), customerCode: r.cust, appliesToType: r.type, appliesToNo: r.applies,
      amount: dec(r.amount), method: r.type === 'PROFORMA' ? 'TRANSFER' : 'CHEQUE', note: null,
    })),
  });
}

// ── Approvals ───────────────────────────────────────────────────────────────

interface SalApproval {
  docNo: string; title: string; reason: string; note?: string; amount: string; by: string; at: Date; role: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; decidedAt?: Date; comment?: string;
}

const SALES_APPROVALS: SalApproval[] = [
  {
    docNo: 'SO-0002', title: 'SO-0002 · Syarikat Delta Trading', amount: '4400.00', by: 'FO', at: kl('2026-09-26', '15:14'), role: 'SALES_MANAGER', status: 'PENDING',
    reason: 'Credit limit over by RM 2,400.00 · overdue limit over by RM 2,000.00', note: 'Long-standing customer. They promised RM 5,000.00 by cheque on 2 Oct.',
  },
  {
    docNo: 'SO-0008', title: 'SO-0008 · Kedai Perabot Maju', amount: '92378.00', by: 'LWJ', at: kl('2026-09-28', '11:20'), role: 'SALES_MANAGER', status: 'PENDING',
    reason: 'Credit limit over by RM 50,778.00 · from enquiry EQ-2609-0009', note: 'Big restock for two showrooms. They pay in 30 days and have never missed a payment.',
  },
  {
    docNo: 'INV-0003', title: 'INV-0003 · Klinik Sihat Jaya', amount: '2904.00', by: 'FO', at: kl('2026-09-29', '09:05'), role: 'SALES_MANAGER', status: 'PENDING',
    reason: 'Unit price 12% below the price list on 1 line', note: 'Same price as their last order; they compared with another supplier.',
  },
  { docNo: 'QT-0010', title: 'QT-0010 · Restoran Selera Kampung', amount: '12540.00', by: 'FO', at: kl('2026-09-25', '16:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-09-28', '10:15'), reason: 'Discount 18%, above 15% rule', comment: 'OK for the tables only, as discussed.' },
  { docNo: 'SO-0006', title: 'SO-0006 · Klinik Sihat Jaya', amount: '8250.00', by: 'FO', at: kl('2026-09-25', '09:40'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-09-25', '11:00'), reason: 'Overdue limit, Klinik Sihat Jaya', comment: 'They paid part of the overdue amount this week.' },
  { docNo: 'INV-L-0398', title: 'INV-L-0398 · Kedai Perabot Maju', amount: '6400.00', by: 'LWJ', at: kl('2026-09-24', '09:00'), role: 'SALES_MANAGER', status: 'REJECTED', decidedAt: kl('2026-09-24', '15:30'), reason: 'Price 20% below price list', comment: 'Too low. Bill the agreed price and raise a debit note for the difference.' },
  { docNo: 'SO-0004', title: 'SO-0004 · Restoran Selera Kampung', amount: '13090.00', by: 'FO', at: kl('2026-09-22', '09:10'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-09-22', '10:30'), reason: 'Credit limit, Restoran Selera Kampung', comment: 'Approved. Half is paid up front on PF-0001.' },
  // Older decisions (invented): 9 more approvals and 1 rejection
  { docNo: 'SO-L-0930', title: 'SO-L-0930 · Syarikat Delta Trading', amount: '13200.00', by: 'FO', at: kl('2026-08-12', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-08-12', '11:00'), reason: 'Credit limit, Syarikat Delta Trading', comment: 'Approved once.' },
  { docNo: 'SO-L-0981', title: 'SO-L-0981 · Restoran Selera Kampung', amount: '6600.00', by: 'FO', at: kl('2026-08-25', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-08-25', '10:00'), reason: 'Credit limit, Restoran Selera Kampung' },
  { docNo: 'SO-L-0921', title: 'SO-L-0921 · Hotel Seri Bayu Sdn Bhd', amount: '8800.00', by: 'AR', at: kl('2026-07-30', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-07-30', '10:00'), reason: 'Discount 16%, above 15% rule' },
  { docNo: 'SO-L-0915', title: 'SO-L-0915 · Kedai Perabot Maju', amount: '10560.00', by: 'LWJ', at: kl('2026-07-22', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-07-22', '12:00'), reason: 'Credit limit, Kedai Perabot Maju' },
  { docNo: 'SO-L-0904', title: 'SO-L-0904 · Syarikat Delta Trading', amount: '5280.00', by: 'FO', at: kl('2026-07-10', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-07-10', '10:30'), reason: 'Overdue limit, Syarikat Delta Trading' },
  { docNo: 'SO-L-0899', title: 'SO-L-0899 · Hotel Seri Bayu Sdn Bhd', amount: '14355.00', by: 'AR', at: kl('2026-07-02', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-07-02', '09:45'), reason: 'Credit limit, Hotel Seri Bayu' },
  { docNo: 'SO-L-0887', title: 'SO-L-0887 · Klinik Sihat Jaya', amount: '3960.00', by: 'FO', at: kl('2026-06-24', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-06-24', '10:00'), reason: 'Overdue limit, Klinik Sihat Jaya' },
  { docNo: 'SO-L-0876', title: 'SO-L-0876 · Restoran Selera Kampung', amount: '3740.00', by: 'FO', at: kl('2026-06-15', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-06-15', '10:00'), reason: 'Credit limit, Restoran Selera Kampung' },
  { docNo: 'SO-L-0862', title: 'SO-L-0862 · Kedai Perabot Maju', amount: '4070.00', by: 'LWJ', at: kl('2026-06-03', '09:00'), role: 'SALES_MANAGER', status: 'APPROVED', decidedAt: kl('2026-06-03', '10:00'), reason: 'Discount 17%, above 15% rule' },
  { docNo: 'QT-L-0101', title: 'QT-L-0101 · Kedai Perabot Maju', amount: '14575.00', by: 'LWJ', at: kl('2026-09-08', '10:00'), role: 'SALES_MANAGER', status: 'REJECTED', decidedAt: kl('2026-09-08', '15:00'), reason: 'Discount 22%, above 15% rule', comment: 'Too deep. Offer 10% at most.' },
];

async function seedSalesApprovals(ctx: SeedCtx): Promise<void> {
  const approver = user(ctx, 'NA');
  for (const a of SALES_APPROVALS) {
    const target = doc(ctx, a.docNo);
    const requester = user(ctx, a.by);
    await ctx.prisma.sysApprovalRequest.create({
      data: {
        tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, docNo: a.docNo, branchCode: requester.code === 'LWJ' ? 'PNG' : 'HQ',
        amount: dec(a.amount), title: a.title, reason: a.reason, requesterNote: a.note ?? null, requestedByCode: requester.code, requestedByName: requester.name,
        status: a.status, currentStep: 1, createdAt: a.at, decidedAt: a.decidedAt ?? null,
        steps: {
          create: [{
            tenantId: ctx.tenantId, stepNo: 1, approverRole: a.role, approverCode: approver.code, approverName: approver.name,
            status: a.status === 'PENDING' ? 'WAITING' : a.status, decidedByCode: a.decidedAt ? approver.code : null, decidedByName: a.decidedAt ? approver.name : null,
            comment: a.comment ?? null, decidedAt: a.decidedAt ?? null,
          }],
        },
      },
    });
  }
}

// ── Activity ────────────────────────────────────────────────────────────────

type Act = [docNo: string, at: Date, by: string, action: string, message: string, comment?: string];

const SALES_ACTIVITY: Act[] = [
  // Main case — texts from SalesOrderForm, InvoiceForm and DocFlow
  ['EQ-2609-0006', kl('2026-09-18', '09:20'), 'AR', 'created', 'Recorded from an email by Aina Rahman'],
  ['QT-0001', kl('2026-09-18', '09:40'), 'AR', 'created', 'Created from EQ-2609-0006 by Aina Rahman'],
  ['QT-0001', kl('2026-09-18', '09:55'), 'AR', 'released', 'Released and emailed to zarina@hotelseribayu.my'],
  ['QT-0001', kl('2026-09-18', '10:05'), 'AR', 'ordered', 'Turned into SO-0001'],
  ['SO-0001', kl('2026-09-18', '10:05'), 'AR', 'created', 'Created from QT-0001 by Aina Rahman'],
  ['SO-0001', kl('2026-09-18', '10:06'), 'AR', 'credit_check', 'Credit check passed: owed RM 12,000.00 + this order RM 27,500.00 = RM 39,500.00 of RM 50,000.00'],
  ['SO-0001', kl('2026-09-18', '10:12'), 'AR', 'released', 'Released by Aina Rahman · event sales.order.released saved'],
  ['SO-0001', kl('2026-09-21', '09:30'), 'AR', 'delivered', 'DO-0001 confirmed: 60 delivered, balance 40'],
  ['SO-0001', kl('2026-09-21', '14:02'), 'AR', 'invoiced', 'INV-0001 released: 60 invoiced, RM 16,500.00'],
  ['DO-0001', kl('2026-09-21', '09:10'), 'AR', 'created', 'Created from SO-0001 by Aina Rahman'],
  ['DO-0001', kl('2026-09-21', '09:30'), 'AR', 'confirmed', 'Confirmed DO-0001, 60 chairs, driver Rahim · event saved for Inventory'],
  ['INV-0001', kl('2026-09-21', '13:58'), 'AR', 'created', 'Created from SO-0001 by Aina Rahman'],
  ['INV-0001', kl('2026-09-21', '14:02'), 'AR', 'released', 'Released · posting and e-Invoice queued'],
  ['INV-0001', kl('2026-09-21', '14:05'), 'AR', 'emailed', 'Emailed to zarina@hotelseribayu.my'],
  ['INV-0001', kl('2026-09-24', '11:42'), 'AR', 'credited', 'SR-0001 released: credit RM 1,375.00'],
  ['SR-0001', kl('2026-09-24', '11:40'), 'AR', 'created', 'Created from INV-0001 by Aina Rahman'],
  ['SR-0001', kl('2026-09-24', '11:42'), 'AR', 'released', 'Released SR-0001, 5 damaged chairs returned to Damaged goods · credit note queued'],
  ['DN-0001', kl('2026-09-29', '09:30'), 'AR', 'created', 'Created on INV-0001 by Aina Rahman'],
  // Credit approvals waiting
  ['SO-0002', kl('2026-09-26', '15:05'), 'FO', 'created', 'Created from QT-0009 by Faizal Omar'],
  ['SO-0002', kl('2026-09-26', '15:06'), 'FO', 'credit_check', 'Credit check did not pass: over the credit limit by RM 2,400.00 and the overdue limit by RM 2,000.00'],
  ['SO-0002', kl('2026-09-26', '15:14'), 'FO', 'approval_requested', 'Sent for approval to Nor Azlina', 'Long-standing customer. They promised RM 5,000.00 by cheque on 2 Oct.'],
  ['SO-0008', kl('2026-09-28', '11:10'), 'LWJ', 'created', 'Created from EQ-2609-0009 by Lim Wei Jie'],
  ['SO-0008', kl('2026-09-28', '11:12'), 'LWJ', 'credit_check', 'Credit check did not pass: over the credit limit by RM 50,778.00'],
  ['SO-0008', kl('2026-09-28', '11:20'), 'LWJ', 'approval_requested', 'Sent for approval to Nor Azlina'],
  ['INV-0003', kl('2026-09-29', '09:00'), 'FO', 'created', 'Created as a direct invoice by Faizal Omar'],
  ['INV-0003', kl('2026-09-29', '09:05'), 'FO', 'approval_requested', 'Price 12% below the price list · sent for approval to Nor Azlina'],
  // Other documents
  ['QT-0012', kl('2026-09-29', '09:30'), 'LWJ', 'created', 'Created from EQ-2609-0009 by Lim Wei Jie'],
  ['QT-0012', kl('2026-09-29', '09:31'), 'LWJ', 'credit_check', 'Over credit limit by RM 50,778.00 · quotations are allowed, the sales order will need approval'],
  ['QT-0010', kl('2026-09-25', '15:50'), 'FO', 'revised', 'Revision 1 created with an 18% discount on the tables'],
  ['QT-0010', kl('2026-09-25', '16:00'), 'FO', 'approval_requested', 'Discount 18% · sent for approval to Nor Azlina'],
  ['QT-0010', kl('2026-09-28', '10:15'), 'NA', 'approved', 'Approved by Nor Azlina', 'OK for the tables only, as discussed.'],
  ['QT-0010', kl('2026-09-28', '10:30'), 'FO', 'released', 'Released and emailed to ravi@selerakampung.my'],
  ['SO-0003', kl('2026-09-27', '10:00'), 'AR', 'created', 'Created from QT-0008 by Aina Rahman · buy to order'],
  ['SO-0003', kl('2026-09-27', '10:02'), 'AR', 'credit_check', 'Credit check passed'],
  ['SO-0003', kl('2026-09-27', '10:10'), 'AR', 'released', 'Released · Purchase drafted PO-0003 for the buy-to-order line'],
  ['SO-0004', kl('2026-09-22', '09:00'), 'FO', 'created', 'Created from QT-0003 by Faizal Omar'],
  ['SO-0004', kl('2026-09-22', '09:10'), 'FO', 'approval_requested', 'Over credit limit by RM 3,360.00 · sent for approval to Nor Azlina'],
  ['SO-0004', kl('2026-09-22', '10:30'), 'NA', 'approved', 'Approved by Nor Azlina', 'Approved. Half is paid up front on PF-0001.'],
  ['SO-0004', kl('2026-09-22', '10:40'), 'FO', 'released', 'Released by Faizal Omar'],
  ['DO-0002', kl('2026-09-22', '15:00'), 'FO', 'confirmed', 'Confirmed DO-0002, 12 pieces, driver Suresh'],
  ['INV-0002', kl('2026-09-22', '16:00'), 'FO', 'released', 'Released · deposit RM 6,545.00 from PF-0001 used'],
  ['PF-0001', kl('2026-09-22', '09:35'), 'FO', 'released', 'Released and emailed'],
  ['PF-0001', kl('2026-09-22', '14:00'), 'SYSTEM', 'paid', 'Deposit RM 6,545.00 received (recorded in Finance)'],
  ['PF-0001', kl('2026-09-22', '16:00'), 'FO', 'used', 'Used on INV-0002'],
  ['PF-0002', kl('2026-09-26', '09:35'), 'FO', 'released', 'Released and emailed'],
  ['PF-0003', kl('2026-09-27', '09:35'), 'AR', 'released', 'Released and emailed'],
  ['PF-0003', kl('2026-09-28', '11:00'), 'SYSTEM', 'paid', 'Deposit RM 21,120.00 received (recorded in Finance)'],
  ['PF-0004', kl('2026-09-29', '09:30'), 'AR', 'created', 'Created from SO-0007 by Aina Rahman'],
  ['SO-0005', kl('2026-09-23', '10:05'), 'LWJ', 'created', 'Created by Lim Wei Jie'],
  ['SO-0006', kl('2026-09-12', '10:05'), 'FO', 'created', 'Created by Faizal Omar'],
  ['SO-0006', kl('2026-09-12', '11:00'), 'FO', 'released', 'Released by Faizal Omar'],
  ['SO-0007', kl('2026-09-28', '13:50'), 'AR', 'created', 'Created from QT-0011 by Aina Rahman'],
  ['SO-0007', kl('2026-09-28', '14:00'), 'AR', 'released', 'Released by Aina Rahman · event sales.order.released saved'],
  ['DO-0003', kl('2026-09-29', '08:30'), 'AR', 'created', 'Created from SO-0007 by Aina Rahman'],
  ['CO-0002', kl('2026-09-29', '09:00'), 'FO', 'created', 'Created for SO-0006 by Faizal Omar'],
  ['CO-0001', kl('2026-09-16', '09:00'), 'FO', 'created', 'Created for SO-L-0981 by Faizal Omar'],
  ['CO-0001', kl('2026-09-16', '15:00'), 'NA', 'released', 'Released by Nor Azlina · 4 dining chairs cancelled'],
  ['SR-0002', kl('2026-09-29', '11:40'), 'FO', 'created', 'Created from INV-0002 by Faizal Omar'],
  ['CS-0004', kl('2026-09-29', '16:10'), 'SC1', 'created', 'Started at the HQ showroom counter'],
  ['CS-0003', kl('2026-09-28', '15:20'), 'SC1', 'released', 'Paid by DuitNow QR and released · own e-Invoice queued'],
  ['CS-0002', kl('2026-09-27', '11:45'), 'SC1', 'released', 'Paid in cash and released'],
  ['CS-0001', kl('2026-09-26', '14:30'), 'SC1', 'released', 'Paid by card and released'],
];

async function seedSalesActivity(ctx: SeedCtx): Promise<void> {
  const rows: Prisma.SysActivityCreateManyInput[] = SALES_ACTIVITY.map(([docNo, at, by, action, message, comment]) => {
    const target = doc(ctx, docNo);
    return { tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, docNo, action, message, comment: comment ?? null, userCode: by, userName: nameOf(ctx, by), createdAt: at };
  });
  for (const [docNo, target] of ctx.docs) {
    if (!target.type.startsWith('SAL_') || !docNo.includes('-L-')) continue;
    rows.push({
      tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, docNo, action: 'migrated',
      message: 'Brought over from the old system', userCode: 'SYSTEM', userName: 'System', createdAt: kl('2026-09-30', '23:00'),
    });
  }
  await ctx.prisma.sysActivity.createMany({ data: rows });
}

// ── Document links ──────────────────────────────────────────────────────────

const SALES_LINKS: [from: string, to: string, type: string][] = [
  ['EQ-2609-0006', 'QT-0001', SAL_LINK.QUOTED], ['QT-0001', 'SO-0001', SAL_LINK.ORDERED], ['SO-0001', 'DO-0001', SAL_LINK.DELIVERED],
  ['DO-0001', 'INV-0001', SAL_LINK.INVOICED], ['INV-0001', 'SR-0001', SAL_LINK.RETURNED], ['INV-0001', 'DN-0001', SAL_LINK.DEBITED],
  ['EQ-2609-0007', 'QT-0009', SAL_LINK.QUOTED], ['QT-0009', 'SO-0002', SAL_LINK.ORDERED], ['SO-0002', 'PF-0002', SAL_LINK.REQUESTED],
  ['EQ-2609-0003', 'QT-0008', SAL_LINK.QUOTED], ['QT-0008', 'SO-0003', SAL_LINK.ORDERED], ['SO-0003', 'PF-0003', SAL_LINK.REQUESTED],
  ['EQ-2609-0001', 'QT-0003', SAL_LINK.QUOTED], ['QT-0003', 'SO-0004', SAL_LINK.ORDERED], ['SO-0004', 'DO-0002', SAL_LINK.DELIVERED],
  ['DO-0002', 'INV-0002', SAL_LINK.INVOICED], ['SO-0004', 'PF-0001', SAL_LINK.REQUESTED], ['PF-0001', 'INV-0002', SAL_LINK.DEPOSIT_USED],
  ['INV-0002', 'SR-0002', SAL_LINK.RETURNED],
  ['QT-0011', 'SO-0007', SAL_LINK.ORDERED], ['SO-0007', 'DO-0003', SAL_LINK.DELIVERED], ['SO-0007', 'PF-0004', SAL_LINK.REQUESTED],
  ['EQ-2609-0009', 'QT-0012', SAL_LINK.QUOTED], ['EQ-2609-0009', 'SO-0008', SAL_LINK.ORDERED],
  ['EQ-2609-0004', 'QT-0005', SAL_LINK.QUOTED], ['EQ-2609-0002', 'QT-0004', SAL_LINK.QUOTED], ['EQ-2609-0005', 'QT-0010', SAL_LINK.QUOTED],
  ['SO-0006', 'DO-L-0388', SAL_LINK.DELIVERED], ['DO-L-0388', 'INV-L-0405', SAL_LINK.INVOICED], ['SO-0006', 'CO-0002', SAL_LINK.CANCELLED],
  ['SO-L-0981', 'CO-0001', SAL_LINK.CANCELLED], ['SO-L-0952', 'CO-L-0044', SAL_LINK.CANCELLED], ['SO-L-0930', 'CO-L-0041', SAL_LINK.CANCELLED],
  ['INV-L-0412', 'SR-L-0019', SAL_LINK.RETURNED], ['INV-L-0398', 'DN-L-0033', SAL_LINK.DEBITED], ['INV-L-0376', 'DN-L-0029', SAL_LINK.DEBITED],
];

async function seedSalesLinks(ctx: SeedCtx): Promise<void> {
  await ctx.prisma.sysDocLink.createMany({
    data: SALES_LINKS.map(([fromNo, toNo, linkType]) => {
      const from = doc(ctx, fromNo);
      const to = doc(ctx, toNo);
      return { tenantId: ctx.tenantId, fromType: from.type, fromId: from.id, fromNo, toType: to.type, toId: to.id, toNo, linkType };
    }),
  });
}

// ── Email log, outbox, attachments ──────────────────────────────────────────

async function seedSalesEmails(ctx: SeedCtx): Promise<void> {
  const t = SALES_EMAIL_TEMPLATES.find((x) => x.key === 'INVOICE')!;
  const vars = {
    'contact.name': 'Pn. Zarina Aziz', 'document.number': 'INV-0001', 'document.total': 'RM 16,500.00', 'document.due_date': '21 Oct 2026',
    'document.customer_ref': 'HSB-PO-2231', 'agent.name': 'Aina Rahman', 'agent.phone': '+60 12-301 8842', 'company.name': 'CLB Groups',
  };
  await ctx.prisma.sysEmailLog.create({
    data: {
      tenantId: ctx.tenantId, entityType: SAL_ENTITY.INVOICE, entityId: doc(ctx, 'INV-0001').id, docNo: 'INV-0001', templateKey: `SALES_${t.key}`,
      toAddress: 'zarina@hotelseribayu.my', ccAddress: 'aina@warehouse.com', subject: renderTemplate(t.subject, vars), body: renderTemplate(t.body, vars),
      sentByCode: 'AR', createdAt: kl('2026-09-21', '14:05'),
    },
  });
}

async function seedSalesOutbox(ctx: SeedCtx): Promise<void> {
  const events: Prisma.SysOutboxCreateManyInput[] = [];
  const push = (name: string, type: string, docNo: string, actor: string, at: Date, payload: Prisma.InputJsonValue) =>
    events.push({
      id: randomUUID(), tenantId: ctx.tenantId, name, version: 1, aggregateType: type, aggregateId: doc(ctx, docNo).id, payload, actorCode: actor,
      correlationId: randomUUID(), occurredAt: at, status: 'PENDING', attempts: 0, nextAttemptAt: at,
    });

  const orders = await ctx.prisma.salSalesOrder.findMany({ where: { tenantId: ctx.tenantId, isMigrated: false, releasedAt: { not: null } }, include: { lines: true } });
  for (const o of orders) {
    push(SAL_EVENT.ORDER_RELEASED, SAL_ENTITY.ORDER, o.docNo, o.releasedByCode!, o.releasedAt!, {
      soNo: o.docNo, branchCode: o.branchCode, customerCode: o.customerCode, customerName: o.customerName, deliveryWantedBy: o.deliveryWantedBy?.toISOString().slice(0, 10) ?? null,
      lines: o.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.orderedQty), isBuyToOrder: l.isBuyToOrder })),
    });
  }
  const deliveries = await ctx.prisma.salDelivery.findMany({ where: { tenantId: ctx.tenantId, isMigrated: false, status: 'CONFIRMED' }, include: { lines: true } });
  for (const d of deliveries) {
    push(SAL_EVENT.SHIPMENT_REQUESTED, SAL_ENTITY.DELIVERY, d.docNo, d.confirmedByCode!, d.confirmedAt!, {
      doNo: d.docNo, soNo: d.salesOrderNo, warehouseCode: d.warehouseCode, lines: d.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty) })),
    });
  }
  const invoices = await ctx.prisma.salInvoice.findMany({ where: { tenantId: ctx.tenantId, isMigrated: false, status: 'RELEASED' } });
  for (const v of invoices) {
    push(SAL_EVENT.INVOICE_RELEASED, SAL_ENTITY.INVOICE, v.docNo, v.releasedByCode!, v.releasedAt!, {
      invoiceNo: v.docNo, customerCode: v.customerCode, total: toMoney(v.total), taxTotal: toMoney(v.taxTotal), dueDate: v.dueDate?.toISOString().slice(0, 10) ?? null,
      depositApplied: toMoney(v.depositApplied), proformaNo: v.proformaNo,
    });
  }
  push(SAL_EVENT.RETURN_RELEASED, SAL_ENTITY.RETURN, 'SR-0001', 'AR', kl('2026-09-24', '11:42'), {
    returnNo: 'SR-0001', invoiceNo: 'INV-0001', credit: '1375.00', warehouseCode: 'HQ-DMG', locationCode: 'HQ-DMG/Q-01', lines: [{ itemCode: 'CH-DIN-01', uomCode: 'PCS', qty: '5.0000' }],
  });
  const cashSales = await ctx.prisma.salCashSale.findMany({ where: { tenantId: ctx.tenantId, isMigrated: false, status: 'RELEASED' }, include: { lines: true } });
  for (const s of cashSales) {
    push(SAL_EVENT.CASH_SALE_RELEASED, SAL_ENTITY.CASH_SALE, s.docNo, s.releasedByCode!, s.releasedAt!, {
      cashSaleNo: s.docNo, total: toMoney(s.total), paymentMethod: s.paymentMethod, ownEInvoice: s.ownEInvoice, warehouseCode: s.warehouseCode,
      lines: s.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty) })),
    });
  }
  await ctx.prisma.sysOutbox.createMany({ data: events });
}

const SALES_ATTACHMENTS: [docNo: string, fileName: string, kind: string, at: Date, by: string][] = [
  ['QT-0012', 'Penang-showrooms-layout.pdf', 'DRAWING', kl('2026-09-29', '09:35'), 'LWJ'],
  ['DO-0001', 'DO-0001-signed.jpg', 'PROOF_OF_DELIVERY', kl('2026-09-21', '15:10'), 'AR'],
  ['SR-0001', 'chair-crack-1.jpg', 'PHOTO', kl('2026-09-24', '11:38'), 'AR'],
  ['SR-0001', 'chair-crack-2.jpg', 'PHOTO', kl('2026-09-24', '11:38'), 'AR'],
];

export async function seedSalesAttachments(ctx: SeedCtx, uploadRoot: string): Promise<void> {
  const photo = await readFile(path.resolve(__dirname, '..', 'seed-assets', 'sample-photo.jpg'));
  for (const [docNo, fileName, kind, at, by] of SALES_ATTACHMENTS) {
    const target = doc(ctx, docNo);
    const id = randomUUID();
    const isPdf = fileName.endsWith('.pdf');
    const content = isPdf ? placeholderPdf(`${fileName.replace(/\.pdf$/, '')} (${docNo})`) : photo;
    const storageKey = `${ctx.tenantId}/2026/09/${id}${isPdf ? '.pdf' : '.jpg'}`;
    const absolute = path.join(uploadRoot, ...storageKey.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    await ctx.prisma.sysAttachment.create({
      data: {
        id, tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, kind, fileName,
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg', sizeBytes: content.length, storageKey, uploadedByCode: by, createdAt: at,
      },
    });
  }
}

export async function seedSalesDocuments(ctx: SeedCtx): Promise<void> {
  receipts.length = 0;
  soLineIds.clear();
  doLineIds.clear();
  invLineIds.clear();
  await seedEnquiries(ctx);
  await seedQuotations(ctx);
  await seedSalesOrders(ctx);
  await seedDeliveries(ctx);
  await seedInvoices(ctx);
  await seedProformas(ctx);
  await seedCancelOrders(ctx);
  await seedCashSales(ctx);
  await seedDebitNotes(ctx);
  await seedReturns(ctx);
  await seedReceipts(ctx);
  await seedSalesApprovals(ctx);
  await seedSalesActivity(ctx);
  await seedSalesLinks(ctx);
  await seedSalesEmails(ctx);
  await seedSalesOutbox(ctx);
}
