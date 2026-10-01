/**
 * Purchase requests, RFQs and purchase orders (SEED_DATA.md → "The main case" and "Other Purchase documents").
 * Running quantities on PO lines are seeded in their final state; verify.ts checks they agree with the
 * goods receipts, invoices, returns and cancellations seeded after them.
 *
 * Invented where the mockups are silent: request reasons other than PRQ-0001's, the losing replies on
 * RFQ-0002, RFQ-L-0058 and RFQ-L-0055, expected dates of drafts and old orders, quote references.
 */
import { randomUUID } from 'node:crypto';
import type { PurOrderSource, PurOrderStatus, PurRequestSource, PurRequestStatus, PurRfqStatus } from '@prisma/client';
import { dec } from '../../src/platform/http/decimal';
import { PUR_ENTITY } from '../../src/purchase/shared/purchase.constants';
import { audit, day, doc, headerTotals, kl, nameOf, pricedLine, remember, supplier, warehouse, type SeedCtx } from './util';

// ── Purchase requests ───────────────────────────────────────────────────────

interface RequestSeed {
  no: string; date: string; by: string; department: string; branch: string; neededBy: string;
  status: PurRequestStatus; source: PurRequestSource; summary: string; reason: string;
  lines: [itemCode: string, qty: number, lastPrice: string][];
  createdAt: Date; submittedAt?: Date; decidedAt?: Date; decidedBy?: string; rejectReason?: string; migrated?: boolean;
}

