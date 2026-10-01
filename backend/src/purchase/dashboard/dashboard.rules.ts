/**
 * Small decisions behind the Purchase home cards (PurHome.html).
 */

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
