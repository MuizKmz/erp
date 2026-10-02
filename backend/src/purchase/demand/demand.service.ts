import { Inject, Injectable } from '@nestjs/common';
import { SALES_DEMAND_PORT, STOCK_PORT, type SalesDemandPort, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { suggestPurchase, type DemandStatus } from './demand.rules';

/** PO statuses whose open quantity counts as "on order" (drafts included, as the demand list shows). */
export const ON_ORDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL'] as const;

export interface DemandLine {
  itemCode: string;
  itemName: string;
  uomCode: string;
  preferredSupplierCode: string | null;
  preferredSupplierName: string | null;
  onHand: string;
  onOrder: string;
  reorderLevel: string | null;
  salesNeed: string;
  salesOrders: { soNo: string; qty: string; customerName: string }[];
  /** SALES_ORDER when an open sales order needs the item, else BELOW_REORDER. */
  reason: 'BELOW_REORDER' | 'SALES_ORDER';
  isBuyToOrder: boolean;
  status: Exclude<DemandStatus, 'NOT_NEEDED'>;
  suggestedQty: string;
  lastPrice: string | null;
  estValue: string;
  /** Open POs that cover the need. */
  coveredBy: string[];
}

/**
 * The demand list (P04): what to buy, from stock levels (Inventory), open sales orders (Sales) and reorder
 * levels (Master Data). Only items that need something are returned.
 */
@Injectable()
export class DemandService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
    @Inject(SALES_DEMAND_PORT) private readonly sales: SalesDemandPort,
  ) {}

  /**
   * @param branchCode only stock, open orders, requests and sales orders of this branch; all when left out.
   */
  async compute(tenantId: string, branchCode?: string): Promise<DemandLine[]> {
    const items = await this.masterData.listPurchasableItems(tenantId);
    const codes = items.map((i) => i.code);
    const [stockAll, salesAll, openLines, requestLines, lastPrices, warehouses, suppliers] = await Promise.all([
      this.stock.listStock(tenantId, codes),
      this.sales.listOpenDemand(tenantId, codes),
      this.prisma.purPurchaseOrderLine.findMany({
        where: { tenantId, itemCode: { in: codes }, po: { status: { in: [...ON_ORDER_STATUSES] }, ...(branchCode && { branchCode }) } },
        select: { itemCode: true, orderedQty: true, receivedQty: true, cancelledQty: true, po: { select: { docNo: true } } },
      }),
      // Submitted requests not yet turned into a PO also cover the need ("by open POs or requests").
      this.prisma.purRequestLine.findMany({
        where: { tenantId, itemCode: { in: codes }, request: { status: 'SUBMITTED', ...(branchCode && { branchCode }) } },
        select: { itemCode: true, qty: true, request: { select: { docNo: true } } },
      }),
      this.lastPrices(tenantId, codes),
      this.masterData.listWarehouses(tenantId, branchCode),
      this.masterData.listSuppliers(tenantId),
    ]);
    const branchWarehouses = new Set(warehouses.map((w) => w.code));
    const stock = branchCode ? stockAll.filter((s) => branchWarehouses.has(s.warehouseCode)) : stockAll;
    const sales = branchCode ? salesAll.filter((s) => s.branchCode === branchCode) : salesAll;

    const lines: DemandLine[] = [];
    for (const item of items) {
      const onHand = stock.filter((s) => s.itemCode === item.code).reduce((sum, s) => sum.add(s.onHand), dec(0));
      const poLines = openLines.filter((l) => l.itemCode === item.code);
      const reqLines = requestLines.filter((l) => l.itemCode === item.code);
      const onOrder = poLines
        .reduce((sum, l) => sum.add(l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty)), dec(0))
        .add(reqLines.reduce((sum, l) => sum.add(l.qty), dec(0)));
      const direct = sales.filter((s) => s.itemCode === item.code && s.kind === 'DIRECT');
      const salesNeed = direct.reduce((sum, s) => sum.add(s.qty), dec(0));

      const result = suggestPurchase({ onHand, onOrder, reorderLevel: item.reorderLevel, salesNeed, packSize: item.packSize });
      if (result.status === 'NOT_NEEDED') continue;

      const lastPrice = lastPrices.get(item.code) ?? null;
      const supplier = suppliers.find((s) => s.code === item.preferredSupplierCode);
      lines.push({
        itemCode: item.code,
        itemName: item.name,
        uomCode: item.uomCode,
        preferredSupplierCode: item.preferredSupplierCode,
        preferredSupplierName: supplier?.name ?? null,
        onHand: toQty(onHand),
        onOrder: toQty(onOrder),
        reorderLevel: item.reorderLevel,
        salesNeed: toQty(salesNeed),
        salesOrders: direct.map((s) => ({ soNo: s.soNo, qty: s.qty, customerName: s.customerName })),
        reason: salesNeed.gt(0) ? 'SALES_ORDER' : 'BELOW_REORDER',
        isBuyToOrder: item.isBuyToOrder,
        status: result.status,
        suggestedQty: toQty(result.suggestedQty),
        lastPrice: lastPrice === null ? null : toPrice(lastPrice),
        estValue: toMoney(lastPrice === null ? 0 : result.suggestedQty.mul(lastPrice)),
        coveredBy:
          result.status === 'COVERED'
            ? [...new Set([...poLines.map((l) => l.po.docNo), ...reqLines.map((l) => l.request.docNo)])].sort()
            : [],
      });
    }
    return lines;
  }

  /** The Demand screen (P04): lines, the four cards and when stock was last read. */
  async report(tenantId: string, branchCode?: string) {
    const [lines, stock] = await Promise.all([this.compute(tenantId, branchCode), this.stock.listStock(tenantId)]);
    const toBuy = lines.filter((l) => l.status === 'NEEDS_BUYING');
    const asOf = stock.reduce<string | null>((latest, s) => (!latest || s.asOf > latest ? s.asOf : latest), null);
    return {
      lines,
      asOf,
      kpis: {
        toBuy: toBuy.length,
        belowReorder: toBuy.filter((l) => l.reason === 'BELOW_REORDER').length,
        forSalesOrders: toBuy.filter((l) => l.reason === 'SALES_ORDER').length,
        covered: lines.filter((l) => l.status === 'COVERED').length,
        estimatedValue: toMoney(toBuy.reduce((sum, l) => sum.add(l.estValue), dec(0))),
      },
      connections: { inventory: this.stock.connected, sales: this.sales.connected },
    };
  }

  /**
   * Last price paid per item: the newer of the purchase history (old system, opening prices) and
   * released purchase orders.
   */
  async lastPrices(tenantId: string, itemCodes: string[]): Promise<Map<string, string>> {
    const [history, poLines] = await Promise.all([
      this.prisma.purPriceHistory.findMany({ where: { tenantId, itemCode: { in: itemCodes } }, orderBy: { docDate: 'desc' } }),
      this.prisma.purPurchaseOrderLine.findMany({
        where: { tenantId, itemCode: { in: itemCodes }, po: { releasedAt: { not: null } } },
        select: { itemCode: true, unitPrice: true, po: { select: { docDate: true } } },
        orderBy: { po: { docDate: 'desc' } },
      }),
    ]);
    const latest = new Map<string, { date: Date; price: string }>();
    const offer = (code: string, date: Date, price: string) => {
      const current = latest.get(code);
      if (!current || date > current.date) latest.set(code, { date, price });
    };
    for (const h of history) offer(h.itemCode, h.docDate, h.unitPrice.toString());
    for (const l of poLines) offer(l.itemCode, l.po.docDate, l.unitPrice.toString());
    return new Map([...latest].map(([code, v]) => [code, v.price]));
  }
}
