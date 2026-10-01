/**
 * Cancel orders, cash purchases, supplier debit notes and purchase returns.
 * Migrated (-L-) rows that refer to old-system documents not in the seed (PO-L-0850, PI-L-0301, GRN-L-0392 …)
 * keep those numbers as text only. Their line items and unit prices are invented to match the totals shown.
 */
import type { PurCashPurchaseStatus, PurCancelOrderStatus, PurDebitNoteStatus, PurReturnStatus, PurSettleBy } from '@prisma/client';
import { dec } from '../../src/platform/http/decimal';
import { PUR_ENTITY } from '../../src/purchase/shared/purchase.constants';
import { audit, day, headerTotals, kl, nameOf, pricedLine, remember, supplier, type SeedCtx } from './util';

// ── Cancel orders ───────────────────────────────────────────────────────────

interface CancelSeed {
  no: string; date: string; status: PurCancelOrderStatus; poNo: string; supplier: string; reason: string;
  summary: string; item: string; ordered: number; received: number; cancel: number; price: string;
  letter?: string; remarks?: string; createdAt: Date; migrated?: boolean;
}

const CANCELS: CancelSeed[] = [
  {
    no: 'PCO-0001', date: '2026-09-29', status: 'DRAFT', poNo: 'PO-L-0861', supplier: 'S-0009', reason: 'Supplier stopped the item',
    summary: '10 of 30 hinge packs', item: 'HW-HNG-02', ordered: 30, received: 20, cancel: 10, price: '21.60',
    letter: 'HMK-NOTICE-0926.pdf', remarks: 'Model discontinued by maker. Replacement hinge to be sourced separately.',
    createdAt: kl('2026-09-29', '09:55'),
  },
  { no: 'PCO-L-0012', date: '2026-09-15', status: 'RELEASED', poNo: 'PO-L-0850', supplier: 'S-0034', reason: 'More than 3 weeks late', summary: 'Whole order · 50 rolls', item: 'FB-GRY-02', ordered: 50, received: 0, cancel: 50, price: '60.00', createdAt: kl('2026-09-15', '10:00'), migrated: true },
  { no: 'PCO-L-0011', date: '2026-09-04', status: 'RELEASED', poNo: 'PO-L-0842', supplier: 'S-0015', reason: 'Ordered too many', summary: '5 of 25 tins', item: 'VR-LAC-01', ordered: 25, received: 20, cancel: 5, price: '50.00', createdAt: kl('2026-09-04', '10:00'), migrated: true },
  { no: 'PCO-L-0010', date: '2026-08-28', status: 'RELEASED', poNo: 'PO-L-0829', supplier: 'S-0047', reason: 'Supplier out of stock', summary: '2 of 12 tables', item: 'TB-DIN-06', ordered: 12, received: 10, cancel: 2, price: '700.00', createdAt: kl('2026-08-28', '10:00'), migrated: true },
  { no: 'PCO-L-0009', date: '2026-08-19', status: 'RELEASED', poNo: 'PO-L-0817', supplier: 'S-0021', reason: 'Ordered too many', summary: '20 of 120 rolls', item: 'FB-OAK-01', ordered: 120, received: 100, cancel: 20, price: '40.00', createdAt: kl('2026-08-19', '10:00'), migrated: true },
];

async function seedCancelOrders(ctx: SeedCtx): Promise<void> {
  for (const c of CANCELS) {
    const s = supplier(ctx, c.supplier);
    const known = ctx.docs.get(c.poNo);
    const poLine = known
      ? await ctx.prisma.purPurchaseOrderLine.findUniqueOrThrow({ where: { poId_lineNo: { poId: known.id, lineNo: 1 } } })
      : null;
    const line = pricedLine(ctx, c.item, c.cancel, poLine?.unitPrice ?? c.price, poLine?.taxCode);
    const totals = headerTotals([line]);
    const row = await ctx.prisma.purCancelOrder.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: c.no,
        docDate: day(c.date),
        status: c.status,
        branchCode: 'HQ',
        poId: known?.id ?? null,
        poNo: c.poNo,
        supplierCode: s.code,
        supplierName: s.name,
        reason: c.reason,
        supplierLetter: c.letter ?? null,
        askedByCode: 'LMY',
        askedByName: nameOf(ctx, 'LMY'),
        summary: c.summary,
        totalValue: totals.total,
        releasedAt: c.status === 'RELEASED' ? c.createdAt : null,
        releasedByCode: c.status === 'RELEASED' ? 'AZ' : null,
        remarks: c.remarks ?? null,
        isMigrated: c.migrated ?? false,
        ...audit('LMY', c.createdAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId,
            poLineId: poLine?.id ?? null,
            lineNo: 1,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            uomCode: line.uomCode,
            taxCode: line.taxCode,
            taxRate: line.taxRate,
            unitPrice: line.unitPrice,
            orderedQty: dec(c.ordered),
            receivedQty: dec(c.received),
            openQty: dec(c.ordered - c.received),
            cancelQty: line.qty,
            amount: line.amount,
            taxAmount: line.taxAmount,
          }],
        },
      },
    });
    remember(ctx, c.no, PUR_ENTITY.CANCEL_ORDER, row.id);
  }
}

