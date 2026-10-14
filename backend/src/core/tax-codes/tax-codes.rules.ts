/**
 * Tax-code rules (CLAUDE.md → Phase 3 · Core business rule 7; SRS BR-TAX-006, FR-MST-055). Pure functions; the service
 * loads the rows and turns the answers into 400 / 409 responses.
 *
 * A tax code keeps one row per rate period. A new rate adds a row from its date and closes the one before it the day
 * before; a rate is never edited in place, so the rate on any past day stays as it was and documents keep theirs.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { FieldError } from '../../platform/http/errors';
import { dayText } from '../shared/audit.rules';

/** SST10, SVC8, EXEMPT: a capital first, then capitals and digits, up to 20. Typed once; it never changes. */
export const TAX_CODE = /^[A-Z][A-Z0-9]{1,19}$/;

export const TAX_TYPES = ['SALES_TAX', 'SERVICE_TAX', 'EXEMPT'] as const;
export type TaxType = (typeof TAX_TYPES)[number];
export const TYPE_LABEL: Record<TaxType, string> = { SALES_TAX: 'Sales tax', SERVICE_TAX: 'Service tax', EXEMPT: 'Exempt' };

/** A rate as people type it: a percentage with up to 2 decimals, "10" or "6.5". */
export const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

export type TaxCodeAction = 'edit' | 'newRate' | 'delete';
export type PeriodState = 'current' | 'waiting' | 'ended';

export interface Period {
  name: string;
  /** Fraction: 0.1000 = 10% */
  rate: DecimalInput;
  /** YYYY-MM-DD */
  validFrom: string;
  /** YYYY-MM-DD, or null for no end */
  validTo: string | null;
}

/** "10" → 0.1000 */
export const rateFromPercent = (percent: DecimalInput) => dec(percent).div(100).toDecimalPlaces(4);

/** 0.1000 → "10%", 0.0650 → "6.5%" */
export function percentText(rate: DecimalInput): string {
  return `${dec(rate).mul(100).toDecimalPlaces(2).toString()}%`;
}

/** The day before an ISO date, for closing the period a new rate replaces. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const byStart = <T extends Pick<Period, 'validFrom'>>(periods: T[]) => [...periods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

/** The period valid on the day, or none. */
export function periodOn<T extends Pick<Period, 'validFrom' | 'validTo'>>(periods: T[], day: string): T | null {
  return byStart(periods).filter((p) => p.validFrom <= day && (!p.validTo || p.validTo >= day)).at(-1) ?? null;
}

/** The latest period: the one a new rate follows, and whose name screens show from now on. */
export function latestPeriod<T extends Pick<Period, 'validFrom'>>(periods: T[]): T {
  return byStart(periods).at(-1)!;
}

/** The period the C10 list shows: the one valid today, else the latest (a code that has not started, or has ended). */
export function shownPeriod<T extends Pick<Period, 'validFrom' | 'validTo'>>(periods: T[], today: string): T {
  return periodOn(periods, today) ?? latestPeriod(periods);
}

export function periodState(p: Pick<Period, 'validFrom' | 'validTo'>, today: string): PeriodState {
  if (p.validFrom > today) return 'waiting';
  return !p.validTo || p.validTo >= today ? 'current' : 'ended';
}

/** A rate between 0% and 100%; an exempt code charges nothing. */
export function rateError(percent: DecimalInput, type: TaxType): string | null {
  const p = dec(percent);
  if (p.lt(0) || p.gt(100)) return 'A rate is between 0% and 100%.';
  if (type === 'EXEMPT' && !p.eq(0)) return 'An exempt code has a 0% rate.';
  return null;
}

/**
 * A new rate starts today or later and after the latest period's start (SRS BR-TAX-006: no overlapping periods; the
 * one before is closed the day before). Errors by field.
 */
export function newRateErrors(next: { percent: DecimalInput; validFrom: string }, type: TaxType, periods: Period[], today: string): FieldError[] {
  const errors: FieldError[] = [];
  const rate = rateError(next.percent, type);
  if (rate) errors.push({ field: 'rate', message: rate });
  const latest = latestPeriod(periods);
  if (next.validFrom < today) errors.push({ field: 'validFrom', message: `A new rate cannot start before today (${dayText(today)}). Earlier rates are history.` });
  else if (next.validFrom <= latest.validFrom) {
    errors.push({ field: 'validFrom', message: `The latest rate starts on ${dayText(latest.validFrom)}, so a new rate must start after it.` });
  }
  return errors;
}

/** Only the latest rate, and only before its date, can be removed; the code's only rate goes with the code. */
export function removeRateRefusal(target: Period, periods: Period[], today: string): string | null {
  if (periods.length === 1) return 'This is the code’s only rate. Delete the code instead.';
  if (target.validFrom <= today) return 'This rate has started, so it is history and stays. Add a new rate instead.';
  if (latestPeriod(periods).validFrom !== target.validFrom) return 'Only the latest rate can be removed.';
  return null;
}

/** The type says how documents with the code are reported, so it is fixed once documents use it. */
export function typeChangeError(code: string, from: TaxType, to: TaxType, documents: number, periods: Pick<Period, 'rate'>[]): string | null {
  if (from === to) return null;
  if (documents > 0) return `${code} is used on ${documents} document${documents === 1 ? '' : 's'}, so its type cannot change. Add a new tax code instead.`;
  if (to === 'EXEMPT' && periods.some((p) => !dec(p.rate).eq(0))) return 'An exempt code has a 0% rate, and this code has other rates.';
  return null;
}

/** Purchase and Sales take each item's tax rate from its code, so a code stays active while active items use it. */
export function deactivateTaxError(code: string, items: string[]): string | null {
  if (!items.length) return null;
  const n = items.length;
  const shown = items.slice(0, 3).join(', ') + (n > 3 ? ' …' : '');
  return `${code} is the tax of ${n} active item${n === 1 ? '' : 's'} (${shown}). Give ${n === 1 ? 'it' : 'them'} another tax code first.`;
}

/** "10% from 1 Sep 2018 to 31 Dec 2026; 8% from 1 Jan 2027": the periods as one line, for the audit (names have their own field). */
export function ratesText(periods: Period[]): string {
  return byStart(periods)
    .map((p) => `${percentText(p.rate)} from ${dayText(p.validFrom)}${p.validTo ? ` to ${dayText(p.validTo)}` : ''}`)
    .join('; ');
}

export const TAX_LABELS: Record<string, string> = { name: 'Name', type: 'Type', isActive: 'Status', rates: 'Rates' };

export interface TaxCodeRecord {
  code: string;
  type: TaxType;
  country: string;
  isActive: boolean;
}

/** What the audit compares: the latest name, the type and status in words, the periods as one line. */
export function taxAudit(t: TaxCodeRecord, periods: Period[]): Record<string, unknown> {
  return { name: latestPeriod(periods).name, type: TYPE_LABEL[t.type], isActive: t.isActive ? 'Active' : 'Inactive', rates: ratesText(periods) };
}

/** The tax code after a change, as mdm.tax_code.* events carry it, with every rate period. */
export function taxSnapshot(t: TaxCodeRecord, periods: Period[]) {
  return {
    ...t,
    name: latestPeriod(periods).name,
    rates: byStart(periods).map((p) => ({ name: p.name, rate: dec(p.rate).toFixed(4), validFrom: p.validFrom, validTo: p.validTo })),
  };
}
