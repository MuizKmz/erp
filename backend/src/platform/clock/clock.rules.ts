/** Business dates are calendar dates in Asia/Kuala_Lumpur, written as YYYY-MM-DD. */
export const BUSINESS_TIMEZONE = 'Asia/Kuala_Lumpur';

/** The calendar date of a moment in the business timezone: 2026-09-28T17:30Z → "2026-09-29" (01:30 in KL). */
export function businessDate(moment: Date, timeZone = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(moment);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A YYYY-MM-DD date as the Date Prisma uses for DATE columns (UTC midnight). */
export function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** First and last day of the month of a YYYY-MM-DD date, as DATE values. */
export function monthRange(isoDate: string): { from: Date; to: Date; month: string } {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from, to, month: `${y}-${String(m).padStart(2, '0')}` };
}

/**
 * "Now" with the date replaced by a fixed business date but the real time of day kept,
 * for DEV_TODAY: the screens look like 29 Sep while the clock still ticks.
 */
export function shiftToDate(now: Date, isoDate: string, timeZone = BUSINESS_TIMEZONE): Date {
  const realDate = dateOnly(businessDate(now, timeZone));
  const wanted = dateOnly(isoDate);
  return new Date(now.getTime() + (wanted.getTime() - realDate.getTime()));
}
