import { isRecord, text } from '../../platform/outbox/outbox.payload';

/**
 * Buy-to-order (FlowP1 step 7, CLAUDE.md S10). When Sales releases an order with buy-to-order lines, Purchase
 * drafts one PO per supplier. Pure functions; the listener does the reading and writing.
 */

/** What Purchase needs from `sales.order.released`. Purchase never imports Sales, so the shape is its own. */
export interface ReleasedSalesOrder {
  soNo: string;
  branchCode: string;
  customerName: string | null;
  warehouseCode: string | null;
  /** Order date, total and wanted-by date, for the demand list. Older events have no date or total. */
  docDate: string | null;
  total: string | null;
  deliveryWantedBy: string | null;
  lines: { lineNo: number; itemCode: string; uomCode: string; qty: string; isBuyToOrder: boolean }[];
}

/** Reads the event payload. Returns null when it is not a usable sales order (the event is then ignored). */
export function readReleasedSalesOrder(payload: unknown): ReleasedSalesOrder | null {
  if (!isRecord(payload) || !Array.isArray(payload.lines)) return null;
  const soNo = text(payload.soNo);
  const branchCode = text(payload.branchCode);
  if (!soNo || !branchCode) return null;
  const lines = payload.lines.filter(isRecord).flatMap((l) => {
    const itemCode = text(l.itemCode);
    const qty = text(l.qty);
    if (!itemCode || !qty || typeof l.lineNo !== 'number') return [];
    return [{ lineNo: l.lineNo, itemCode, uomCode: text(l.uomCode) ?? '', qty, isBuyToOrder: l.isBuyToOrder === true }];
  });
  return {
    soNo,
    branchCode,
    customerName: text(payload.customerName),
    warehouseCode: text(payload.warehouseCode),
    docDate: text(payload.docDate),
    total: text(payload.total),
    deliveryWantedBy: text(payload.deliveryWantedBy),
    lines,
  };
}

export interface PlanItem {
  code: string;
  status: string;
  isPurchasable: boolean;
  preferredSupplierCode: string | null;
  /** The unit Purchase buys in (the PO line takes it). */
  uomCode: string;
}

export interface PlannedLine {
  soLineNo: number;
  itemCode: string;
  qty: string;
  unitPrice: string;
  /** Contract price for that supplier, else the last price paid, else none (the buyer enters it). */
  priceFrom: 'CONTRACT' | 'LAST' | 'NONE';
}

export interface BuyToOrderPlan {
  drafts: { supplierCode: string; lines: PlannedLine[] }[];
  /** Lines Purchase cannot draft, with the reason Sales shows on the order. */
  skipped: { soLineNo: number; itemCode: string; reason: string }[];
  /** Lines already on a PO for this sales order (the event came again, or the order was released again). */
  alreadyOrdered: { soLineNo: number; itemCode: string; poNo: string }[];
}

/**
 * Groups the buy-to-order lines by the item's preferred supplier.
 * - Only active purchasable items, and only active suppliers when that switch is on (rule 6).
 * - Only lines sold in the unit Purchase buys in (no unit conversion here).
 * - An item already on a PO drafted for this sales order is not drafted again.
 * Lines keep the sales order's quantity.
 */
export function planBuyToOrder(input: {
  order: ReleasedSalesOrder;
  items: PlanItem[];
  suppliers: { code: string; name: string; status: string }[];
  onlyActiveSuppliers: boolean;
  contracts: { itemCode: string; supplierCode: string; unitPrice: string }[];
  lastPrices: Map<string, string>;
  /** itemCode → PO number, for POs already drafted for this sales order. */
  existing: Map<string, string>;
}): BuyToOrderPlan {
  const plan: BuyToOrderPlan = { drafts: [], skipped: [], alreadyOrdered: [] };
  for (const line of input.order.lines.filter((l) => l.isBuyToOrder)) {
    const poNo = input.existing.get(line.itemCode);
    if (poNo) {
      plan.alreadyOrdered.push({ soLineNo: line.lineNo, itemCode: line.itemCode, poNo });
      continue;
    }
    const skip = (reason: string) => plan.skipped.push({ soLineNo: line.lineNo, itemCode: line.itemCode, reason });
    const item = input.items.find((i) => i.code === line.itemCode);
    if (!item || !item.isPurchasable || item.status !== 'ACTIVE') {
      skip(`${line.itemCode} is not an active purchasable item in Master Data.`);
      continue;
    }
    if (!item.preferredSupplierCode) {
      skip(`${line.itemCode} has no preferred supplier in Master Data.`);
      continue;
    }
    // The PO line is in the purchase unit. Master Data gives Purchase no conversion, so a different sales unit
    // (24 PCS sold, bought by the BOX) is left to the buyer rather than drafted with the wrong quantity.
    if (line.uomCode && line.uomCode !== item.uomCode) {
      skip(`${line.itemCode} is sold in ${line.uomCode} but bought in ${item.uomCode}. The buyer raises this PO by hand.`);
      continue;
    }
    const supplier = input.suppliers.find((s) => s.code === item.preferredSupplierCode);
    if (!supplier) {
      skip(`Supplier ${item.preferredSupplierCode} is not in Master Data.`);
      continue;
    }
    if (input.onlyActiveSuppliers && supplier.status !== 'ACTIVE') {
      skip(`${supplier.name} is blocked in Master Data. Only active suppliers can be used.`);
      continue;
    }
    const contract = input.contracts.find((c) => c.itemCode === line.itemCode && c.supplierCode === supplier.code);
    const last = input.lastPrices.get(line.itemCode);
    const planned: PlannedLine = {
      soLineNo: line.lineNo,
      itemCode: line.itemCode,
      qty: line.qty,
      unitPrice: contract?.unitPrice ?? last ?? '0',
      priceFrom: contract ? 'CONTRACT' : last ? 'LAST' : 'NONE',
    };
    const draft = plan.drafts.find((d) => d.supplierCode === supplier.code);
    if (draft) draft.lines.push(planned);
    else plan.drafts.push({ supplierCode: supplier.code, lines: [planned] });
  }
  return plan;
}

/** Remark on the drafted PO telling the buyer where prices came from and what still needs doing. */
export function draftRemark(soNo: string, lines: PlannedLine[]): string {
  const missing = lines.filter((l) => l.priceFrom === 'NONE').map((l) => l.itemCode);
  const contract = lines.every((l) => l.priceFrom === 'CONTRACT');
  const parts = [`Buy to order for ${soNo}.`];
  if (contract) parts.push('Contract price, no RFQ needed.');
  if (missing.length) parts.push(`No contract or last price for ${missing.join(', ')}: enter the price before submitting.`);
  return parts.join(' ');
}
