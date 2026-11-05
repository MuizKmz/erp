import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Sales reports (S05). Pure functions. */

export interface ReportOrder {
  docNo: string;
  customerCode: string;
  customerName: string;
  agentCode: string;
  agentName: string;
  total: DecimalInput;
}

export interface CustomerRow {
  customerCode: string;
  customerName: string;
  orders: number;
  ordered: Prisma.Decimal;
  invoiced: Prisma.Decimal;
  cancelled: Prisma.Decimal;
  open: Prisma.Decimal;
  sharePct: number;
}

/**
 * Sales by customer: ordered (order totals, tax included), invoiced (released invoices on those orders, before
 * returns), cancelled (released cancel orders) and still open = ordered − invoiced − cancelled, never below 0.
 * Sorted by ordered, largest first; share is each customer's part of everything ordered.
 */
export function salesByCustomer(
  orders: ReportOrder[],
  invoicedByOrder: Map<string, DecimalInput>,
  cancelledByOrder: Map<string, DecimalInput>,
): { rows: CustomerRow[]; totals: { orders: number; ordered: Prisma.Decimal; invoiced: Prisma.Decimal; cancelled: Prisma.Decimal; open: Prisma.Decimal } } {
  const byCustomer = new Map<string, CustomerRow>();
  for (const o of orders) {
    const row = byCustomer.get(o.customerCode) ?? { customerCode: o.customerCode, customerName: o.customerName, orders: 0, ordered: dec(0), invoiced: dec(0), cancelled: dec(0), open: dec(0), sharePct: 0 };
    row.orders += 1;
    row.ordered = row.ordered.add(dec(o.total));
    row.invoiced = row.invoiced.add(dec(invoicedByOrder.get(o.docNo) ?? 0));
    row.cancelled = row.cancelled.add(dec(cancelledByOrder.get(o.docNo) ?? 0));
    byCustomer.set(o.customerCode, row);
  }
  const rows = [...byCustomer.values()];
  const ordered = rows.reduce((s, r) => s.add(r.ordered), dec(0));
  for (const r of rows) {
    const open = r.ordered.sub(r.invoiced).sub(r.cancelled);
    r.open = open.gt(0) ? open : dec(0);
    r.sharePct = ordered.gt(0) ? r.ordered.div(ordered).mul(100).toDecimalPlaces(1).toNumber() : 0;
  }
  rows.sort((a, b) => b.ordered.comparedTo(a.ordered) || a.customerName.localeCompare(b.customerName));
  return {
    rows,
    totals: {
      orders: orders.length,
      ordered,
      invoiced: rows.reduce((s, r) => s.add(r.invoiced), dec(0)),
      cancelled: rows.reduce((s, r) => s.add(r.cancelled), dec(0)),
      open: rows.reduce((s, r) => s.add(r.open), dec(0)),
    },
  };
}

export interface ItemOrderLine {
  soLineId: string;
  docNo: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  orderedQty: DecimalInput;
  deliveredQty: DecimalInput;
  invoicedQty: DecimalInput;
  /** Net amount plus tax, as on the order. */
  value: DecimalInput;
}

export interface ItemRow {
  itemCode: string;
  itemName: string;
  uomCode: string;
  orders: number;
  orderedQty: Prisma.Decimal;
  deliveredQty: Prisma.Decimal;
  invoicedQty: Prisma.Decimal;
  ordered: Prisma.Decimal;
  invoiced: Prisma.Decimal;
  cancelled: Prisma.Decimal;
  open: Prisma.Decimal;
  sharePct: number;
}

const shareOf = (part: Prisma.Decimal, whole: Prisma.Decimal) => (whole.gt(0) ? part.div(whole).mul(100).toDecimalPlaces(1).toNumber() : 0);

/**
 * Sales by item: the order lines behind Sales by customer, per item and unit (quantities only add up within one
 * unit). Invoiced and cancelled come from the released invoice and cancel-order lines on those order lines, so they
 * agree with Sales by customer; open = ordered − invoiced − cancelled, never below 0. Largest first.
 */
