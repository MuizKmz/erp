/**
 * Price-list rules (CLAUDE.md → Phase 3 · Core business rules 1, 3, 8; SRS FR-MST-030 to 032, BR-PRC-003/004).
 * Pure functions; the service loads the data and turns the answers into 400 / 409 responses.
 *
 * Prices are dated: per item and unit, the row with the latest start on or before a date is the price on that date.
 * A price dated before today is history, so the price on any past date can still be shown; it is never changed or
 * removed. A new price starts today or later, and a future price waits for its date.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { FieldError } from '../../platform/http/errors';
import { changeMessage, dayText, type FieldChange } from '../shared/audit.rules';

/** STD-2026, RES-2026: a capital or digit first, then capitals, digits and dashes, up to 20. Typed once; it never changes. */
export const PRICE_LIST_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

export type PriceListStatus = 'ACTIVE' | 'INACTIVE';
export const STATUS_LABEL: Record<PriceListStatus, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
export const statusOf = (isActive: boolean): PriceListStatus => (isActive ? 'ACTIVE' : 'INACTIVE');

/** "Exclude tax" / "Include tax", as C08 and C09 say it. */
export const taxText = (taxInclusive: boolean) => (taxInclusive ? 'Include tax' : 'Exclude tax');

/** Field labels for the before-and-after audit, in the order the form shows them. Prices add their own. */
export const PRICE_LIST_LABELS: Record<string, string> = {
  name: 'Name',
  currency: 'Currency',
  taxInclusive: 'Prices',
  validFrom: 'Valid from',
  validTo: 'Valid to',
  isActive: 'Status',
};

export type PriceListAction = 'edit' | 'deactivate' | 'activate' | 'delete';

export function statusActions(isActive: boolean): ('deactivate' | 'activate')[] {
  return isActive ? ['deactivate'] : ['activate'];
}

export interface PriceRow {
  itemCode: string;
  uomCode: string;
  unitPrice: DecimalInput;
  /** YYYY-MM-DD */
  validFrom: string;
}

export interface ListDates {
  /** YYYY-MM-DD */
  validFrom: string;
  /** YYYY-MM-DD, or null for no end */
  validTo: string | null;
}

