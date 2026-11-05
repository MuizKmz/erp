import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';
import { daysBetween } from './conversion.rules';

/**
 * Customer aging (S05, SRS RPT-023): what each customer owes, in 30-day steps. Four, six or twelve steps, aged by the
 * due date (days overdue, with "Not yet due" first) or by the invoice date (days since the invoice). The last step
 * has no end: four steps read 1–30, 31–60, 61–90, Over 90. Pure.
 */

export type AgingBasis = 'due' | 'invoice';
export const AGING_STEPS = [4, 6, 12] as const;
export type AgingSteps = (typeof AGING_STEPS)[number];

export interface AgingColumn {
  key: string;
  label: string;
  /** First and last day of the step; `to` is null for the last one. Null `from` is "Not yet due". */
  from: number | null;
  to: number | null;
}

export function agingColumns(steps: AgingSteps, basis: AgingBasis): AgingColumn[] {
  const columns: AgingColumn[] = basis === 'due' ? [{ key: 'notDue', label: 'Not yet due', from: null, to: null }] : [];
  for (let i = 0; i < steps; i++) {
    const from = i === 0 ? (basis === 'due' ? 1 : 0) : i * 30 + 1;
    const last = i === steps - 1;
    columns.push({ key: `d${i}`, label: last ? `Over ${i * 30}` : `${from}–${(i + 1) * 30}`, from, to: last ? null : (i + 1) * 30 });
  }
  return columns;
}

/** Days overdue (due basis, 0 or less when not due yet) or days since the invoice (invoice basis). No due date is not due. */
export function agingDays(inv: { docDate: string; dueDate: string | null }, basis: AgingBasis, today: string): number {
  if (basis === 'invoice') return Math.max(0, daysBetween(inv.docDate, today));
  return inv.dueDate ? daysBetween(inv.dueDate, today) : 0;
}

/** The column an invoice falls in on a day. */
export function agingColumnOf(columns: AgingColumn[], basis: AgingBasis, inv: { docDate: string; dueDate: string | null }, today: string): string {
  const days = agingDays(inv, basis, today);
  if (basis === 'due' && days <= 0) return 'notDue';
  const steps = columns.filter((c) => c.from !== null);
  return (steps.find((c) => days >= c.from! && (c.to === null || days <= c.to)) ?? steps[steps.length - 1]!).key;
}

export interface AgingInvoice {
  customerCode: string;
  customerName: string;
  docDate: string;
  dueDate: string | null;
  balance: DecimalInput;
}

export interface AgingRow {
  customerCode: string;
  customerName: string;
  invoices: number;
  balance: Prisma.Decimal;
  overdue: Prisma.Decimal;
  cells: Record<string, Prisma.Decimal>;
  /** The oldest invoice's days overdue (due basis) or age (invoice basis). */
  oldestDays: number;
}

/** Each customer's balance spread over the columns, largest balance first, with totals per column. */
export function agingByCustomer(invoices: AgingInvoice[], columns: AgingColumn[], basis: AgingBasis, today: string): { rows: AgingRow[]; totals: { balance: Prisma.Decimal; overdue: Prisma.Decimal; cells: Record<string, Prisma.Decimal> } } {
  const empty = () => Object.fromEntries(columns.map((c) => [c.key, dec(0)])) as Record<string, Prisma.Decimal>;
  const map = new Map<string, AgingRow>();
  for (const inv of invoices) {
    const row = map.get(inv.customerCode) ?? { customerCode: inv.customerCode, customerName: inv.customerName, invoices: 0, balance: dec(0), overdue: dec(0), cells: empty(), oldestDays: 0 };
    const key = agingColumnOf(columns, basis, inv, today);
    row.invoices += 1;
    row.balance = row.balance.add(dec(inv.balance));
    if (inv.dueDate && inv.dueDate < today) row.overdue = row.overdue.add(dec(inv.balance));
    row.cells[key] = row.cells[key]!.add(dec(inv.balance));
    row.oldestDays = Math.max(row.oldestDays, agingDays(inv, basis, today));
    map.set(inv.customerCode, row);
  }
  const rows = [...map.values()].sort((a, b) => b.balance.comparedTo(a.balance) || a.customerName.localeCompare(b.customerName));
  const cells = empty();
  for (const r of rows) for (const c of columns) cells[c.key] = cells[c.key]!.add(r.cells[c.key]!);
  return { rows, totals: { balance: rows.reduce((s, r) => s.add(r.balance), dec(0)), overdue: rows.reduce((s, r) => s.add(r.overdue), dec(0)), cells } };
}
