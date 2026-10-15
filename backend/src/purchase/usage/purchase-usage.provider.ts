import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import type { ModuleUsage, RecordUsageProvider, UsageQuery, UsageReference } from '../../platform/usage/record-usage.types';
import { purchaseUsage, type PurchaseDocRow, type PurchaseDocType } from './purchase-usage.rules';

const DOC = { docNo: true, status: true } as const;
const RECEIPT = { ...DOC, lines: { select: { receivedQty: true, billedQty: true, returnedQty: true } } } as const;

/**
 * Tells Core which Purchase documents use an item, supplier, unit, tax code or warehouse (CLAUDE.md → Phase 3 ·
 * Record-usage check), and Configuration which carry a branch (Phase 4, rule 6). Read only: reads pur_ tables and
 * changes nothing. Documents are matched on business codes, which never change.
 */
@Injectable()
export class PurchaseUsageProvider implements RecordUsageProvider, OnModuleInit {
  readonly module = 'purchase';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RecordUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async usage(q: UsageQuery): Promise<ModuleUsage> {
    const [rows, references] = await Promise.all([this.documents(q), this.references(q)]);
    return purchaseUsage(rows, references);
  }

  private async documents(q: UsageQuery): Promise<PurchaseDocRow[]> {
    const tenantId = q.tenantId;
    const rows: PurchaseDocRow[] = [];
    const add = (docType: PurchaseDocType, found: { docNo: string; status: string }[]) => found.forEach((r) => rows.push({ docType, docNo: r.docNo, status: r.status }));
    const addReceipts = (found: { docNo: string; status: string; lines: PurchaseDocRow['receiptLines'] }[]) =>
      found.forEach((r) => rows.push({ docType: 'GOODS_RECEIPT', docNo: r.docNo, status: r.status, receiptLines: r.lines }));

    // Items, units and tax codes are on the lines.
    const line = q.kind === 'ITEM' ? { itemCode: q.code } : q.kind === 'UOM' ? { uomCode: q.code } : q.kind === 'TAX_CODE' ? { taxCode: q.code } : null;
    if (line) {
      const some = { lines: { some: line } };
      const [requests, rfqs, orders, receipts, invoices, cash, cancels, debitNotes, returns] = await Promise.all([
        this.prisma.purRequest.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purRfq.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purPurchaseOrder.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purGoodsReceipt.findMany({ where: { tenantId, ...some }, select: RECEIPT }),
        this.prisma.purInvoice.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purCashPurchase.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purCancelOrder.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purDebitNote.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.purReturn.findMany({ where: { tenantId, ...some }, select: DOC }),
      ]);
      add('REQUEST', requests);
      add('RFQ', rfqs);
      add('PURCHASE_ORDER', orders);
      addReceipts(receipts);
      add('INVOICE', invoices);
      add('CASH_PURCHASE', cash);
      add('CANCEL_ORDER', cancels);
      add('DEBIT_NOTE', debitNotes);
      add('RETURN', returns);
    }

    if (q.kind === 'SUPPLIER') {
      const supplier = { tenantId, supplierCode: q.code };
      const [rfqs, orders, receipts, invoices, cash, cancels, debitNotes, returns] = await Promise.all([
        this.prisma.purRfq.findMany({ where: { tenantId, suppliers: { some: { supplierCode: q.code } } }, select: DOC }),
        this.prisma.purPurchaseOrder.findMany({ where: supplier, select: DOC }),
        this.prisma.purGoodsReceipt.findMany({ where: supplier, select: RECEIPT }),
        this.prisma.purInvoice.findMany({ where: supplier, select: DOC }),
        this.prisma.purCashPurchase.findMany({ where: supplier, select: DOC }),
        this.prisma.purCancelOrder.findMany({ where: supplier, select: DOC }),
        this.prisma.purDebitNote.findMany({ where: supplier, select: DOC }),
        this.prisma.purReturn.findMany({ where: supplier, select: DOC }),
      ]);
      add('RFQ', rfqs);
      add('PURCHASE_ORDER', orders);
      addReceipts(receipts);
      add('INVOICE', invoices);
      add('CASH_PURCHASE', cash);
      add('CANCEL_ORDER', cancels);
      add('DEBIT_NOTE', debitNotes);
      add('RETURN', returns);
    }

    if (q.kind === 'WAREHOUSE') {
      const warehouse = { tenantId, warehouseCode: q.code };
      const [orders, receipts, cash] = await Promise.all([
        this.prisma.purPurchaseOrder.findMany({ where: warehouse, select: DOC }),
        this.prisma.purGoodsReceipt.findMany({ where: warehouse, select: RECEIPT }),
        this.prisma.purCashPurchase.findMany({ where: warehouse, select: DOC }),
      ]);
      add('PURCHASE_ORDER', orders);
      addReceipts(receipts);
      add('CASH_PURCHASE', cash);
    }

    if (q.kind === 'BRANCH') {
      const branch = { tenantId, branchCode: q.code };
      const [requests, rfqs, orders, receipts, invoices, cash, cancels, debitNotes, returns] = await Promise.all([
        this.prisma.purRequest.findMany({ where: branch, select: DOC }),
        this.prisma.purRfq.findMany({ where: branch, select: DOC }),
        this.prisma.purPurchaseOrder.findMany({ where: branch, select: DOC }),
        this.prisma.purGoodsReceipt.findMany({ where: branch, select: RECEIPT }),
        this.prisma.purInvoice.findMany({ where: branch, select: DOC }),
        this.prisma.purCashPurchase.findMany({ where: branch, select: DOC }),
        this.prisma.purCancelOrder.findMany({ where: branch, select: DOC }),
        this.prisma.purDebitNote.findMany({ where: branch, select: DOC }),
        this.prisma.purReturn.findMany({ where: branch, select: DOC }),
      ]);
      add('REQUEST', requests);
      add('RFQ', rfqs);
      add('PURCHASE_ORDER', orders);
      addReceipts(receipts);
      add('INVOICE', invoices);
      add('CASH_PURCHASE', cash);
      add('CANCEL_ORDER', cancels);
      add('DEBIT_NOTE', debitNotes);
      add('RETURN', returns);
    }
    return rows;
  }

  /** Settings that name a branch without being documents: its approval rules and payment methods (P26, P18). */
  private async references(q: UsageQuery): Promise<UsageReference[]> {
    if (q.kind !== 'BRANCH') return [];
    const branch = { tenantId: q.tenantId, branchCode: q.code };
    const [rules, methods] = await Promise.all([this.prisma.purApprovalRule.count({ where: branch }), this.prisma.purPaymentMethod.count({ where: branch })]);
    return [
      { module: 'purchase', label: 'Purchase approval rules', count: rules },
      { module: 'purchase', label: 'Cash purchase payment methods', count: methods },
    ];
  }
}
