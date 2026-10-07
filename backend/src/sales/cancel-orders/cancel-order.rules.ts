import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Cancel order rules (FlowS6 steps 2–4, S13, S14, rule 8). Pure functions. */

export const CO_STATUSES = ['DRAFT', 'RELEASED'] as const;
export type CoStatus = (typeof CO_STATUSES)[number];

export type CancelAction = 'edit' | 'delete' | 'release';

export const CANCEL_REASONS = [
  'Customer changed requirement',
  'Item discontinued',
  'Cancelled before delivery',
  'Out of stock, customer agreed',
  'Price disagreement',
  'Other',
] as const;

export const CO_LOCKED_MESSAGE = 'A released cancellation cannot be changed.';

/**
 * Rule 8: only the undelivered balance can be cancelled (ordered − delivered − already cancelled). Returns one
 * message per broken line, e.g. "Cancel now cannot be more than the undelivered balance (15)."
 */
export function cancelProblems(lines: { qty: DecimalInput; balance: DecimalInput }[], requireOne = true): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  lines.forEach((l, i) => {
    const qty = dec(l.qty);
    if (qty.lt(0)) problems.push({ field: `lines[${i}].qty`, message: 'Cancel now cannot be below 0.' });
    else if (qty.gt(dec(l.balance))) problems.push({ field: `lines[${i}].qty`, message: `Cancel now cannot be more than the undelivered balance (${trim(l.balance)}).` });
  });
  if (requireOne && !problems.length && lines.every((l) => dec(l.qty).eq(0))) problems.push({ field: 'lines', message: 'Enter a quantity to cancel on at least one line.' });
  return problems;
}

/** "15 of 25 Office chair, mesh", "Whole order · 12 Bar stool", or "3 lines". */
export function cancelSummary(lines: { itemName: string; ordered: DecimalInput; cancel: DecimalInput; delivered: DecimalInput }[]): string {
  const cancelled = lines.filter((l) => dec(l.cancel).gt(0));
  if (!cancelled.length) return '';
  const whole = lines.every((l) => dec(l.delivered).eq(0) && dec(l.cancel).eq(dec(l.ordered)));
  if (cancelled.length > 1) return whole ? `Whole order · ${cancelled.length} lines` : `${cancelled.length} lines`;
  const l = cancelled[0]!;
  return whole ? `Whole order · ${trim(l.cancel)} ${l.itemName}` : `${trim(l.cancel)} of ${trim(l.ordered)} ${l.itemName}`;
}

/** After release: the order closes as Done with "Balance cancelled" when nothing is left to deliver. */
export function orderAfterCancel(
  status: 'RELEASED' | 'PARTIAL',
  lines: { orderedQty: DecimalInput; deliveredQty: DecimalInput; cancelledQty: DecimalInput }[],
): { status: 'RELEASED' | 'PARTIAL' | 'DONE'; balanceCancelled: boolean } {
  const open = lines.some((l) => dec(l.orderedQty).sub(dec(l.deliveredQty)).sub(dec(l.cancelledQty)).gt(0));
  if (open) return { status, balanceCancelled: false };
  return { status: 'DONE', balanceCancelled: true };
}

export function allowedCancelActions(c: { status: CoStatus; isMigrated: boolean; canEdit: boolean; canRelease: boolean }): CancelAction[] {
  if (c.isMigrated || c.status !== 'DRAFT') return [];
  const actions: CancelAction[] = [];
  if (c.canEdit) actions.push('edit', 'delete');
  if (c.canRelease) actions.push('release');
  return actions;
}

function trim(v: DecimalInput): string {
  return dec(v).toDecimalPlaces(4).toString();
}