const REQUESTS: RequestSeed[] = [
  {
    no: 'PRQ-0006', date: '2026-09-29', by: 'RAH', department: 'Warehouse', branch: 'HQ', neededBy: '2026-10-10',
    status: 'DRAFT', source: 'DEMAND', summary: 'Wood screws ×20, lacquer ×8',
    reason: 'Below reorder level on the demand list: screws 5 left (reorder 20), lacquer 3 left (reorder 10).',
    lines: [['SC-WOD-08', 20, '18.00'], ['VR-LAC-01', 8, '95.00']], createdAt: kl('2026-09-29', '08:30'),
  },
  {
    no: 'PRQ-0005', date: '2026-09-29', by: 'SIT', department: 'Office', branch: 'HQ', neededBy: '2026-10-03',
    status: 'SUBMITTED', source: 'STAFF', summary: 'Printer toner ×6', reason: 'The office printers are out of toner.',
    lines: [['OF-TNR-01', 6, '90.00']], createdAt: kl('2026-09-29', '08:40'), submittedAt: kl('2026-09-29', '08:50'),
  },
  {
    no: 'PRQ-0004', date: '2026-09-28', by: 'RAH', department: 'Penang', branch: 'PNG', neededBy: '2026-10-05',
    status: 'CONVERTED', source: 'DEMAND', summary: 'Chair fabric ×60', reason: 'Penang upholstery stock is running low.',
    lines: [['FB-OAK-01', 60, '40.00']], createdAt: kl('2026-09-28', '09:00'), submittedAt: kl('2026-09-28', '09:05'),
    decidedAt: kl('2026-09-28', '14:20'), decidedBy: 'LMY',
  },
  {
    no: 'PRQ-0003', date: '2026-09-28', by: 'NUR', department: 'Production', branch: 'HQ', neededBy: '2026-10-05',
    status: 'CONVERTED', source: 'STAFF', summary: 'Seat foam sheet ×40', reason: 'Foam for the next batch of dining chairs.',
    lines: [['FM-SEA-05', 40, '35.00']], createdAt: kl('2026-09-28', '08:30'), submittedAt: kl('2026-09-28', '08:35'),
    decidedAt: kl('2026-09-28', '11:00'), decidedBy: 'LMY',
  },
  {
    no: 'PRQ-0002', date: '2026-09-24', by: 'HAF', department: 'Production', branch: 'HQ', neededBy: '2026-09-30',
    status: 'CONVERTED', source: 'STAFF', summary: 'Industrial sewing machine ×1', reason: 'A second industrial machine for the sofa line.',
    lines: [['MJ-IND-01', 1, '25000.00']], createdAt: kl('2026-09-24', '08:30'), submittedAt: kl('2026-09-24', '08:40'),
    decidedAt: kl('2026-09-24', '09:20'), decidedBy: 'LMY',
  },
  {
    no: 'PRQ-0001', date: '2026-09-22', by: 'RAH', department: 'Warehouse', branch: 'HQ', neededBy: '2026-09-30',
    status: 'CONVERTED', source: 'DEMAND', summary: 'Chair fabric ×100',
    reason: 'Fabric below reorder level (30 left, reorder at 50). Upholstery for SO-0001 chairs needs it next week.',
    lines: [['FB-OAK-01', 100, '40.00']], createdAt: kl('2026-09-22', '09:10'), submittedAt: kl('2026-09-22', '09:12'),
    decidedAt: kl('2026-09-22', '15:10'), decidedBy: 'LMY',
  },
  {
    no: 'PRQ-L-0144', date: '2026-09-18', by: 'SIT', department: 'Office', branch: 'HQ', neededBy: '2026-09-30',
    status: 'REJECTED', source: 'STAFF', summary: 'Standing desk ×4', reason: 'Standing desks for the office.',
    lines: [['OF-DSK-01', 4, '900.00']], createdAt: kl('2026-09-18', '10:00'), submittedAt: kl('2026-09-18', '10:05'),
    decidedAt: kl('2026-09-19', '11:00'), decidedBy: 'LMY', rejectReason: 'No budget', migrated: true,
  },
  {
    no: 'PRQ-L-0141', date: '2026-09-16', by: 'NUR', department: 'Production', branch: 'HQ', neededBy: '2026-09-20',
    status: 'CONVERTED', source: 'STAFF', summary: 'Lacquer 5 L ×12', reason: 'Lacquer for the finishing line.',
    lines: [['VR-LAC-01', 12, '95.00']], createdAt: kl('2026-09-16', '09:00'), submittedAt: kl('2026-09-16', '09:05'),
    decidedAt: kl('2026-09-18', '10:00'), decidedBy: 'LMY', migrated: true,
  },
  {
    no: 'PRQ-L-0139', date: '2026-09-10', by: 'HAF', department: 'Production', branch: 'HQ', neededBy: '2026-09-24',
    status: 'CONVERTED', source: 'STAFF', summary: 'Oak timber plank ×200', reason: 'Timber for the oak table frames.',
    lines: [['TM-OAK-01', 200, '45.00']], createdAt: kl('2026-09-10', '09:00'), submittedAt: kl('2026-09-10', '09:10'),
    decidedAt: kl('2026-09-10', '14:00'), decidedBy: 'LMY', migrated: true,
  },
];

async function seedRequests(ctx: SeedCtx): Promise<void> {
  for (const r of REQUESTS) {
    const lines = r.lines.map(([code, qty, price], i) => {
      const line = pricedLine(ctx, code, qty, price);
      const preferred = ctx.items.get(code)?.preferredSupplierCode ?? null;
      return {
        tenantId: ctx.tenantId,
        lineNo: i + 1,
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        uomCode: line.uomCode,
        taxCode: line.taxCode,
        taxRate: line.taxRate,
        unitPrice: line.unitPrice,
        qty: line.qty,
        estAmount: line.amount,
        preferredSupplierCode: preferred,
        preferredSupplierName: preferred ? supplier(ctx, preferred).name : null,
      };
    });
    const estValue = lines.reduce((sum, l) => sum.add(l.estAmount), dec(0));
    const row = await ctx.prisma.purRequest.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: r.no,
        docDate: day(r.date),
        status: r.status,
        branchCode: r.branch,
        requestedByCode: r.by,
        requestedByName: nameOf(ctx, r.by),
        department: r.department,
        neededBy: day(r.neededBy),
        source: r.source,
        reason: r.reason,
        summary: r.summary,
        estValue,
        rejectReason: r.rejectReason ?? null,
        submittedAt: r.submittedAt ?? null,
        decidedAt: r.decidedAt ?? null,
        decidedByCode: r.decidedBy ?? null,
        isMigrated: r.migrated ?? false,
        ...audit(r.by, r.createdAt, r.decidedAt ?? r.submittedAt ?? r.createdAt),
        lines: { create: lines },
      },
    });
    remember(ctx, r.no, PUR_ENTITY.REQUEST, row.id);
  }
}

