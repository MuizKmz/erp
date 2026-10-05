import type { Prisma } from '@prisma/client';
import { dec, roundMoney, type DecimalInput } from '../../platform/http/decimal';

/** Delivery order rules (FlowS2 steps 7–9, S15, S16). Pure functions. */

export const DO_STATUSES = ['DRAFT', 'CONFIRMED'] as const;
export type DoStatus = (typeof DO_STATUSES)[number];

export type DeliveryAction = 'edit' | 'delete' | 'requestApproval' | 'confirm' | 'attach';

export const DO_LOCKED_MESSAGE = 'A confirmed delivery order is locked. Mistakes are fixed with a sales return, not an edit.';

/** Chip text: a confirmed DO shows "Delivered". */
export function deliveryStatusLabel(status: DoStatus): string {
  return status === 'CONFIRMED' ? 'Delivered' : 'Draft';
}

/** Open quantity of a sales order line still to deliver: ordered − delivered − cancelled, never below 0. */
export function openToDeliver(l: { orderedQty: DecimalInput; deliveredQty: DecimalInput; cancelledQty: DecimalInput }): Prisma.Decimal {
  const open = dec(l.orderedQty).sub(dec(l.deliveredQty)).sub(dec(l.cancelledQty));
  return open.gt(0) ? open : dec(0);
}

/**
 * What the current user may do with a delivery order. While a credit approval is pending the draft is locked;
 * a deposit hold or a credit breach does not hide Confirm (the server explains why it refuses).
 */
export function allowedDeliveryActions(d: {
  status: DoStatus;
  isMigrated: boolean;
  approvalPending: boolean;
  creditNeedsApproval: boolean;
  approved: boolean;
  canEdit: boolean;
  canConfirm: boolean;
}): DeliveryAction[] {
  if (d.isMigrated) return [];
  if (d.status === 'CONFIRMED') return d.canEdit || d.canConfirm ? ['attach'] : [];
  if (d.approvalPending) return d.canEdit || d.canConfirm ? ['attach'] : [];
  const actions: DeliveryAction[] = [];
  if (d.canEdit) actions.push('edit', 'delete', 'attach');
  if (d.canEdit && d.creditNeedsApproval && !d.approved) actions.push('requestApproval');
  if (d.canConfirm && (!d.creditNeedsApproval || d.approved)) actions.push('confirm');
  return actions;
}

/**
 * Rule 1: deliver now can never be more than the order balance. Returns one message per broken line, keyed
 * by the line's index, e.g. "Deliver now cannot be more than the balance (100)."
 */
export function deliverProblems(lines: { qty: DecimalInput; balance: DecimalInput }[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  lines.forEach((l, i) => {
    const qty = dec(l.qty);
    if (qty.lt(0)) problems.push({ field: `lines[${i}].qty`, message: 'Deliver now cannot be below 0.' });
    else if (qty.gt(dec(l.balance))) problems.push({ field: `lines[${i}].qty`, message: `Deliver now cannot be more than the balance (${trimQty(l.balance)}).` });
  });
  if (!problems.length && lines.every((l) => dec(l.qty).eq(0))) problems.push({ field: 'lines', message: 'Enter a quantity to deliver on at least one line.' });
  return problems;
}

/** Sales order status after a delivery: Done when nothing is left to deliver, otherwise Partial. */
export function orderStatusAfterDelivery(lines: { orderedQty: DecimalInput; deliveredQty: DecimalInput; cancelledQty: DecimalInput }[]): 'PARTIAL' | 'DONE' {
  return lines.every((l) => openToDeliver(l).eq(0)) ? 'DONE' : 'PARTIAL';
}

export type WaitingState = 'READY' | 'NO_STOCK' | 'PURCHASE' | 'DEPOSIT';

/**
 * What the waiting list (S15) offers for an order line with a balance:
 * a released, unpaid proforma holds delivery; a buy-to-order line waits for the purchase until stock arrives;
 * a stock item without stock waits for stock; otherwise it is ready ("Create DO").
 */
export function waitingState(l: { isBuyToOrder: boolean; isStock: boolean; balance: DecimalInput; onHand: DecimalInput; unpaidProformaNo: string | null }): WaitingState {
  if (l.unpaidProformaNo) return 'DEPOSIT';
  const covered = dec(l.onHand).gte(dec(l.balance));
  if (l.isBuyToOrder && !covered) return 'PURCHASE';
  if (l.isStock && dec(l.onHand).lte(0)) return 'NO_STOCK';
  return 'READY';
}

/** "After this DO: 60 of 100 delivered" → 60 (whole percent, capped at 100). */
export function deliveredPct(delivered: DecimalInput, ordered: DecimalInput): number {
  const o = dec(ordered);
  if (o.lte(0)) return 0;
  return Math.min(100, Math.round(dec(delivered).div(o).mul(100).toNumber()));
}

/** Whether a wanted-by date falls within the next `days` days (today included). */
export function dueWithin(wantedBy: string | null, today: string, days: number): boolean {
  if (!wantedBy) return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return wantedBy <= limit.toISOString().slice(0, 10);
}

/** Value of what is delivered now, at the order's prices, tax included: what the credit check counts for a DO. */
export function deliveryValue(lines: { qty: DecimalInput; unitPrice: DecimalInput; discountPct: DecimalInput; taxRate: DecimalInput }[]): Prisma.Decimal {
  return lines.reduce((total, l) => {
    const net = roundMoney(dec(l.qty).mul(dec(l.unitPrice)).mul(dec(100).sub(dec(l.discountPct))).div(100));
    return total.add(net).add(roundMoney(net.mul(dec(l.taxRate))));
  }, dec(0));
}

function trimQty(v: DecimalInput): string {
  return dec(v).toDecimalPlaces(4).toString();
}