// ── Cash purchases ──────────────────────────────────────────────────────────

interface CashSeed {
  no: string; date: string; status: PurCashPurchaseStatus; supplier: string; by: string; method: 'CARD-4471' | 'PETTY-HQ';
  receiptNo: string; summary: string; item: string; qty: number; price: string; createdAt: Date; remarks?: string; migrated?: boolean;
}

const CASH_PURCHASES: CashSeed[] = [
  {
    no: 'CP-0002', date: '2026-09-29', status: 'DRAFT', supplier: 'S-0009', by: 'RAH', method: 'CARD-4471', receiptNo: 'HMK-R-55120',
    summary: 'Wood screws ×12 boxes', item: 'SC-WOD-08', qty: 12, price: '18.00', createdAt: kl('2026-09-29', '09:20'),
    remarks: 'Urgent top-up for the assembly line. Stock was down to 5 boxes.',
  },
  { no: 'CP-0001', date: '2026-09-21', status: 'RELEASED', supplier: 'S-0070', by: 'SIT', method: 'PETTY-HQ', receiptNo: 'KRM-R-2109', summary: 'Cleaning supplies', item: 'OF-CLN-01', qty: 1, price: '86.40', createdAt: kl('2026-09-21', '11:00') },
  { no: 'CP-L-0098', date: '2026-09-15', status: 'RELEASED', supplier: 'S-0015', by: 'NUR', method: 'PETTY-HQ', receiptNo: 'CW-R-7781', summary: 'Sample tins ×3', item: 'PT-SMP-01', qty: 3, price: '30.00', createdAt: kl('2026-09-15', '15:00'), migrated: true },
  { no: 'CP-L-0095', date: '2026-09-09', status: 'RELEASED', supplier: 'S-0009', by: 'HAF', method: 'CARD-4471', receiptNo: 'HMK-R-54210', summary: 'Drill bit set', item: 'TL-DRL-01', qty: 1, price: '132.00', createdAt: kl('2026-09-09', '13:00'), migrated: true },
  { no: 'CP-L-0091', date: '2026-09-02', status: 'RELEASED', supplier: 'S-0071', by: 'RAH', method: 'PETTY-HQ', receiptNo: 'KEJ-R-0412', summary: 'Extension cords ×4', item: 'EL-EXT-01', qty: 4, price: '25.00', createdAt: kl('2026-09-02', '10:00'), migrated: true },
];

async function seedCashPurchases(ctx: SeedCtx): Promise<void> {
  const methods = await ctx.prisma.purPaymentMethod.findMany({ where: { tenantId: ctx.tenantId } });
  for (const c of CASH_PURCHASES) {
    const s = supplier(ctx, c.supplier);
    const method = methods.find((m) => m.code === c.method)!;
    const line = pricedLine(ctx, c.item, c.qty, c.price);
    const totals = headerTotals([line]);
    const released = c.status === 'RELEASED';
    const row = await ctx.prisma.purCashPurchase.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: c.no,
        docDate: day(c.date),
        status: c.status,
        branchCode: 'HQ',
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        boughtByCode: c.by,
        boughtByName: nameOf(ctx, c.by),
        paymentMethodCode: method.code,
        paidBy: method.kind,
        paidByLabel: method.label,
        receiptNo: c.receiptNo,
        warehouseCode: 'HQ-MAIN',
        summary: c.summary,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        releasedAt: released ? c.createdAt : null,
        releasedByCode: released ? 'LMY' : null,
        remarks: c.remarks ?? null,
        isMigrated: c.migrated ?? false,
        ...audit(c.by, c.createdAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId, lineNo: 1, itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
            uomCode: line.uomCode, taxCode: line.taxCode, taxRate: line.taxRate, unitPrice: line.unitPrice, qty: line.qty,
            amount: line.amount, taxAmount: line.taxAmount,
          }],
        },
      },
    });
    remember(ctx, c.no, PUR_ENTITY.CASH_PURCHASE, row.id);
  }
}