// ── RFQs ────────────────────────────────────────────────────────────────────

interface ReplySeed {
  supplier: string; askedAt: Date; repliedAt?: Date; price?: string; leadDays?: number; moq?: number;
  validUntil?: string; quoteRef?: string; awarded?: boolean;
}

interface RfqSeed {
  no: string; date: string; status: PurRfqStatus; requestNo?: string; sourceNo?: string; summary: string;
  item: string; qty: number; neededBy?: string; replyBy: string; sentAt: Date; replies: ReplySeed[];
  awardedAt?: Date; awardReason?: string; closeReason?: string; migrated?: boolean;
}

const RFQS: RfqSeed[] = [
  {
    no: 'RFQ-0004', date: '2026-09-29', status: 'WAITING', summary: 'Teak veneer sheet ×50', item: 'VN-TEK-01', qty: 50,
    replyBy: '2026-10-02', sentAt: kl('2026-09-29', '09:30'),
    replies: ['S-0047', 'S-0009', 'S-0063'].map((s) => ({ supplier: s, askedAt: kl('2026-09-29', '09:30') })),
  },
  {
    no: 'RFQ-0003', date: '2026-09-28', status: 'WAITING', sourceNo: 'SO-0008', summary: 'Dining table, oak ×30',
    item: 'TB-DIN-06', qty: 30, replyBy: '2026-10-01', sentAt: kl('2026-09-28', '14:10'),
    replies: [
      { supplier: 'S-0047', askedAt: kl('2026-09-28', '14:10'), repliedAt: kl('2026-09-28', '17:05'), price: '1450.00', leadDays: 28, moq: 10, validUntil: '2026-10-28', quoteRef: 'PKT-Q-3307' },
      { supplier: 'S-0061', askedAt: kl('2026-09-28', '14:10') },
    ],
  },
  {
    no: 'RFQ-0002', date: '2026-09-24', status: 'AWARDED', requestNo: 'PRQ-0003', summary: 'Seat foam sheet ×40',
    item: 'FM-SEA-05', qty: 40, neededBy: '2026-10-05', replyBy: '2026-09-27', sentAt: kl('2026-09-24', '10:00'),
    awardedAt: kl('2026-09-28', '11:00'),
    replies: [
      { supplier: 'S-0034', askedAt: kl('2026-09-24', '10:00'), repliedAt: kl('2026-09-25', '11:00'), price: '35.00', leadDays: 14, moq: 20, validUntil: '2026-10-12', quoteRef: 'TUE-2609-131', awarded: true },
      { supplier: 'S-0021', askedAt: kl('2026-09-24', '10:00'), repliedAt: kl('2026-09-25', '15:00'), price: '37.00', leadDays: 10, moq: 40, validUntil: '2026-10-10', quoteRef: 'KKJ-Q-5530' },
      { supplier: 'S-0061', askedAt: kl('2026-09-24', '10:00'), repliedAt: kl('2026-09-26', '09:30'), price: '38.50', leadDays: 21, moq: 10, validUntil: '2026-10-15', quoteRef: 'KPS-Q-0772' },
    ],
  },
  {
    no: 'RFQ-0001', date: '2026-09-22', status: 'AWARDED', requestNo: 'PRQ-0001', summary: 'Chair fabric roll ×100',
    item: 'FB-OAK-01', qty: 100, neededBy: '2026-09-30', replyBy: '2026-09-23', sentAt: kl('2026-09-22', '15:10'),
    awardedAt: kl('2026-09-23', '10:48'),
    awardReason: 'Tekstil Utara is RM 200.00 cheaper but cannot deliver before 14 Oct. We need the fabric by 30 Sep for SO-0001 chairs.',
    replies: [
      { supplier: 'S-0021', askedAt: kl('2026-09-22', '15:10'), repliedAt: kl('2026-09-23', '09:15'), price: '40.00', leadDays: 7, moq: 50, validUntil: '2026-10-06', quoteRef: 'KKJ-Q-5512', awarded: true },
      { supplier: 'S-0034', askedAt: kl('2026-09-22', '15:10'), repliedAt: kl('2026-09-22', '17:42'), price: '38.00', leadDays: 21, moq: 100, validUntil: '2026-10-13', quoteRef: 'TUE-2609-114' },
    ],
  },
  {
    no: 'RFQ-L-0058', date: '2026-09-10', status: 'AWARDED', requestNo: 'PRQ-L-0139', summary: 'Oak timber plank ×200',
    item: 'TM-OAK-01', qty: 200, neededBy: '2026-09-24', replyBy: '2026-09-14', sentAt: kl('2026-09-10', '14:00'),
    awardedAt: kl('2026-09-14', '10:00'), migrated: true,
    replies: [
      { supplier: 'S-0047', askedAt: kl('2026-09-10', '14:00'), repliedAt: kl('2026-09-11', '10:00'), price: '45.00', leadDays: 14, moq: 100, validUntil: '2026-09-30', quoteRef: 'PKT-Q-3190', awarded: true },
      { supplier: 'S-0061', askedAt: kl('2026-09-10', '14:00'), repliedAt: kl('2026-09-12', '16:00'), price: '48.00', leadDays: 10, moq: 50, validUntil: '2026-09-30', quoteRef: 'KPS-Q-0731' },
    ],
  },
  {
    // The mockups date this RFQ before PRQ-L-0144 (18 Sep); kept as shown, linked by number only.
    no: 'RFQ-L-0055', date: '2026-09-02', status: 'CLOSED', sourceNo: 'PRQ-L-0144', summary: 'Standing desk ×4',
    item: 'OF-DSK-01', qty: 4, replyBy: '2026-09-06', sentAt: kl('2026-09-02', '11:00'), closeReason: 'Too costly', migrated: true,
    replies: [
      { supplier: 'S-0047', askedAt: kl('2026-09-02', '11:00'), repliedAt: kl('2026-09-03', '15:00'), price: '1050.00', leadDays: 21, moq: 1, validUntil: '2026-09-30', quoteRef: 'PKT-Q-3155' },
      { supplier: 'S-0061', askedAt: kl('2026-09-02', '11:00'), repliedAt: kl('2026-09-04', '10:00'), price: '1120.00', leadDays: 14, moq: 1, validUntil: '2026-09-30', quoteRef: 'KPS-Q-0719' },
    ],
  },
];

