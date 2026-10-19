/**
 * Reporting conventions the home-dashboard indicators share (RPT-037): month series and aging buckets. Pure.
 */

/** "2026-09" from a date (UTC calendar date, as dates are stored). */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The last n months up to and including today's: ["2026-04", …, "2026-09"]. */
export function lastMonths(today: string, n: number): string[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(Date.UTC(year, month - 1 - (n - 1 - i), 1));
    return m.toISOString().slice(0, 7);
  });
}

/** Aging buckets by days past the due date, the order an aging table reads in. */
export const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due', tone: 'muted' },
  { key: 'd30', label: '1–30 days overdue', tone: 'warning' },
  { key: 'd60', label: '31–60 days overdue', tone: 'warning' },
  { key: 'd90', label: '61–90 days overdue', tone: 'danger' },
  { key: 'over90', label: 'Over 90 days overdue', tone: 'danger' },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]['key'];

/** Which bucket a balance falls in on a day. No due date counts as not yet due. */
export function agingBucket(dueDate: string | null, today: string): AgingKey {
  if (!dueDate || dueDate >= today) return 'current';
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'over90';
}
