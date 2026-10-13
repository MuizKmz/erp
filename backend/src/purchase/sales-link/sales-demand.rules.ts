import type { Prisma } from '@prisma/client';
import type { SalesDemand } from '../../integration/integration.ports';
import { dec, toMoney, toQty, type DecimalInput } from '../../platform/http/decimal';
import { isRecord, text } from '../../platform/outbox/outbox.payload';
import type { ReleasedSalesOrder } from './buy-to-order.rules';

/**
 * Purchase's own copy of open sales-order needs (P04 demand, P06 insights). Kept from Sales events, never read from
 * Sales tables. Pure functions; SalesDemandListener does the reading and writing.
 */

const BUSINESS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The business date (Kuala Lumpur) of a moment, as "2026-09-29". */
export function businessDate(moment: string | Date): string {
  return BUSINESS_DAY.format(new Date(moment));
}

export interface DemandRowInput {
  soNo: string;
  soLineNo: number;
  soDate: string;
  customerName: string;
  soTotal: string;
  branchCode: string;
  itemCode: string;
  uomCode: string;
  orderedQty: string;
  isBuyToOrder: boolean;
  neededBy: string | null;
}

/** One demand row per line of a released sales order. Older events carry no date or total: the event's day and 0. */
export function demandRowsFromRelease(order: ReleasedSalesOrder, occurredAt: string): DemandRowInput[] {
  return order.lines.map((l) => ({
    soNo: order.soNo,
    soLineNo: l.lineNo,
    soDate: order.docDate ?? businessDate(occurredAt),
    customerName: order.customerName ?? '',
    soTotal: order.total ?? '0.00',
    branchCode: order.branchCode,
    itemCode: l.itemCode,
    uomCode: l.uomCode,
    orderedQty: l.qty,
    isBuyToOrder: l.isBuyToOrder,
    neededBy: order.deliveryWantedBy,
  }));
}

/**
 * `sales.shipment.requested` and `sales.order.balance_cancelled`: the order and the quantity per sales-order line.
 * `soLineField` names the field holding the sales-order line number: a delivery numbers its own lines (`lineNo`) and
 * gives the order's line as `soLineNo`; a cancel order's `lineNo` is the order's line. An older delivery event
 * without `soLineNo` gives null, and the line is then matched by item.
 */
export function readLineQtyEvent(
  payload: unknown,
  soLineField: 'soLineNo' | 'lineNo',
): { soNo: string; lines: { lineNo: number | null; itemCode: string; qty: string }[] } | null {
  if (!isRecord(payload) || !text(payload.soNo) || !Array.isArray(payload.lines)) return null;
  return {
    soNo: text(payload.soNo)!,
    lines: payload.lines.filter(isRecord).flatMap((l) => {
      const itemCode = text(l.itemCode);
      const qty = text(l.qty);
      const lineNo = l[soLineField];
      return itemCode && qty ? [{ lineNo: typeof lineNo === 'number' ? lineNo : null, itemCode, qty }] : [];
    }),
  };
}

/**
 * Matches event lines to the stored rows of that order. Returns the increments, and the lines with no row: the
 * listener then refuses the event so it is retried after the order's release has been handled.
 */
export function matchLines<T extends { id: string; soLineNo: number; itemCode: string }>(
  rows: T[],
  lines: { lineNo: number | null; itemCode: string; qty: string }[],
): { updates: { id: string; add: Prisma.Decimal }[]; missing: string[] } {
  const updates: { id: string; add: Prisma.Decimal }[] = [];
  const missing: string[] = [];
  for (const l of lines) {
    const row = rows.find((r) => r.itemCode === l.itemCode && (l.lineNo === null || r.soLineNo === l.lineNo));
    if (row) updates.push({ id: row.id, add: dec(l.qty) });
    else missing.push(`${l.lineNo === null ? '' : `line ${l.lineNo} `}${l.itemCode}`);
  }
  return { updates, missing };
}

/** Still to deliver on a sales-order line: ordered − delivered − cancelled, never below 0. */
export function openQty(row: { orderedQty: DecimalInput; deliveredQty: DecimalInput; cancelledQty: DecimalInput }): Prisma.Decimal {
  const open = dec(row.orderedQty).sub(dec(row.deliveredQty)).sub(dec(row.cancelledQty));
  return open.gt(0) ? open : dec(0);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Stored rows → what the demand list reads: open lines only, as DIRECT needs (Sales knows no bills of material). */
export function toSalesDemand(
  rows: {
    soNo: string; soDate: Date; customerName: string; soTotal: DecimalInput; branchCode: string; itemCode: string;
    orderedQty: DecimalInput; deliveredQty: DecimalInput; cancelledQty: DecimalInput; isBuyToOrder: boolean; neededBy: Date | null;
  }[],
): SalesDemand[] {
  return rows
    .map((r) => ({ r, open: openQty(r) }))
    .filter(({ open }) => open.gt(0))
    .map(({ r, open }) => ({
      soNo: r.soNo,
      soDate: iso(r.soDate),
      customerName: r.customerName,
      soTotal: toMoney(r.soTotal),
      branchCode: r.branchCode,
      itemCode: r.itemCode,
      qty: toQty(open),
      kind: 'DIRECT' as const,
      isBuyToOrder: r.isBuyToOrder,
      neededBy: r.neededBy ? iso(r.neededBy) : null,
    }));
}