async function seedRfqs(ctx: SeedCtx): Promise<void> {
  for (const r of RFQS) {
    const winner = r.replies.find((x) => x.awarded);
    const snap = pricedLine(ctx, r.item, r.qty, 0);
    const lastActivity = r.awardedAt ?? r.replies.reduce<Date>((t, x) => (x.repliedAt && x.repliedAt > t ? x.repliedAt : t), r.sentAt);
    const rfq = await ctx.prisma.purRfq.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: r.no,
        docDate: day(r.date),
        status: r.status,
        branchCode: 'HQ',
        buyerCode: 'LMY',
        buyerName: nameOf(ctx, 'LMY'),
        requestId: r.requestNo ? doc(ctx, r.requestNo).id : null,
        sourceNo: r.requestNo ?? r.sourceNo ?? null,
        summary: r.summary,
        neededBy: r.neededBy ? day(r.neededBy) : null,
        replyBy: day(r.replyBy),
        sentAt: r.sentAt,
        awardedSupplierCode: winner?.supplier ?? null,
        awardedSupplierName: winner ? supplier(ctx, winner.supplier).name : null,
        awardReason: r.awardReason ?? null,
        awardedAt: r.awardedAt ?? null,
        awardedByCode: r.awardedAt ? 'LMY' : null,
        closeReason: r.closeReason ?? null,
        isMigrated: r.migrated ?? false,
        ...audit('LMY', r.sentAt, lastActivity),
        lines: {
          create: [{
            tenantId: ctx.tenantId, lineNo: 1, itemId: snap.itemId, itemCode: snap.itemCode, itemName: snap.itemName,
            uomCode: snap.uomCode, taxCode: snap.taxCode, taxRate: snap.taxRate, qty: snap.qty,
          }],
        },
      },
      include: { lines: true },
    });
    remember(ctx, r.no, PUR_ENTITY.RFQ, rfq.id);
    const rfqLine = rfq.lines[0]!;

    for (const reply of r.replies) {
      const s = supplier(ctx, reply.supplier);
      const replied = reply.repliedAt !== undefined && reply.price !== undefined;
      const row = await ctx.prisma.purRfqSupplier.create({
        data: {
          tenantId: ctx.tenantId,
          rfqId: rfq.id,
          supplierId: s.id,
          supplierCode: s.code,
          supplierName: s.name,
          email: s.email,
          replyToken: randomUUID(),
          status: replied ? 'REPLIED' : 'ASKED',
          askedAt: reply.askedAt,
          repliedAt: reply.repliedAt ?? null,
          leadTimeDays: reply.leadDays ?? null,
          paymentTermDays: replied ? s.paymentTermDays : null,
          validUntil: reply.validUntil ? day(reply.validUntil) : null,
          quoteRef: reply.quoteRef ?? null,
          isAwarded: reply.awarded ?? false,
          replyLines: replied
            ? { create: [{ tenantId: ctx.tenantId, rfqLineId: rfqLine.id, unitPrice: dec(reply.price!), minOrderQty: reply.moq === undefined ? null : dec(reply.moq) }] }
            : undefined,
        },
      });
      remember(ctx, `${r.no}/${s.code}`, PUR_ENTITY.RFQ_SUPPLIER, row.id);
    }
  }
}

