/**
 * Reading dated master data (SRS BR-TAX-006, BR-PRC-003/004). Tax codes keep one row per rate period and prices one
 * row per start date, so "the rate" or "the price" always means the row valid on a given day. Pure functions.
 */

export interface Dated {
  validFrom: Date;
  /** Empty = open-ended. Prices have none: a later row takes over from its own date. */
  validTo?: Date | null;
}

/** True when the row is valid on the day: validFrom ≤ day ≤ validTo (validTo empty = no end). */
export function validOn(row: Dated, on: Date): boolean {
  return row.validFrom.getTime() <= on.getTime() && (!row.validTo || row.validTo.getTime() >= on.getTime());
}

/**
 * For each key, the row valid on the day with the latest validFrom: the rate in force, or the newest price that has
 * started. Keys with no valid row are left out. Rows come back in the order their keys first appear.
 */
export function latestValidByKey<T extends Dated>(rows: T[], key: (row: T) => string, on: Date): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (!validOn(row, on)) continue;
    const k = key(row);
    const current = best.get(k);
    if (!current || row.validFrom.getTime() > current.validFrom.getTime()) best.set(k, row);
  }
  const order = [...new Set(rows.map(key))];
  return order.flatMap((k) => (best.has(k) ? [best.get(k)!] : []));
}
