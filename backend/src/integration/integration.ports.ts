/**
 * What Purchase reads from other modules, behind ports so nothing in purchase/ changes when the source does.
 * - Stock: a stub adapter over the read-only inv_stock_snapshot until Inventory is connected.
 * - Sales demand: Purchase's own copy (pur_sales_demand), kept from Sales events (purchase/sales-link).
 *
 * `connected` is false for stubs; screens use it to show the amber "… is not connected yet" banner.
 */

export const STOCK_PORT = Symbol('STOCK_PORT');
export const SALES_DEMAND_PORT = Symbol('SALES_DEMAND_PORT');

export interface StockLevel {
  itemCode: string;
  warehouseCode: string;
  onHand: string;
  usedLast30Days: string;
  asOf: string;
}

export interface StockPort {
  readonly connected: boolean;
  listStock(tenantId: string, itemCodes?: string[]): Promise<StockLevel[]>;
}

export interface SalesDemand {
  soNo: string;
  soDate: string;
  customerName: string;
  soTotal: string;
  branchCode: string;
  itemCode: string;
  qty: string;
  /** DIRECT: the order sells this item. COMPONENT: the item is used to make what is sold. */
  kind: 'DIRECT' | 'COMPONENT';
  isBuyToOrder: boolean;
  neededBy: string | null;
}

export interface SalesOrderSummary {
  soNo: string;
  customerName: string;
  soTotal: string;
}

export interface SalesDemandPort {
  readonly connected: boolean;
  listOpenDemand(tenantId: string, itemCodes?: string[]): Promise<SalesDemand[]>;
  /** Customer and value of a sales order, for buy-to-order POs. */
  findSalesOrder(tenantId: string, soNo: string): Promise<SalesOrderSummary | null>;
}