// ── Purchase orders ─────────────────────────────────────────────────────────

interface PoLineSeed {
  item: string; qty: number; price: string; tax?: string; so?: string;
  received?: number; billed?: number; returned?: number; cancelled?: number;
}

interface PoSeed {
  no: string; date: string; supplier: string; branch: string; warehouse: string; status: PurOrderStatus; type: string;
  expected?: string; promised?: string; supplierSays?: string; source: PurOrderSource; sourceNo?: string;
  requestNo?: string; rfqNo?: string; so?: string; customer?: string; quoteRef?: string; note?: string;
  lines: PoLineSeed[]; createdAt: Date; createdBy: string; approvalRequired?: boolean; approvedAt?: Date;
  releasedAt?: Date; emailedAt?: Date; migrated?: boolean; remarks?: string;
}

const ORDERS: PoSeed[] = [
  {
    no: 'PO-0006', date: '2026-09-29', supplier: 'S-0009', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'DRAFT', type: 'STD',
    expected: '2026-10-06', source: 'BUYER', lines: [{ item: 'DR-RUN-04', qty: 30, price: '12.00' }],
    createdAt: kl('2026-09-29', '09:30'), createdBy: 'LMY',
  },
  {
    no: 'PO-0005', date: '2026-09-28', supplier: 'S-0034', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'DRAFT', type: 'STD',
    expected: '2026-10-12', source: 'RFQ', sourceNo: 'RFQ-0002', rfqNo: 'RFQ-0002', requestNo: 'PRQ-0003', quoteRef: 'TUE-2609-131',
    lines: [{ item: 'FM-SEA-05', qty: 40, price: '35.00' }], createdAt: kl('2026-09-28', '11:00'), createdBy: 'LMY',
  },
  {
    no: 'PO-0004', date: '2026-09-28', supplier: 'S-0021', branch: 'PNG', warehouse: 'PNG-MAIN', status: 'RELEASED', type: 'STD',
    expected: '2026-10-05', supplierSays: 'On schedule', source: 'REQUEST', sourceNo: 'PRQ-0004', requestNo: 'PRQ-0004',
    note: 'Please quote PO-0004 on your delivery order and invoice. Deliver to our Penang branch.',
    lines: [{ item: 'FB-OAK-01', qty: 60, price: '40.00' }], createdAt: kl('2026-09-28', '14:20'), createdBy: 'LMY',
    releasedAt: kl('2026-09-28', '14:30'), emailedAt: kl('2026-09-28', '14:30'),
  },
  {
    no: 'PO-0003', date: '2026-09-27', supplier: 'S-0047', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'PENDING_APPROVAL', type: 'BTO',
    expected: '2026-10-09', source: 'SALES_ORDER', sourceNo: 'SO-0003', so: 'SO-0003', customer: 'Hotel Seri Bayu',
    lines: [{ item: 'SF-CUS-03', qty: 20, price: '2100.00', so: 'SO-0003' }], createdAt: kl('2026-09-27', '16:20'), createdBy: 'SYSTEM',
    approvalRequired: true,
  },
  {
    no: 'PO-0002', date: '2026-09-24', supplier: 'S-0052', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'DONE', type: 'AST',
    expected: '2026-09-26', source: 'REQUEST', sourceNo: 'PRQ-0002', requestNo: 'PRQ-0002', quoteRef: 'MJP-Q-0881',
    lines: [{ item: 'MJ-IND-01', qty: 1, price: '25000.00', received: 1 }], createdAt: kl('2026-09-24', '09:20'), createdBy: 'LMY',
    approvalRequired: true, approvedAt: kl('2026-09-24', '11:00'), releasedAt: kl('2026-09-24', '11:30'), emailedAt: kl('2026-09-24', '11:30'),
  },
  {
    no: 'PO-0001', date: '2026-09-23', supplier: 'S-0021', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'PARTIAL', type: 'STD',
    expected: '2026-09-30', promised: '2026-10-02', supplierSays: 'Coming 2 Oct', source: 'RFQ', sourceNo: 'RFQ-0001',
    rfqNo: 'RFQ-0001', requestNo: 'PRQ-0001', quoteRef: 'KKJ-Q-5512',
    note: 'Please quote PO-0001 on your delivery order and invoice. Deliver Mon–Fri, 8 AM – 4 PM.',
    lines: [{ item: 'FB-OAK-01', qty: 100, price: '40.00', received: 95, billed: 95, returned: 10 }],
    createdAt: kl('2026-09-23', '10:48'), createdBy: 'LMY', releasedAt: kl('2026-09-23', '11:02'), emailedAt: kl('2026-09-23', '11:02'),
  },
  {
    no: 'PO-L-0882', date: '2026-09-21', supplier: 'S-0052', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'RELEASED', type: 'STD',
    expected: '2026-10-02', supplierSays: 'On schedule', source: 'MIGRATED', lines: [{ item: 'MJ-PF-11', qty: 8, price: '109.00' }],
    createdAt: kl('2026-09-21', '10:00'), createdBy: 'LMY', releasedAt: kl('2026-09-21', '10:30'), migrated: true,
  },
  {
    // RM 12,400.00 on every screen = 80 × 155.00 with no tax (an old-system order); see the Step 2 notes.
    no: 'PO-L-0879', date: '2026-09-21', supplier: 'S-0015', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'RELEASED', type: 'STD',
    expected: '2026-09-29', supplierSays: 'Arrived today', source: 'MIGRATED',
    lines: [{ item: 'PT-STN-03', qty: 80, price: '155.00', tax: 'EXEMPT' }],
    createdAt: kl('2026-09-21', '15:30'), createdBy: 'LMY', approvalRequired: true, approvedAt: kl('2026-09-22', '10:00'),
    releasedAt: kl('2026-09-22', '10:15'), migrated: true, remarks: 'Old-system order: no SST was charged on this order.',
  },
  {
    no: 'PO-L-0877', date: '2026-09-18', supplier: 'S-0015', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'DONE', type: 'STD',
    expected: '2026-09-20', source: 'MIGRATED', sourceNo: 'PRQ-L-0141', requestNo: 'PRQ-L-0141',
    lines: [{ item: 'VR-LAC-01', qty: 12, price: '95.00', received: 12, billed: 12 }],
    createdAt: kl('2026-09-18', '10:00'), createdBy: 'LMY', releasedAt: kl('2026-09-18', '10:30'), migrated: true,
  },
  {
    no: 'PO-L-0870', date: '2026-09-15', supplier: 'S-0034', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'DONE', type: 'STD',
    expected: '2026-09-15', source: 'MIGRATED', lines: [{ item: 'FB-GRY-02', qty: 25, price: '40.00', received: 25 }],
    createdAt: kl('2026-09-15', '08:30'), createdBy: 'LMY', releasedAt: kl('2026-09-15', '08:45'), migrated: true,
  },
  {
    // 20 billed comes from an old-system invoice brought over as a balance.
    no: 'PO-L-0861', date: '2026-09-10', supplier: 'S-0009', branch: 'HQ', warehouse: 'HQ-MAIN', status: 'PARTIAL', type: 'STD',
    expected: '2026-09-17', supplierSays: 'Discontinued', source: 'MIGRATED',
    lines: [{ item: 'HW-HNG-02', qty: 30, price: '21.60', received: 20, billed: 20 }],
    createdAt: kl('2026-09-10', '09:00'), createdBy: 'LMY', releasedAt: kl('2026-09-10', '09:30'), migrated: true,
  },
];