// ── Supplier debit notes ────────────────────────────────────────────────────

interface DebitSeed {
  no: string; date: string; status: PurDebitNoteStatus; supplier: string; invoiceNo: string; supplierInvoiceNo: string;
  theirNoteNo: string; reason: string; chargeOnPo: boolean; item: string; price: string; dueDate: string;
  createdAt: Date; remarks?: string; migrated?: boolean;
}

const DEBIT_NOTES: DebitSeed[] = [
  {
    no: 'PDN-0001', date: '2026-09-29', status: 'DRAFT', supplier: 'S-0052', invoiceNo: 'PI-0002', supplierInvoiceNo: 'MJP-INV-2291',
    theirNoteNo: 'MJP-DN-0412', reason: 'Charge not on the PO', chargeOnPo: false, item: 'SV-INS-01', price: '500.00',
    dueDate: '2026-10-29', createdAt: kl('2026-09-29', '09:05'),
    remarks: 'Installation and one-day operator training for the new industrial sewing machine.',
  },
  { no: 'PDN-L-0021', date: '2026-09-12', status: 'RELEASED', supplier: 'S-0021', invoiceNo: 'PI-L-0301', supplierInvoiceNo: 'KKJ-INV-10377', theirNoteNo: 'KKJ-DN-0388', reason: 'Freight surcharge, agreed by phone', chargeOnPo: true, item: 'SV-FRT-01', price: '120.00', dueDate: '2026-10-12', createdAt: kl('2026-09-12', '10:00'), migrated: true },
  { no: 'PDN-L-0019', date: '2026-09-01', status: 'RELEASED', supplier: 'S-0015', invoiceNo: 'PI-L-0290', supplierInvoiceNo: 'CW-INV-8650', theirNoteNo: 'CW-DN-102', reason: 'Tinting charge', chargeOnPo: true, item: 'SV-TNT-01', price: '66.00', dueDate: '2026-10-01', createdAt: kl('2026-09-01', '10:00'), migrated: true },
];

async function seedDebitNotes(ctx: SeedCtx): Promise<void> {
  for (const d of DEBIT_NOTES) {
    const s = supplier(ctx, d.supplier);
    const line = pricedLine(ctx, d.item, 1, d.price);
    const totals = headerTotals([line]);
    const released = d.status === 'RELEASED';
    const row = await ctx.prisma.purDebitNote.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: d.no,
        docDate: day(d.date),
        status: d.status,
        branchCode: 'HQ',
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        invoiceId: ctx.docs.get(d.invoiceNo)?.id ?? null,
        invoiceNo: d.invoiceNo,
        supplierInvoiceNo: d.supplierInvoiceNo,
        theirNoteNo: d.theirNoteNo,
        reason: d.reason,
        chargeOnPo: d.chargeOnPo,
        dueDate: day(d.dueDate),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        releasedAt: released ? d.createdAt : null,
        releasedByCode: released ? 'LMY' : null,
        remarks: d.remarks ?? null,
        isMigrated: d.migrated ?? false,
        ...audit('LMY', d.createdAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId, lineNo: 1, itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
            uomCode: line.uomCode, taxCode: line.taxCode, taxRate: line.taxRate, unitPrice: line.unitPrice, qty: line.qty,
            amount: line.amount, taxAmount: line.taxAmount,
          }],
        },
      },
    });
    remember(ctx, d.no, PUR_ENTITY.DEBIT_NOTE, row.id);
  }
}

// ── Purchase returns ────────────────────────────────────────────────────────

interface ReturnSeed {
  no: string; date: string; status: PurReturnStatus; grnNo: string; supplier: string; reason: string; settleBy: PurSettleBy;
  summary: string; item: string; qty: number; price: string; received: number; createdAt: Date; releasedAt?: Date;
  rma?: string; collection?: string; collectionDate?: string; creditNoteNo?: string; replacementGrnNo?: string;
  settledAt?: Date; remarks?: string; migrated?: boolean;
}

