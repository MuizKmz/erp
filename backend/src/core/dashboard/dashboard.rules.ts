/** Core home (C01). Pure functions: counts grouped by status become the cards' numbers. */

export interface CountPart {
  key: string;
  label: string;
  count: number;
}

/**
 * Turns `groupBy` rows ({ value, count }) into parts in a fixed order, with 0 for a status nobody has yet, and the
 * total. Values not in `order` still count towards the total.
 */
export function statusParts(rows: { value: string | boolean; count: number }[], order: { key: string; label: string }[]): { total: number; parts: CountPart[] } {
  const byKey = new Map(rows.map((r) => [String(r.value), r.count]));
  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    parts: order.map((o) => ({ key: o.key, label: o.label, count: byKey.get(o.key) ?? 0 })),
  };
}

export const ACTIVE_ORDER = [
  { key: 'true', label: 'Active' },
  { key: 'false', label: 'Inactive' },
];