async function seedOrders(ctx: SeedCtx): Promise<void> {
  for (const o of ORDERS) {
    const s = supplier(ctx, o.supplier);
    const wh = warehouse(ctx, o.warehouse);
    const lines = o.lines.map((l, i) => {
      const line = pricedLine(ctx, l.item, l.qty, l.price, l.tax);
      return {
        tenantId: ctx.tenantId,
        lineNo: i + 1,
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        uomCode: line.uomCode,
        taxCode: line.taxCode,
        taxRate: line.taxRate,
        unitPrice: line.unitPrice,
        orderedQty: line.qty,
        receivedQty: dec(l.received ?? 0),
        billedQty: dec(l.billed ?? 0),
        returnedQty: dec(l.returned ?? 0),
        cancelledQty: dec(l.cancelled ?? 0),
        amount: line.amount,
        taxAmount: line.taxAmount,
        salesOrderNo: l.so ?? null,
      };
    });
    const totals = headerTotals(lines);
    const buyer = 'LMY';
    const row = await ctx.prisma.purPurchaseOrder.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: o.no,
        docDate: day(o.date),
        status: o.status,
        branchCode: o.branch,
        poTypeCode: o.type,
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        buyerCode: buyer,
        buyerName: nameOf(ctx, buyer),
        warehouseCode: wh.code,
        warehouseName: wh.name,
        expectedDate: o.expected ? day(o.expected) : null,
        promisedDate: o.promised ? day(o.promised) : null,
        supplierSays: o.supplierSays ?? null,
        paymentTermDays: s.paymentTermDays,
        currency: 'MYR',
        taxMode: 'EXCLUSIVE',
        supplierQuoteRef: o.quoteRef ?? null,
        noteToSupplier: o.note ?? null,
        sourceType: o.source,
        sourceNo: o.sourceNo ?? null,
        requestId: o.requestNo ? doc(ctx, o.requestNo).id : null,
        rfqId: o.rfqNo ? doc(ctx, o.rfqNo).id : null,
        salesOrderNo: o.so ?? null,
        customerName: o.customer ?? null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        approvalRequired: o.approvalRequired ?? false,
        approvedAt: o.approvedAt ?? null,
        releasedAt: o.releasedAt ?? null,
        releasedByCode: o.releasedAt ? buyer : null,
        releasedByName: o.releasedAt ? nameOf(ctx, buyer) : null,
        emailedAt: o.emailedAt ?? null,
        remarks: o.remarks ?? null,
        isMigrated: o.migrated ?? false,
        ...audit(o.createdBy, o.createdAt, o.releasedAt ?? o.createdAt),
        lines: { create: lines },
      },
    });
    remember(ctx, o.no, PUR_ENTITY.ORDER, row.id);
  }
}

export async function seedBuyingDocuments(ctx: SeedCtx): Promise<void> {
  await seedRequests(ctx);
  await seedRfqs(ctx);
  await seedOrders(ctx);
}
