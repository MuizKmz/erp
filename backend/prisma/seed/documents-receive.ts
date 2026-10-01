/**
 * Goods receipts and supplier invoices (three-way match). Each GRN line points to its PO line and each
 * invoice line to its PO line and GRN line, as the app will do.
 */
import type { PurInvoiceDecision, PurInvoiceStatus, PurMatchResult, PurReceiptStatus, PurShortAction } from '@prisma/client';
import { dec } from '../../src/platform/http/decimal';
import { PUR_ENTITY } from '../../src/purchase/shared/purchase.constants';
import { documentTotals, lineTotals } from '../../src/purchase/shared/totals.rules';
import { audit, day, doc, kl, nameOf, remember, type SeedCtx } from './util';

async function poLine(ctx: SeedCtx, poNo: string, lineNo = 1) {
  return ctx.prisma.purPurchaseOrderLine.findUniqueOrThrow({
    where: { poId_lineNo: { poId: doc(ctx, poNo).id, lineNo } },
    include: { po: true },
  });
}

async function grnLine(ctx: SeedCtx, grnNo: string, lineNo = 1) {
  return ctx.prisma.purGoodsReceiptLine.findUniqueOrThrow({ where: { grnId_lineNo: { grnId: doc(ctx, grnNo).id, lineNo } } });
}

// ── Goods receipts ──────────────────────────────────────────────────────────

interface GrnSeed {
  no: string; date: string; poNo: string; status: PurReceiptStatus; doNo: string; by: string;
  received: number; openBefore: number; billed?: number; returned?: number; location?: string;
  vehicle?: string; arrivedAt?: Date; confirmedAt?: Date; shortAction?: PurShortAction; remarks?: string; migrated?: boolean;
}

const RECEIPTS: GrnSeed[] = [
  {
    no: 'GRN-0003', date: '2026-09-29', poNo: 'PO-L-0879', status: 'DRAFT', doNo: 'CW-DO-2241', by: 'RAH',
    received: 0, openBefore: 80, arrivedAt: kl('2026-09-29', '09:40'), remarks: 'Being counted.',
  },
  {
    no: 'GRN-0002', date: '2026-09-26', poNo: 'PO-0002', status: 'CONFIRMED', doNo: 'MJP-DO-0930', by: 'HAF',
    received: 1, openBefore: 1, location: 'HQ-MAIN/B-01', arrivedAt: kl('2026-09-26', '09:30'), confirmedAt: kl('2026-09-26', '10:00'),
  },
  {
    no: 'GRN-0001', date: '2026-09-25', poNo: 'PO-0001', status: 'CONFIRMED', doNo: 'KKJ-DO-7781', by: 'RAH',
    received: 95, openBefore: 100, billed: 95, returned: 10, location: 'HQ-MAIN/B-03', vehicle: 'BKL 4471',
    arrivedAt: kl('2026-09-25', '14:40'), confirmedAt: kl('2026-09-25', '15:30'), shortAction: 'KEEP_OPEN',
    remarks: 'Driver says the last 5 rolls come on the next trip.',
  },
  {
    no: 'GRN-L-0410', date: '2026-09-20', poNo: 'PO-L-0877', status: 'CONFIRMED', doNo: 'CW-DO-2197', by: 'RAH',
    received: 12, openBefore: 12, billed: 12, location: 'HQ-MAIN/B-04', confirmedAt: kl('2026-09-20', '11:00'), migrated: true,
  },
  {
    no: 'GRN-L-0406', date: '2026-09-17', poNo: 'PO-L-0861', status: 'CONFIRMED', doNo: 'HMK-DO-1180', by: 'RAH',
    received: 20, openBefore: 30, billed: 20, location: 'HQ-MAIN/B-02', confirmedAt: kl('2026-09-17', '16:00'),
    shortAction: 'KEEP_OPEN', migrated: true,
  },
  {
    no: 'GRN-L-0398', date: '2026-09-15', poNo: 'PO-L-0870', status: 'CONFIRMED', doNo: 'TUE-DO-551', by: 'HAF',
    received: 25, openBefore: 25, location: 'HQ-MAIN/B-03', confirmedAt: kl('2026-09-15', '15:00'), migrated: true,
  },
];

