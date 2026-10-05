/**
 * Document number format: prefix + running number padded to `digits`.
 * formatDocNo('PO-', 4, 7) → "PO-0007". Numbers past the padding keep growing ("PO-10000"); they are never cut.
 */
export function formatDocNo(prefix: string, digits: number, value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Running number must be a whole number of 1 or more (got ${value})`);
  }
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) {
    throw new Error(`Digits must be between 1 and 10 (got ${digits})`);
  }
  return `${prefix}${String(value).padStart(digits, '0')}`;
}

export type ResetEvery = 'NEVER' | 'MONTH';

/** The period a running number belongs to: "2609" for September 2026 when numbers restart monthly, else null. */
export function periodKeyFor(resetEvery: string, isoDate: string): string | null {
  return resetEvery === 'MONTH' ? `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}` : null;
}

/**
 * The number to hand out now. A monthly sequence starts again at 1 when the stored period is not this month.
 * Returns the value to use and what to store as the next value and period.
 */
export function nextInSequence(seq: { nextValue: number; resetEvery: string; periodKey: string | null }, isoDate: string) {
  const period = periodKeyFor(seq.resetEvery, isoDate);
  const value = period !== null && seq.periodKey !== period ? 1 : seq.nextValue;
  return { value, storeNext: value + 1, storePeriod: period };
}

/**
 * Applies a numbering format: {YYMM} → 2609, {YYYY} → 2026, {BR} → branch code, {####} → running number padded to
 * the number of #. formatPattern('EQ-{YYMM}-{####}', 11, '2026-09-29') → "EQ-2609-0011".
 */
export function formatPattern(pattern: string, value: number, isoDate: string, branchCode?: string | null): string {
  if (!/\{#+\}/.test(pattern)) throw new Error(`Numbering format needs a running number like {####} (got "${pattern}")`);
  if (pattern.includes('{BR}') && !branchCode) throw new Error(`Numbering format "${pattern}" needs a branch code`);
  return pattern
    .replace('{YYYY}', isoDate.slice(0, 4))
    .replace('{YYMM}', `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}`)
    .replace('{BR}', branchCode ?? '')
    .replace(/\{(#+)\}/, (_m, hashes: string) => formatDocNo('', hashes.length, value));
}