/** "1,400.00", "12.3456": at least 2 decimals, up to the 4 stored. */
export function priceText(value: DecimalInput): string {
  const [whole, fraction = ''] = dec(value).toFixed(4).split('.');
  const kept = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${kept}`;
}

const keyOf = (r: Pick<PriceRow, 'itemCode' | 'uomCode'>) => `${r.itemCode}|${r.uomCode}`;

/** A price dated before today is history: it stays exactly as it is. */
export const isHistory = (r: Pick<PriceRow, 'validFrom'>, today: string) => r.validFrom < today;

export type PriceState = 'current' | 'waiting' | 'earlier';

/**
 * Per item and unit: the latest row started by today is the current price, rows after today wait for their date,
 * and older rows are earlier prices (history). Returns one state per row, in the order given.
 */
export function priceStates(rows: Pick<PriceRow, 'itemCode' | 'uomCode' | 'validFrom'>[], today: string): PriceState[] {
  const current = new Map<string, string>();
  for (const r of rows) {
    if (r.validFrom > today) continue;
    const seen = current.get(keyOf(r));
    if (!seen || r.validFrom > seen) current.set(keyOf(r), r.validFrom);
  }
  return rows.map((r) => (r.validFrom > today ? 'waiting' : current.get(keyOf(r)) === r.validFrom ? 'current' : 'earlier'));
}

/** How many items (and units) the list prices: 17 for STD-2026. */
export function pricedCount(rows: Pick<PriceRow, 'itemCode' | 'uomCode'>[]): number {
  return new Set(rows.map(keyOf)).size;
}

/**
 * The prices the form saves are those from today on; history rows stay as they are. Each starts today or later and
 * inside the list's dates, is above 0, and no two share item, unit and date. Errors by field path prices[i].
 */
export function priceRowErrors(rows: PriceRow[], list: ListDates, today: string): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const field = `prices[${i}]`;
    const key = `${keyOf(r)}|${r.validFrom}`;
    if (!dec(r.unitPrice).gt(0)) errors.push({ field, message: 'A price must be more than 0.' });
    else if (r.validFrom < today) errors.push({ field, message: `A price cannot start before today (${dayText(today)}). Earlier prices are history.` });
    else if (r.validFrom < list.validFrom) errors.push({ field, message: `The list starts on ${dayText(list.validFrom)}, so a price cannot start before that.` });
    else if (list.validTo && r.validFrom > list.validTo) errors.push({ field, message: `The list ends on ${dayText(list.validTo)}, so a price cannot start after that.` });
    else if (seen.has(key)) errors.push({ field, message: `${r.itemCode} already has a price in ${r.uomCode} from ${dayText(r.validFrom)}. Change that row instead.` });
    seen.add(key);
  });
  return errors;
}

/** The units an item is priced in: its base unit, then the units it has a conversion to or from the base (rule 6). */
export function itemUnits(baseUom: string, conversions: { fromUom: string; toUom: string }[]): string[] {
  const others = conversions.flatMap((c) => (c.fromUom === baseUom ? [c.toUom] : c.toUom === baseUom ? [c.fromUom] : []));
  return [baseUom, ...[...new Set(others)].filter((u) => u !== baseUom).sort()];
}

export interface PriceItem {
  status: string;
  isSellable: boolean;
  units: string[];
}

/**
 * A price is for an item Sales can sell (active and for sale), in one of its units. An item the list already priced
 * may keep getting prices after it was blocked, so its history is not cut off.
 */
export function priceItemErrors(rows: Pick<PriceRow, 'itemCode' | 'uomCode'>[], items: Map<string, PriceItem>, alreadyPriced: Set<string>): FieldError[] {
  const errors: FieldError[] = [];
  rows.forEach((r, i) => {
    const field = `prices[${i}]`;
    const it = items.get(r.itemCode);
    if (!it) errors.push({ field, message: `Item ${r.itemCode} is not in Master Data.` });
    else if ((!it.isSellable || it.status !== 'ACTIVE') && !alreadyPriced.has(r.itemCode)) errors.push({ field, message: `${r.itemCode} cannot be sold, so it cannot have a price.` });
    else if (!it.units.includes(r.uomCode)) errors.push({ field, message: `${r.uomCode} is not a unit of ${r.itemCode}. Pick ${it.units.join(' or ')}.` });
  });
  return errors;
}

/**
 * The list's own fields against the prices it already has: an end on or after the start, the dates around every
 * history price (the rows the form sends get their own errors), and the tax setting fixed once a saved price has
 * started, since it says how every saved price is read.
 */
export function headerErrors(
  next: ListDates & { taxInclusive: boolean },
  before: { taxInclusive: boolean } | null,
  saved: Pick<PriceRow, 'validFrom'>[],
  today: string,
): FieldError[] {
  const errors: FieldError[] = [];
  if (next.validTo && next.validTo < next.validFrom) errors.push({ field: 'validTo', message: 'The end date cannot be before the start date.' });
  const history = saved.map((p) => p.validFrom).filter((d) => d < today).sort();
  const first = history[0];
  const last = history.at(-1);
  if (first && next.validFrom > first) errors.push({ field: 'validFrom', message: `A price starts on ${dayText(first)}, so the list cannot start later.` });
  if (last && next.validTo && next.validTo < last && !errors.some((e) => e.field === 'validTo')) {
    errors.push({ field: 'validTo', message: `A price starts on ${dayText(last)}, so the list cannot end before it.` });
  }
  if (before && before.taxInclusive !== next.taxInclusive && saved.some((p) => p.validFrom <= today)) {
    errors.push({ field: 'taxInclusive', message: 'Prices on this list have started, so whether they include tax cannot change. Start a new price list instead.' });
  }
  return errors;
}

/** Sales finds no prices on an inactive list, so a list stays active while customers use it. */
export function deactivateRefusal(code: string, customers: string[]): string | null {
  if (!customers.length) return null;
  const n = customers.length;
  const shown = customers.slice(0, 3).join(', ') + (n > 3 ? ' …' : '');
  return `${code} is the price list of ${n} customer${n === 1 ? '' : 's'} (${shown}). Move ${n === 1 ? 'it' : 'them'} to another price list first.`;
}

/** The stored price list as plain values, for the audit and the mdm.price_list.* event payload. */
export interface PriceListRecord extends ListDates {
  code: string;
  name: string;
  currency: string;
  taxInclusive: boolean;
  isActive: boolean;
}

/** "CH-DIN-01 PCS from 1 Jan 2027": the label of one price in the audit. */
const priceLabel = (r: PriceRow) => `${r.itemCode} ${r.uomCode} from ${dayText(r.validFrom)}`;
const PRICE_FIELD = 'price:';

/** What the audit compares, with the labels to compare it by: the list's fields in words, then one entry per price. */
export function priceListAudit(list: PriceListRecord, prices: PriceRow[]): { values: Record<string, unknown>; labels: Record<string, string> } {
  const values: Record<string, unknown> = {
    ...list,
    taxInclusive: taxText(list.taxInclusive),
    validFrom: dayText(list.validFrom),
    validTo: list.validTo ? dayText(list.validTo) : 'No end',
    isActive: STATUS_LABEL[statusOf(list.isActive)],
  };
  const labels: Record<string, string> = {};
  for (const p of prices) {
    const field = `${PRICE_FIELD}${keyOf(p)}|${p.validFrom}`;
    values[field] = priceText(p.unitPrice);
    labels[field] = priceLabel(p);
  }
  return { values, labels };
}

/** The labels to diff two audits by: the list's fields, then every price on either side, sorted. */
export function auditLabels(...audits: { labels: Record<string, string> }[]): Record<string, string> {
  const prices = Object.assign({}, ...audits.map((a) => a.labels)) as Record<string, string>;
  const sorted = Object.keys(prices).sort().map((k) => [k, prices[k]!] as const);
  return { ...PRICE_LIST_LABELS, ...Object.fromEntries(sorted) };
}

/** "Changed valid to 31 Dec 2026 → 31 Mar 2027; prices: added CH-DIN-01 PCS from 1 Nov 2026 at 260.00" */
export function priceListMessage(changes: FieldChange[], max = 3): string {
  const header = changes.filter((c) => !c.field.startsWith(PRICE_FIELD));
  const prices = changes.filter((c) => c.field.startsWith(PRICE_FIELD));
  const parts: string[] = [];
  if (header.length) parts.push(changeMessage(header, max));
  if (prices.length) {
    const words = prices.slice(0, max).map((c) => (c.from === null ? `added ${c.label} at ${c.to}` : c.to === null ? `removed ${c.label} (${c.from})` : `${c.label} ${c.from} → ${c.to}`));
    const more = prices.length - max;
    const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!;
    parts.push(`${header.length ? 'prices' : 'Prices'}: ${list}${more > 0 ? ` and ${more} more` : ''}`);
  }
  return parts.join('; ') || 'No changes';
}

/** The price list after a change, as mdm.price_list.* events carry it, with all its prices. */
export function priceListSnapshot(list: PriceListRecord, prices: PriceRow[]) {
  const sorted = [...prices].sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.validFrom.localeCompare(b.validFrom));
  return { ...list, prices: sorted.map((p) => ({ itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: dec(p.unitPrice).toFixed(4), validFrom: p.validFrom })) };
}
