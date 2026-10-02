import { dec, type DecimalInput } from '../../platform/http/decimal';

/**
 * Cancel order rules (FlowP6 steps 2–4, CLAUDE.md rule 8). Pure functions, no database.
 * Only the unreceived balance can be cancelled; buyers draft, only the Purchasing Manager releases.
 */

export type CancelOrderStatus = 'DRAFT' | 'RELEASED';
export type CancelOrderAction = 'edit' | 'delete' | 'release';

/** Reasons offered on the form (PoCancel.html). */
export const CANCEL_REASONS = [
  'Supplier stopped the item',
  'Supplier out of stock',
  'More than 3 weeks late',
  'Ordered too many',
  'Not needed any more',
  'Short delivery',
] as const;

export function allowedCancelOrderActions(input: { status: CancelOrderStatus; isMigrated: boolean; canEdit: boolean; canRelease: boolean }): CancelOrderAction[] {
  if (input.status !== 'DRAFT' || input.isMigrated) return [];
  const actions: CancelOrderAction[] = [];
  if (input.canEdit || input.canRelease) actions.push('edit', 'delete');
  if (input.canRelease) actions.push('release');
  return actions;
}

/** Rule 8: never more than what is still open (ordered − received − cancelled), never less than 0. */
export function cancelQtyProblems(lines: { index: number; open: DecimalInput; cancel: DecimalInput }[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  for (const l of lines) {
    const cancel = dec(l.cancel);
    if (cancel.lt(0)) problems.push({ field: `lines[${l.index}].cancelQty`, message: 'Cancel quantity cannot be less than 0.' });
    else if (cancel.gt(dec(l.open))) {
      problems.push({
        field: `lines[${l.index}].cancelQty`,
        message: `Only the part not yet received can be cancelled (${dec(l.open).toDecimalPlaces(4).toString()} open).`,
      });
    }
  }
  if (!problems.length && !lines.some((l) => dec(l.cancel).gt(0))) problems.push({ field: 'lines', message: 'Enter a quantity to cancel on at least one line.' });
  return problems;
}

/**
 * The PO after the cancellation is released: Cancelled when nothing was ever received and nothing is left,
 * Done · balance cancelled when nothing is left, otherwise it keeps its status.
 */
export function poAfterCancel(
  status: 'RELEASED' | 'PARTIAL',
  lines: { orderedQty: DecimalInput; receivedQty: DecimalInput; cancelledQty: DecimalInput }[],
): { status: 'RELEASED' | 'PARTIAL' | 'DONE' | 'CANCELLED'; balanceCancelled: boolean } {
  const open = lines.some((l) => dec(l.orderedQty).sub(dec(l.receivedQty)).sub(dec(l.cancelledQty)).gt(0));
  if (open) return { status, balanceCancelled: false };
  const anythingReceived = lines.some((l) => dec(l.receivedQty).gt(0));
  return anythingReceived ? { status: 'DONE', balanceCancelled: true } : { status: 'CANCELLED', balanceCancelled: false };
}
