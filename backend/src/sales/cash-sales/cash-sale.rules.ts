import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Cash sale rules (S23, S24, rule 10). Pure functions. */

export const CS_STATUSES = ['DRAFT', 'RELEASED'] as const;
export type CsStatus = (typeof CS_STATUSES)[number];
export type CashSaleAction = 'edit' | 'delete' | 'release';
export type PaymentMethod = 'CASH' | 'CARD' | 'DUITNOW' | 'TRANSFER';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { CASH: 'Cash', CARD: 'Card', DUITNOW: 'DuitNow QR', TRANSFER: 'Bank transfer' };
export const CS_LOCKED_MESSAGE = 'A released cash sale cannot be changed. Mistakes are fixed with a sales return.';

/** Change is given only on cash; other methods take exactly the amount to pay. */
export function changeDue(method: PaymentMethod, toPay: DecimalInput, received: DecimalInput): Prisma.Decimal {
  if (method !== 'CASH') return dec(0);
  const change = dec(received).sub(dec(toPay));
  return change.gt(0) ? change : dec(0);
}

/**
 * Rule 10: the balance must be 0 to release (received ≥ to pay; change worked out). An own e-Invoice needs the
 * buyer's name and TIN; otherwise the sale goes into the monthly consolidated e-Invoice.
 */
export function releaseProblems(c: {
  toPay: DecimalInput;
  received: DecimalInput;
  method: PaymentMethod;
  ownEInvoice: boolean;
  buyerName: string | null;
  buyerTin: string | null;
  lineCount: number;
}): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (c.lineCount === 0) problems.push({ field: 'lines', message: 'Add at least one item.' });
  const received = dec(c.received);
  const toPay = dec(c.toPay);
  if (received.lt(toPay)) problems.push({ field: 'amountReceived', message: `Amount received must cover the amount to pay (${toPay.toFixed(2)}). Balance ${toPay.sub(received).toFixed(2)} is still open.` });
  else if (c.method !== 'CASH' && received.gt(toPay)) problems.push({ field: 'amountReceived', message: `${PAYMENT_LABELS[c.method]} takes exactly the amount to pay (${toPay.toFixed(2)}). Only cash gives change.` });
  if (c.ownEInvoice) {
    if (!c.buyerName?.trim()) problems.push({ field: 'buyerName', message: 'An own e-Invoice needs the buyer\'s name.' });
    if (!c.buyerTin?.trim()) problems.push({ field: 'buyerTin', message: 'An own e-Invoice needs the buyer\'s TIN.' });
  }
  return problems;
}

/** The consolidated e-Invoice for a month is due on the 7th of the next month. */
export function consolidatedDue(docDate: string): string {
  const [y, m] = docDate.split('-').map(Number) as [number, number];
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-07`;
}

/** "Dining chair, solid oak ×2", or "Dining chair, solid oak ×2 and 1 more". */
export function cashSummary(lines: { itemName: string; qty: DecimalInput }[]): string {
  if (!lines.length) return '';
  const first = `${lines[0]!.itemName} ×${dec(lines[0]!.qty).toDecimalPlaces(4).toString()}`;
  return lines.length === 1 ? first : `${first} and ${lines.length - 1} more`;
}

export function allowedCashSaleActions(c: { status: CsStatus; isMigrated: boolean; canEdit: boolean }): CashSaleAction[] {
  if (c.isMigrated || c.status !== 'DRAFT' || !c.canEdit) return [];
  return ['edit', 'delete', 'release'];
}
