import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import type { ModuleUsage, RecordUsageProvider, UsageQuery, UsageReference } from '../../platform/usage/record-usage.types';
import { salesUsage, type SalesDocRow, type SalesDocType } from './sales-usage.rules';

const DOC = { docNo: true, status: true } as const;
const REVISED = { ...DOC, revision: true } as const;
const DELIVERY = { ...DOC, lines: { select: { qty: true, invoicedQty: true } } } as const;

/**
 * Tells Core which Sales documents use an item, customer, unit, tax code, price list or warehouse (CLAUDE.md →
 * Phase 3 · Record-usage check). Read only: reads sal_ tables and changes nothing. Documents are matched on business
 * codes, which never change.
 */
@Injectable()
export class SalesUsageProvider implements RecordUsageProvider, OnModuleInit {
  readonly module = 'sales';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RecordUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async usage(q: UsageQuery): Promise<ModuleUsage> {
    const [rows, references] = await Promise.all([this.documents(q), this.references(q)]);
    return salesUsage(rows, references);
  }

  private async documents(q: UsageQuery): Promise<SalesDocRow[]> {
    const tenantId = q.tenantId;
    const rows: SalesDocRow[] = [];
    const add = (docType: SalesDocType, found: { docNo: string; status: string; revision?: number }[]) =>
      found.forEach((r) => rows.push({ docType, docNo: r.docNo, status: r.status, revision: r.revision }));
    const addDeliveries = (found: { docNo: string; status: string; lines: SalesDocRow['deliveryLines'] }[]) =>
      found.forEach((r) => rows.push({ docType: 'DELIVERY', docNo: r.docNo, status: r.status, deliveryLines: r.lines }));

    // Items, units and tax codes are on the lines. Enquiry items and delivery lines carry no tax code.
    const line = q.kind === 'ITEM' ? { itemCode: q.code } : q.kind === 'UOM' ? { uomCode: q.code } : q.kind === 'TAX_CODE' ? { taxCode: q.code } : null;
    const itemOrUnit = q.kind === 'ITEM' ? { itemCode: q.code } : q.kind === 'UOM' ? { uomCode: q.code } : null;
    if (line) {
      const some = { lines: { some: line } };
      const [enquiries, quotations, orders, deliveries, invoices, cash, debitNotes, returns, cancels] = await Promise.all([
        itemOrUnit ? this.prisma.salEnquiry.findMany({ where: { tenantId, items: { some: itemOrUnit } }, select: DOC }) : [],
        this.prisma.salQuotation.findMany({ where: { tenantId, ...some }, select: REVISED }),
        this.prisma.salSalesOrder.findMany({ where: { tenantId, ...some }, select: REVISED }),
        itemOrUnit ? this.prisma.salDelivery.findMany({ where: { tenantId, lines: { some: itemOrUnit } }, select: DELIVERY }) : [],
        this.prisma.salInvoice.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.salCashSale.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.salDebitNote.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.salReturn.findMany({ where: { tenantId, ...some }, select: DOC }),
        this.prisma.salCancelOrder.findMany({ where: { tenantId, ...some }, select: DOC }),
      ]);
      add('ENQUIRY', enquiries);
      add('QUOTATION', quotations);
      add('SALES_ORDER', orders);
      addDeliveries(deliveries);
      add('INVOICE', invoices);
      add('CASH_SALE', cash);
      add('DEBIT_NOTE', debitNotes);
      add('RETURN', returns);
      add('CANCEL_ORDER', cancels);
    }

    if (q.kind === 'CUSTOMER') {
      const customer = { tenantId, customerCode: q.code };
      const [enquiries, quotations, orders, deliveries, invoices, proformas, cash, debitNotes, returns, cancels] = await Promise.all([
        this.prisma.salEnquiry.findMany({ where: customer, select: DOC }),
        this.prisma.salQuotation.findMany({ where: customer, select: REVISED }),
        this.prisma.salSalesOrder.findMany({ where: customer, select: REVISED }),
        this.prisma.salDelivery.findMany({ where: customer, select: DELIVERY }),
        this.prisma.salInvoice.findMany({ where: customer, select: DOC }),
        this.prisma.salProforma.findMany({ where: customer, select: DOC }),
        this.prisma.salCashSale.findMany({ where: customer, select: DOC }),
        this.prisma.salDebitNote.findMany({ where: customer, select: DOC }),
        this.prisma.salReturn.findMany({ where: customer, select: DOC }),
        this.prisma.salCancelOrder.findMany({ where: customer, select: DOC }),
      ]);
      add('ENQUIRY', enquiries);
      add('QUOTATION', quotations);
      add('SALES_ORDER', orders);
      addDeliveries(deliveries);
      add('INVOICE', invoices);
      add('PROFORMA', proformas);
      add('CASH_SALE', cash);
      add('DEBIT_NOTE', debitNotes);
      add('RETURN', returns);
      add('CANCEL_ORDER', cancels);
    }

    if (q.kind === 'PRICE_LIST') {
      const priceList = { tenantId, priceListCode: q.code };
      const [quotations, orders] = await Promise.all([
        this.prisma.salQuotation.findMany({ where: priceList, select: REVISED }),
        this.prisma.salSalesOrder.findMany({ where: priceList, select: REVISED }),
      ]);
      add('QUOTATION', quotations);
      add('SALES_ORDER', orders);
    }

    if (q.kind === 'WAREHOUSE') {
      const warehouse = { tenantId, warehouseCode: q.code };
      const [orders, deliveries, cash, returns] = await Promise.all([
        this.prisma.salSalesOrder.findMany({ where: warehouse, select: REVISED }),
        this.prisma.salDelivery.findMany({ where: warehouse, select: DELIVERY }),
        this.prisma.salCashSale.findMany({ where: warehouse, select: DOC }),
        this.prisma.salReturn.findMany({ where: warehouse, select: DOC }),
      ]);
      add('SALES_ORDER', orders);
      addDeliveries(deliveries);
      add('CASH_SALE', cash);
      add('RETURN', returns);
    }
    return rows;
  }

  /** Settings that point to the record without being documents: an item on the excluded-items list (S32). */
  private async references(q: UsageQuery): Promise<UsageReference[]> {
    if (q.kind !== 'ITEM') return [];
    const count = await this.prisma.salExcludedItem.count({ where: { tenantId: q.tenantId, itemCode: q.code } });
    return [{ module: 'sales', label: 'Excluded items', count }];
  }
}
