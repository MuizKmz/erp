import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';
import { consolidatedDue } from '../cash-sales/cash-sale.rules';

/**
 * e-Invoice status (S05, SRS FR-EIV-010): where each document that needs an LHDN e-Invoice stands. A document's
 * e-Invoice goes out with its release event, so the event's state is the e-Invoice's state; nothing is submitted
 * while LHDN is not connected. Pure.
 */

export type EInvoiceState = 'WAITING' | 'SUBMITTED' | 'FAILED' | 'OLD_SYSTEM';

export const EINVOICE_LABELS: Record<EInvoiceState, string> = {
  WAITING: 'Waiting for LHDN',
  SUBMITTED: 'Submitted',
  FAILED: 'Could not be sent',
  OLD_SYSTEM: 'Old system',
};

/** From the release event: not released yet (no event) has no e-Invoice state; migrated documents had theirs in the old system. */
export function eInvoiceState(d: { isMigrated: boolean; eventStatus: string | null }): EInvoiceState | null {
  if (d.isMigrated) return 'OLD_SYSTEM';
  if (!d.eventStatus) return null;
  if (d.eventStatus === 'DISPATCHED') return 'SUBMITTED';
  if (d.eventStatus === 'FAILED') return 'FAILED';
  return 'WAITING';
}

export type EInvoiceDocType = 'INVOICE' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'CASH_SALE';

export const EINVOICE_TYPES: Record<EInvoiceDocType, string> = {
  INVOICE: 'Invoice',
  DEBIT_NOTE: 'Debit note',
  CREDIT_NOTE: 'Credit note',
  CASH_SALE: 'Cash sale',
};

/**
 * What LHDN would refuse, so it can be fixed before LHDN is connected: an e-Invoice needs the buyer's TIN. A cash
 * sale with its own e-Invoice carries the buyer's TIN; other documents take the customer's TIN from Master Data.
 */
export function eInvoiceProblem(d: { type: EInvoiceDocType; customerTin: string | null; buyerTin?: string | null }): string | null {
  if (d.type === 'CASH_SALE') return d.buyerTin?.trim() ? null : "The buyer's TIN is missing.";
  return d.customerTin?.trim() ? null : 'The customer has no TIN in Master Data.';
}

/** The monthly consolidated e-Invoice for cash sales without their own: due the 7th of the next month, late after that. */
export function consolidatedState(month: string, today: string): { due: string; late: boolean } {
  const due = consolidatedDue(`${month}-01`);
  return { due, late: today > due };
}

/** Cash sales without their own e-Invoice, per month, newest month first: they go into that month's consolidated e-Invoice. */
export function consolidatedByMonth(sales: { docDate: string; total: DecimalInput; ownEInvoice: boolean }[]): { month: string; count: number; amount: Prisma.Decimal }[] {
  const map = new Map<string, { count: number; amount: Prisma.Decimal }>();
  for (const s of sales.filter((x) => !x.ownEInvoice)) {
    const month = s.docDate.slice(0, 7);
    const m = map.get(month) ?? { count: 0, amount: dec(0) };
    m.count += 1;
    m.amount = m.amount.add(dec(s.total));
    map.set(month, m);
  }
  return [...map].map(([month, m]) => ({ month, ...m })).sort((a, b) => b.month.localeCompare(a.month));
}
