/**
 * Core's rules on top of the record-usage check (CLAUDE.md → Phase 3 · Core business rules 3 and 4). Delete only while
 * nothing uses a record (SRS DR-002, FR-MST-049); block or discontinue only while no open document uses it
 * (SDD §5.3.1). Pure functions; the forms in C2–C4 use them.
 */
import type { RecordUsage, UsageKind } from '../../platform/usage/record-usage.types';

/** URL segment → kind, for /api/v1/core/usage/:kind/:code. */
export const USAGE_PATHS: Record<string, UsageKind> = {
  item: 'ITEM',
  customer: 'CUSTOMER',
  supplier: 'SUPPLIER',
  uom: 'UOM',
  'tax-code': 'TAX_CODE',
  'price-list': 'PRICE_LIST',
  warehouse: 'WAREHOUSE',
};

export function kindFromPath(segment: string): UsageKind | null {
  return Object.prototype.hasOwnProperty.call(USAGE_PATHS, segment) ? USAGE_PATHS[segment]! : null;
}

/** "Item", for "Item not found." */
export const KIND_LABEL: Record<UsageKind, string> = {
  ITEM: 'Item',
  CUSTOMER: 'Customer',
  SUPPLIER: 'Supplier',
  UOM: 'Unit of measure',
  TAX_CODE: 'Tax code',
  PRICE_LIST: 'Price list',
  WAREHOUSE: 'Warehouse',
};

/** What to do instead of deleting a record that is used. */
const INSTEAD: Record<UsageKind, string> = {
  ITEM: 'Discontinue it instead.',
  CUSTOMER: 'Block it instead.',
  SUPPLIER: 'Block it instead.',
  UOM: 'Make it inactive instead.',
  TAX_CODE: 'Make it inactive instead.',
  PRICE_LIST: 'Deactivate it instead.',
  WAREHOUSE: 'Make it inactive instead.',
};

/** A Core record that points to this one (an item's prices, a customer's price list …), counted by Core itself. */
export interface CoreReference {
  label: string;
  count: number;
}

function joinPlaces(places: string[]): string {
  return places.length <= 1 ? (places[0] ?? '') : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
}

/** Why the record cannot be deleted, or null when nothing uses it and it may go. */
export function deleteRefusal(kind: UsageKind, code: string, usage: Pick<RecordUsage, 'documents' | 'references'>, core: CoreReference[] = []): string | null {
  const places: string[] = [];
  if (usage.documents > 0) places.push(`on ${usage.documents} document${usage.documents === 1 ? '' : 's'}`);
  for (const r of [...usage.references, ...core].filter((r) => r.count > 0)) places.push(`in ${r.label} (${r.count})`);
  if (!places.length) return null;
  return `${code} is used ${joinPlaces(places)}, so it cannot be deleted. ${INSTEAD[kind]}`;
}

/** Why the record cannot be blocked or discontinued yet, or null when no open document uses it. */
export function deactivateRefusal(code: string, usage: Pick<RecordUsage, 'open'>): string | null {
  const n = usage.open.length;
  if (n === 0) return null;
  const shown = usage.open.slice(0, 3).map((o) => o.docNo).join(', ') + (n > 3 ? ' …' : '');
  return `${code} is on ${n} open document${n === 1 ? '' : 's'} (${shown}). Finish or cancel ${n === 1 ? 'it' : 'them'} first.`;
}
