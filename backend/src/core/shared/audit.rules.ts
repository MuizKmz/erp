/**
 * Before-and-after audit for Core records (CLAUDE.md → Phase 3, rule 9). Pure functions: the services pass plain
 * objects and get back what changed, in words people can read in the Activity panel.
 */

export interface FieldChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** A value as people read it: decimals as stored text, dates as 2026-09-29, booleans Yes/No, blanks as null. */
export function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object' && value !== null && 'toFixed' in value && typeof (value as { toString: unknown }).toString === 'function') {
    return String(value); // Prisma.Decimal
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Two values are the same when they read the same ("40.00" and 40 for a decimal compare as numbers). */
function same(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const na = Number(a);
  const nb = Number(b);
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * The fields of `labels` whose value differs between `before` and `after`, in the order of `labels`.
 * `before` null means a new record: every field with a value counts as set.
 */
export function diffRecord(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, label] of Object.entries(labels)) {
    const from = before ? display(before[field]) : null;
    const to = display(after[field]);
    if (!same(from, to)) changes.push({ field, label, from, to });
  }
  return changes;
}

/** "Changed credit limit 50,000 → 150,000 and overdue limit 5,000 → 6,000" (the first `max`, then "and 2 more"). */
export function changeMessage(changes: FieldChange[], max = 3): string {
  if (changes.length === 0) return 'No changes';
  const words = changes.slice(0, max).map((c) => `${c.label.toLowerCase()} ${c.from ?? '(blank)'} → ${c.to ?? '(blank)'}`);
  const more = changes.length - max;
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!;
  return `Changed ${list}${more > 0 ? ` and ${more} more` : ''}`;
}