async function seedReceipts(ctx: SeedCtx): Promise<void> {
  for (const g of RECEIPTS) {
    const line = await poLine(ctx, g.poNo);
    const po = line.po;
    const createdAt = g.arrivedAt ?? g.confirmedAt ?? kl(g.date);
    const row = await ctx.prisma.purGoodsReceipt.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: g.no,
        docDate: day(g.date),
        status: g.status,
        branchCode: po.branchCode,
        poId: po.id,
        poNo: po.docNo,
        supplierCode: po.supplierCode,
        supplierName: po.supplierName,
        warehouseCode: po.warehouseCode,
        warehouseName: po.warehouseName,
        supplierDoNo: g.doNo,
        vehicleNo: g.vehicle ?? null,
        receivedByCode: g.by,
        receivedByName: nameOf(ctx, g.by),
        arrivedAt: g.arrivedAt ?? null,
        shortAction: g.shortAction ?? null,
        confirmedAt: g.confirmedAt ?? null,
        confirmedByCode: g.confirmedAt ? g.by : null,
        remarks: g.remarks ?? null,
        isMigrated: g.migrated ?? false,
        ...audit(g.by, createdAt, g.confirmedAt ?? createdAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId,
            poLineId: line.id,
            lineNo: 1,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            uomCode: line.uomCode,
            taxCode: line.taxCode,
            taxRate: line.taxRate,
            unitPrice: line.unitPrice,
            orderedQty: line.orderedQty,
            openQtyBefore: dec(g.openBefore),
            receivedQty: dec(g.received),
            billedQty: dec(g.billed ?? 0),
            returnedQty: dec(g.returned ?? 0),
            condition: 'GOOD',
            locationCode: g.location ?? null,
          }],
        },
      },
    });
    remember(ctx, g.no, PUR_ENTITY.RECEIPT, row.id);
  }
}

// ── Supplier invoices ───────────────────────────────────────────────────────

interface InvoiceSeed {
  no: string; date: string; supplierInvoiceNo: string; poNo: string; grnNo: string; status: PurInvoiceStatus;
  billedQty: number; billedPrice: string; qty: number; price: string; dueDate: string;
  matchResult: PurMatchResult; matchSummary: string; decision?: PurInvoiceDecision; supplierNote?: string;
  decisionNote?: string; message?: string; eInvoice?: string; createdAt: Date; approvedAt?: Date; approvedBy?: string;
  rejectReason?: string; migrated?: boolean;
}

export const PI_0001_MESSAGE =
  'Dear Kilang Kain Jaya, we have recorded KKJ-INV-10442 for the 95 rolls received on 25 Sep (RM 4,180.00). ' +
  'Please bill the last 5 rolls when they are delivered.';

const INVOICES: InvoiceSeed[] = [
  {
    no: 'PI-0003', date: '2026-09-29', supplierInvoiceNo: 'TUE-INV-3310', poNo: 'PO-L-0870', grnNo: 'GRN-L-0398',
    status: 'TO_MATCH', billedQty: 25, billedPrice: '40.00', qty: 25, price: '40.00', dueDate: '2026-10-29',
    matchResult: 'NOT_MATCHED', matchSummary: 'Not matched yet', createdAt: kl('2026-09-29', '09:10'),
  },
  {
    no: 'PI-0002', date: '2026-09-28', supplierInvoiceNo: 'MJP-INV-2291', poNo: 'PO-0002', grnNo: 'GRN-0002',
    status: 'PENDING_APPROVAL', billedQty: 1, billedPrice: '25800.00', qty: 1, price: '25800.00', dueDate: '2026-10-28',
    matchResult: 'DIFFERENCE', matchSummary: 'Price +3.2% · freight', decision: 'ACCEPT_AS_BILLED',
    supplierNote: 'Freight to Shah Alam added',
    decisionNote: 'Freight was not in their quotation. Supplier says it was agreed by phone. Please decide.',
    eInvoice: 'VALIDATED', createdAt: kl('2026-09-28', '16:20'),
  },
  {
    no: 'PI-0001', date: '2026-09-26', supplierInvoiceNo: 'KKJ-INV-10442', poNo: 'PO-0001', grnNo: 'GRN-0001',
    status: 'APPROVED', billedQty: 100, billedPrice: '40.00', qty: 95, price: '40.00', dueDate: '2026-10-26',
    matchResult: 'DIFFERENCE', matchSummary: 'Qty fixed 100 → 95', decision: 'RECORD_RECEIVED', message: PI_0001_MESSAGE,
    eInvoice: 'VALIDATED', createdAt: kl('2026-09-26', '09:30'), approvedAt: kl('2026-09-26', '16:15'), approvedBy: 'LMY',
  },
  {
    no: 'PI-L-0321', date: '2026-09-22', supplierInvoiceNo: 'HMK-INV-7702', poNo: 'PO-L-0861', grnNo: 'GRN-L-0406',
    status: 'REJECTED', billedQty: 30, billedPrice: '21.60', qty: 30, price: '21.60', dueDate: '2026-10-22',
    matchResult: 'DIFFERENCE', matchSummary: 'Billed 30 · received 20', decision: 'ACCEPT_AS_BILLED',
    createdAt: kl('2026-09-22', '14:30'), rejectReason: 'Billed 30 packs but only 20 arrived. Ask for a corrected invoice.', migrated: true,
  },
  {
    no: 'PI-L-0318', date: '2026-09-20', supplierInvoiceNo: 'CW-INV-8812', poNo: 'PO-L-0877', grnNo: 'GRN-L-0410',
    status: 'APPROVED', billedQty: 12, billedPrice: '95.00', qty: 12, price: '95.00', dueDate: '2026-10-20',
    matchResult: 'MATCHED', matchSummary: 'All three agree', createdAt: kl('2026-09-20', '14:00'),
    approvedAt: kl('2026-09-20', '14:05'), approvedBy: 'LMY', migrated: true,
  },
];