const RETURNS: ReturnSeed[] = [
  {
    no: 'PRT-0001', date: '2026-09-28', status: 'RELEASED', grnNo: 'GRN-0001', supplier: 'S-0021', reason: 'Wrong colour',
    settleBy: 'CREDIT_NOTE', summary: '10 rolls FB-OAK-01', item: 'FB-OAK-01', qty: 10, price: '40.00', received: 95,
    createdAt: kl('2026-09-28', '11:20'), releasedAt: kl('2026-09-28', '14:00'), rma: 'KKJ-RMA-0219',
    collection: 'Supplier lorry · 30 Sep', collectionDate: '2026-09-30',
    remarks: 'Colour is sand, not oatmeal. Batch KKJ-B-2209. Supplier agreed on the phone.',
  },
  {
    no: 'PRT-L-0017', date: '2026-09-10', status: 'SETTLED', grnNo: 'GRN-L-0392', supplier: 'S-0015', reason: 'Dented tins',
    settleBy: 'CREDIT_NOTE', summary: '2 tins lacquer', item: 'VR-LAC-01', qty: 2, price: '50.00', received: 12,
    createdAt: kl('2026-09-10', '10:00'), releasedAt: kl('2026-09-10', '10:00'), creditNoteNo: 'CW-CN-051',
    settledAt: kl('2026-09-16', '10:00'), migrated: true,
  },
  {
    no: 'PRT-L-0016', date: '2026-09-03', status: 'SETTLED', grnNo: 'GRN-L-0380', supplier: 'S-0034', reason: 'Stained',
    settleBy: 'REPLACEMENT', summary: '4 rolls foam', item: 'FM-SEA-05', qty: 4, price: '40.00', received: 40,
    createdAt: kl('2026-09-03', '10:00'), releasedAt: kl('2026-09-03', '10:00'), replacementGrnNo: 'GRN-L-0388',
    settledAt: kl('2026-09-08', '10:00'), migrated: true,
  },
];

async function seedReturns(ctx: SeedCtx): Promise<void> {
  for (const r of RETURNS) {
    const s = supplier(ctx, r.supplier);
    const known = ctx.docs.get(r.grnNo);
    const gLine = known
      ? await ctx.prisma.purGoodsReceiptLine.findUniqueOrThrow({ where: { grnId_lineNo: { grnId: known.id, lineNo: 1 } }, include: { grn: true } })
      : null;
    const line = pricedLine(ctx, r.item, r.qty, gLine?.unitPrice ?? r.price, gLine?.taxCode);
    const totals = headerTotals([line]);
    const row = await ctx.prisma.purReturn.create({
      data: {
        tenantId: ctx.tenantId,
        docNo: r.no,
        docDate: day(r.date),
        status: r.status,
        branchCode: 'HQ',
        grnId: known?.id ?? null,
        grnNo: r.grnNo,
        poId: gLine?.grn.poId ?? null,
        poNo: gLine?.grn.poNo ?? null,
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        reason: r.reason,
        settleBy: r.settleBy,
        rmaNo: r.rma ?? null,
        collection: r.collection ?? null,
        collectionDate: r.collectionDate ? day(r.collectionDate) : null,
        summary: r.summary,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        releasedAt: r.releasedAt ?? null,
        releasedByCode: r.releasedAt ? 'LMY' : null,
        creditNoteNo: r.creditNoteNo ?? null,
        replacementGrnNo: r.replacementGrnNo ?? null,
        settledAt: r.settledAt ?? null,
        remarks: r.remarks ?? null,
        isMigrated: r.migrated ?? false,
        ...audit('LMY', r.createdAt, r.settledAt ?? r.releasedAt ?? r.createdAt),
        lines: {
          create: [{
            tenantId: ctx.tenantId,
            grnLineId: gLine?.id ?? null,
            poLineId: gLine?.poLineId ?? null,
            lineNo: 1,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            uomCode: line.uomCode,
            taxCode: line.taxCode,
            taxRate: line.taxRate,
            unitPrice: line.unitPrice,
            receivedQty: dec(r.received),
            returnedBeforeQty: dec(0),
            qty: line.qty,
            amount: line.amount,
            taxAmount: line.taxAmount,
          }],
        },
      },
    });
    remember(ctx, r.no, PUR_ENTITY.RETURN, row.id);
  }
}

export async function seedCorrectionDocuments(ctx: SeedCtx): Promise<void> {
  await seedCancelOrders(ctx);
  await seedCashPurchases(ctx);
  await seedDebitNotes(ctx);
  await seedReturns(ctx);
}
