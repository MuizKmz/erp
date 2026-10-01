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