async function seedInvoices(ctx: SeedCtx): Promise<void> {
  for (const inv of INVOICES) {
    const line = await poLine(ctx, inv.poNo);
    const gLine = await grnLine(ctx, inv.grnNo);
    const po = line.po;
    const billed = lineTotals({ qty: inv.billedQty, unitPrice: inv.billedPrice, taxRate: line.taxRate });
    const recorded = lineTotals({ qty: inv.qty, unitPrice: inv.price, taxRate: line.taxRate });
    const billedTotals = documentTotals([billed]);
    const recordedTotals = documentTotals([recorded]);
    const updatedAt = inv.approvedAt ?? inv.createdAt;
    const row = await ctx.prisma.purInvoice.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: inv.no,
        docDate: day(inv.date),
        status: inv.status,
        branchCode: po.branchCode,
        supplierId: po.supplierId,
        supplierCode: po.supplierCode,
        supplierName: po.supplierName,
        supplierInvoiceNo: inv.supplierInvoiceNo,
        invoiceDate: day(inv.date),
        dueDate: day(inv.dueDate),
        poId: po.id,
        poNo: po.docNo,
        billedSubtotal: billedTotals.subtotal,
        billedTax: billedTotals.taxTotal,
        billedTotal: billedTotals.total,
        subtotal: recordedTotals.subtotal,
        taxTotal: recordedTotals.taxTotal,
        total: recordedTotals.total,
        matchResult: inv.matchResult,
        matchSummary: inv.matchSummary,
        decision: inv.decision ?? null,
        supplierNote: inv.supplierNote ?? null,
        decisionNote: inv.decisionNote ?? null,
        messageToSupplier: inv.message ?? null,
        eInvoiceStatus: inv.eInvoice ?? null,
        approvedAt: inv.approvedAt ?? null,
        approvedByCode: inv.approvedBy ?? null,
        rejectReason: inv.rejectReason ?? null,
        isMigrated: inv.migrated ?? false,
        ...audit('LMY', inv.createdAt, updatedAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId,
            poLineId: line.id,
            grnLineId: gLine.id,
            lineNo: 1,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            uomCode: line.uomCode,
            taxCode: line.taxCode,
            taxRate: line.taxRate,
            orderedQty: line.orderedQty,
            orderedPrice: line.unitPrice,
            receivedQty: gLine.receivedQty,
            billedQty: dec(inv.billedQty),
            billedUnitPrice: dec(inv.billedPrice),
            billedAmount: billed.amount,
            billedTax: billed.taxAmount,
            qty: dec(inv.qty),
            unitPrice: dec(inv.price),
            amount: recorded.amount,
            taxAmount: recorded.taxAmount,
          }],
        },
      },
    });
    remember(ctx, inv.no, PUR_ENTITY.INVOICE, row.id);
  }
}

export async function seedReceivingDocuments(ctx: SeedCtx): Promise<void> {
  await seedReceipts(ctx);
  await seedInvoices(ctx);
}
