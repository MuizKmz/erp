import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { WaitingState } from '../deliveries/delivery.rules';

/** Open orders (S05, SRS RPT-024): what each order line still waits for, and the totals. Pure. */

export type OpenReason = WaitingState | 'CANCELLING' | 'APPROVAL' | 'DRAFT' | 'TO_INVOICE';

/** Most blocking first: the order of the chart and of the table's chips. */
export const OPEN_REASONS: { key: OpenReason; label: string }[] = [
  { key: 'DRAFT', label: 'Not released yet' },
  { key: 'APPROVAL', label: 'Waiting for approval' },
  { key: 'CANCELLING', label: 'Being cancelled' },
  { key: 'DEPOSIT', label: 'Waiting for deposit' },
  { key: 'PURCHASE', label: 'Waiting for purchase' },
  { key: 'NO_STOCK', label: 'Waiting for stock' },
  { key: 'READY', label: 'Ready to deliver' },
  { key: 'TO_INVOICE', label: 'Delivered, to invoice' },
];

export const reasonLabel = (key: OpenReason) => OPEN_REASONS.find((r) => r.key === key)!.label;

/** Order statuses the report reads, by its Show filter. A Done order is open while something delivered is not invoiced. */
export const OPEN_SHOW: Record<string, ('DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'PARTIAL' | 'DONE')[]> = {
  all: ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE'],
  released: ['RELEASED', 'PARTIAL', 'DONE'],
  approval: ['PENDING_APPROVAL'],
  draft: ['DRAFT'],
};

/**
 * What an open line waits for: an order that is not released waits for that; a line with nothing left to deliver
 * waits only for its invoice; a balance a draft cancel order takes in full is being cancelled; otherwise the delivery
 * waiting list (S15) answers: deposit, purchase, stock, or ready.
 */
export function openReason(l: { orderStatus: string; openQty: DecimalInput; cancellingQty: DecimalInput; waiting: WaitingState }): OpenReason {
  if (l.orderStatus === 'DRAFT') return 'DRAFT';
  if (l.orderStatus === 'PENDING_APPROVAL') return 'APPROVAL';
  if (dec(l.openQty).lte(0)) return 'TO_INVOICE';
  if (dec(l.cancellingQty).gt(0) && dec(l.cancellingQty).gte(dec(l.openQty))) return 'CANCELLING';
  return l.waiting;
}

/** A line is open while something is left to deliver (ordered − delivered − cancelled) or to invoice (delivered − invoiced). */
export function openQuantities(l: { orderedQty: DecimalInput; deliveredQty: DecimalInput; invoicedQty: DecimalInput; cancelledQty: DecimalInput }): { open: Prisma.Decimal; toInvoice: Prisma.Decimal } {
  const open = dec(l.orderedQty).sub(dec(l.deliveredQty)).sub(dec(l.cancelledQty));
  const toInvoice = dec(l.deliveredQty).sub(dec(l.invoicedQty));
  return { open: open.gt(0) ? open : dec(0), toInvoice: toInvoice.gt(0) ? toInvoice : dec(0) };
}

/** Late: the promised date (or, without one, the wanted-by date) is before today and something is still to deliver. */
export function isLate(o: { promisedDate: string | null; wantedBy: string | null }, open: DecimalInput, today: string): boolean {
  const date = o.promisedDate ?? o.wantedBy;
  return Boolean(date && date < today && dec(open).gt(0));
}

/** Still to deliver, per reason, in the order of OPEN_REASONS; reasons with nothing are left out. */
export function byReason(lines: { reason: OpenReason; openValue: Prisma.Decimal }[]): { key: OpenReason; label: string; amount: Prisma.Decimal; lines: number }[] {
  return OPEN_REASONS.map((r) => {
    const these = lines.filter((l) => l.reason === r.key);
    return { key: r.key, label: r.label, amount: these.reduce((s, l) => s.add(l.openValue), dec(0)), lines: these.length };
  }).filter((r) => r.lines > 0);
}
