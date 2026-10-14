/**
 * Reference-list rules (CLAUDE.md → Phase 3 · Core business rule 3, last point; decision 1). Item groups, customer
 * categories, areas and credit terms are the short lists that items, customers and suppliers pick from. Records keep
 * the name (or the days, for a credit term), so a name in use never changes and an entry in use is never deleted: it
 * is made inactive, and new records can no longer pick it. Pure functions.
 */
import { lookAlikeNames } from '../dashboard/dashboard.rules';

export const REFERENCE_LISTS = ['item-groups', 'customer-categories', 'areas', 'credit-terms'] as const;
export type ReferenceList = (typeof REFERENCE_LISTS)[number];

export const LIST_WORDS: Record<ReferenceList, { one: string; title: string }> = {
  'item-groups': { one: 'item group', title: 'Item groups' },
  'customer-categories': { one: 'customer category', title: 'Customer categories' },
  areas: { one: 'area', title: 'Areas' },
  'credit-terms': { one: 'credit term', title: 'Credit terms' },
};

/** Who uses an entry: items for a group; customers for a category or area; customers and suppliers for a credit term. */
export interface ReferenceUse {
  items?: number;
  customers?: number;
  suppliers?: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const usedCount = (u: ReferenceUse) => (u.items ?? 0) + (u.customers ?? 0) + (u.suppliers ?? 0);

/** "1 item", "6 customers · 10 suppliers", "Not used" */
export function usedByText(u: ReferenceUse): string {
  const parts = [
    u.items ? plural(u.items, 'item') : null,
    u.customers ? plural(u.customers, 'customer') : null,
    u.suppliers ? plural(u.suppliers, 'supplier') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not used';
}

/** "Cash" for 0 days, else "30 days": the name a new credit term is offered. */
export const creditTermName = (days: number) => (days === 0 ? 'Cash' : `${days} days`);

/** Records keep the name, so it changes only while nothing uses it. A credit term is kept by its days instead. */
export function renameError(list: ReferenceList, name: string, u: ReferenceUse): string | null {
  if (list === 'credit-terms' || usedCount(u) === 0) return null;
  return `“${name}” is used by ${usedByText(u)}, so its name cannot change. Add the new name, move them to it, then make “${name}” inactive.`;
}

/** Customers and suppliers keep a credit term by its days, so the days change only while nothing uses it. */
export function daysChangeError(name: string, u: ReferenceUse): string | null {
  if (usedCount(u) === 0) return null;
  return `${name} is used by ${usedByText(u)}, so its days cannot change. Add a new credit term instead.`;
}

export function referenceDeleteRefusal(name: string, u: ReferenceUse): string | null {
  if (usedCount(u) === 0) return null;
  return `“${name}” is used by ${usedByText(u)}, so it cannot be deleted. Make it inactive instead.`;
}

/**
 * The C12 banner for item groups that look like one ("Service" and "Services"): moving the smaller group's items to
 * the larger leaves one. Only the first such pair is named.
 */
export function lookAlikeWarning(groups: { name: string; items: string[] }[]): string | null {
  const pair = lookAlikeNames(groups.map((g) => g.name))[0];
  if (!pair) return null;
  const sized = pair.map((name) => groups.find((g) => g.name === name)!).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  const keep = sized[0]!;
  const move = sized.slice(1).flatMap((g) => g.items);
  const names = pair.map((n) => `“${n}”`).join(' and ');
  if (!move.length) return `${names} look like the same group. One of them is not used and can be deleted.`;
  const shown = move.slice(0, 3).join(', ') + (move.length > 3 ? ' …' : '');
  const others = sized.slice(1).map((g) => `“${g.name}”`).join(' and ');
  return `${names} look like the same group. Moving ${shown} to “${keep.name}” would leave one: change the group on the item, then make ${others} inactive.`;
}

export const REFERENCE_LABELS: Record<string, string> = { name: 'Name', days: 'Days', isActive: 'Status' };
