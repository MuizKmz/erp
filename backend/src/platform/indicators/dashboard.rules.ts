/**
 * A person's home dashboard layout (SRS RPT-039): which cards, in which order, in 2 or 3 columns. Pure.
 */
import type { FieldError } from '../http/errors';

/** More cards than this stops being a summary. */
export const MAX_CARDS = 12;

export const COLUMN_CHOICES = [2, 3] as const;

export interface BoardLayout {
  cols: 2 | 3;
  cards: string[];
}

/** What is wrong with a layout someone wants to save, against the cards they may use. */
export function layoutErrors(layout: BoardLayout, allowed: ReadonlySet<string>): FieldError[] {
  const errors: FieldError[] = [];
  if (!(COLUMN_CHOICES as readonly number[]).includes(layout.cols)) errors.push({ field: 'cols', message: 'Pick 2 or 3 columns.' });
  if (layout.cards.length > MAX_CARDS) errors.push({ field: 'cards', message: `A dashboard holds at most ${MAX_CARDS} charts. Remove one first.` });
  const twice = layout.cards.filter((k, i) => layout.cards.indexOf(k) !== i);
  if (twice.length) errors.push({ field: 'cards', message: `A chart can be on the dashboard once (${[...new Set(twice)].join(', ')}).` });
  const unknown = layout.cards.filter((k) => !allowed.has(k));
  if (unknown.length) errors.push({ field: 'cards', message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a chart' : 'are not charts'} you can add here.` });
  return errors;
}

/**
 * The layout to show: the saved one, or the module's default when there is none. Cards the person may no longer see
 * (a role taken away) or that the module no longer offers are left out without an error.
 */
export function effectiveLayout(
  saved: { cols: number; cards: unknown } | null,
  defaults: BoardLayout,
  allowed: ReadonlySet<string>,
): { layout: BoardLayout; isDefault: boolean } {
  if (!saved) return { layout: { cols: defaults.cols, cards: defaults.cards.filter((k) => allowed.has(k)) }, isDefault: true };
  const cards = Array.isArray(saved.cards) ? saved.cards.filter((k): k is string => typeof k === 'string' && allowed.has(k)) : [];
  return { layout: { cols: saved.cols === 3 ? 3 : 2, cards: [...new Set(cards)] }, isDefault: false };
}
