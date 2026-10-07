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
