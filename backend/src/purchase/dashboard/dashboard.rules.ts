/**
 * Small decisions behind the Purchase home cards (PurHome.html).
 */
import { dec } from '../../platform/http/decimal';

export interface WaitingOrder {
  docNo: string;
  /** YYYY-MM-DD, or null when no date was given. */
  expectedDate: string | null;
  /** A draft goods receipt exists: the goods are being counted right now. */
  beingReceived: boolean;
}

/**
 * "next due 30 Sep": the earliest expected date from today on, among orders still waiting for goods.
 * Orders already being counted (a draft receipt exists) and late orders do not count.
 */
export function nextDueDate(orders: WaitingOrder[], today: string): string | null {
  const due = orders
    .filter((o) => !o.beingReceived && o.expectedDate !== null && o.expectedDate >= today)
    .map((o) => o.expectedDate as string)
    .sort();
  return due[0] ?? null;
}

export interface BuySoonCandidate {
  itemCode: string;
  reason: 'BELOW_REORDER' | 'SALES_ORDER';
}

/** "Buy soon": items below reorder first (they run out on their own), then sales-order needs; by code. */
export function pickBuySoon<T extends BuySoonCandidate>(lines: T[], limit = 3): T[] {
  const rank = (l: T) => (l.reason === 'BELOW_REORDER' ? 0 : 1);
  return [...lines].sort((a, b) => rank(a) - rank(b) || a.itemCode.localeCompare(b.itemCode)).slice(0, limit);
}

/** A quantity as people read it: "5", "12.5". */
const qty = (value: string) => dec(value).toString();

/** "5 left · reorder 20", or "0 left · SO-0001 needs 40" when sales orders are why it must be bought. */
export function buySoonNote(b: { onHand: string; reorderLevel: string | null; reason: string; salesOrders: { soNo: string; qty: string }[] }): string {
  const left = `${qty(b.onHand)} left`;
  if (b.reason === 'SALES_ORDER' && b.salesOrders.length) return `${left} · ${b.salesOrders.map((s) => `${s.soNo} needs ${qty(s.qty)}`).join(', ')}`;
  return b.reorderLevel === null ? left : `${left} · reorder ${qty(b.reorderLevel)}`;
}

/** "Perabot Kayu Timur · for SO-0003", "Cat Warna Sdn Bhd · migrated" on the recent orders card. */
export function supplierLine(o: { supplierName: string; salesOrderNo: string | null; isMigrated: boolean }): string {
  return `${o.supplierName}${o.salesOrderNo ? ` · for ${o.salesOrderNo}` : ''}${o.isMigrated ? ' · migrated' : ''}`;
}