export function salesByItem(
  lines: ItemOrderLine[],
  invoicedByLine: Map<string, DecimalInput>,
  cancelledByLine: Map<string, DecimalInput>,
): { rows: ItemRow[]; totals: { orders: number; ordered: Prisma.Decimal; invoiced: Prisma.Decimal; cancelled: Prisma.Decimal; open: Prisma.Decimal } } {
  const byItem = new Map<string, ItemRow & { docNos: Set<string> }>();
  for (const l of lines) {
    const key = `${l.itemCode}|${l.uomCode}`;
    const row = byItem.get(key) ?? {
      itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, orders: 0, docNos: new Set<string>(),
      orderedQty: dec(0), deliveredQty: dec(0), invoicedQty: dec(0), ordered: dec(0), invoiced: dec(0), cancelled: dec(0), open: dec(0), sharePct: 0,
    };
    row.docNos.add(l.docNo);
    row.orderedQty = row.orderedQty.add(dec(l.orderedQty));
    row.deliveredQty = row.deliveredQty.add(dec(l.deliveredQty));
    row.invoicedQty = row.invoicedQty.add(dec(l.invoicedQty));
    row.ordered = row.ordered.add(dec(l.value));
    row.invoiced = row.invoiced.add(dec(invoicedByLine.get(l.soLineId) ?? 0));
    row.cancelled = row.cancelled.add(dec(cancelledByLine.get(l.soLineId) ?? 0));
    byItem.set(key, row);
  }
  const all = [...byItem.values()];
  const ordered = all.reduce((s, r) => s.add(r.ordered), dec(0));
  const rows = all.map(({ docNos, ...r }) => {
    const open = r.ordered.sub(r.invoiced).sub(r.cancelled);
    return { ...r, orders: docNos.size, open: open.gt(0) ? open : dec(0), sharePct: shareOf(r.ordered, ordered) };
  });
  rows.sort((a, b) => b.ordered.comparedTo(a.ordered) || a.itemCode.localeCompare(b.itemCode));
  return {
    rows,
    totals: {
      orders: new Set(lines.map((l) => l.docNo)).size,
      ordered,
      invoiced: rows.reduce((s, r) => s.add(r.invoiced), dec(0)),
      cancelled: rows.reduce((s, r) => s.add(r.cancelled), dec(0)),
      open: rows.reduce((s, r) => s.add(r.open), dec(0)),
    },
  };
}

/** By item group: how many items and how much was ordered, largest first. Items without a group come last. */
export function salesByItemGroup(rows: { itemCode: string; ordered: Prisma.Decimal }[], groupOf: (itemCode: string) => string | null): { group: string; items: number; ordered: Prisma.Decimal; sharePct: number }[] {
  const map = new Map<string, { items: Set<string>; ordered: Prisma.Decimal }>();
  for (const r of rows) {
    const group = groupOf(r.itemCode) ?? 'No group';
    const g = map.get(group) ?? { items: new Set<string>(), ordered: dec(0) };
    g.items.add(r.itemCode);
    g.ordered = g.ordered.add(r.ordered);
    map.set(group, g);
  }
  const total = rows.reduce((s, r) => s.add(r.ordered), dec(0));
  return [...map]
    .map(([group, g]) => ({ group, items: g.items.size, ordered: g.ordered, sharePct: shareOf(g.ordered, total) }))
    .sort((a, b) => (a.group === 'No group' ? 1 : 0) - (b.group === 'No group' ? 1 : 0) || b.ordered.comparedTo(a.ordered));
}

/** By sales agent: number of orders and value ordered, largest first. */
export function salesByAgent(orders: ReportOrder[]): { agentCode: string; agentName: string; orders: number; ordered: Prisma.Decimal }[] {
  const map = new Map<string, { agentCode: string; agentName: string; orders: number; ordered: Prisma.Decimal }>();
  for (const o of orders) {
    const row = map.get(o.agentCode) ?? { agentCode: o.agentCode, agentName: o.agentName, orders: 0, ordered: dec(0) };
    row.orders += 1;
    row.ordered = row.ordered.add(dec(o.total));
    map.set(o.agentCode, row);
  }
  return [...map.values()].sort((a, b) => b.ordered.comparedTo(a.ordered));
}

/** "2026-09" → first and last day of that month. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}
