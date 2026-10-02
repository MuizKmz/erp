import { dec, type DecimalInput } from '../../platform/http/decimal';

/**
 * Purchase return rules (FlowP6 steps 5–8, CLAUDE.md rule 9). Pure functions, no database.
 */

export type ReturnStatus = 'DRAFT' | 'RELEASED' | 'SETTLED';
export type ReturnAction = 'edit' | 'delete' | 'release' | 'remind' | 'settle';

/** Reasons offered on the form (PurReturn.html). */
export const RETURN_REASONS = ['Wrong item or colour', 'Damaged in delivery', 'Quality problem', 'Too many delivered', 'Expired or near expiry'] as const;

/** Store drafts, buyer releases; AP (invoice edit) records the supplier's credit note (FlowP6 step 8). */
export function allowedReturnActions(input: { status: ReturnStatus; isMigrated: boolean; canEdit: boolean; canRelease: boolean; canSettle: boolean }): ReturnAction[] {
  if (input.isMigrated) return [];
  const actions: ReturnAction[] = [];
  if (input.status === 'DRAFT') {
    if (input.canEdit || input.canRelease) actions.push('edit', 'delete');
    if (input.canRelease) actions.push('release');
  } else if (input.status === 'RELEASED') {
    if (input.canEdit || input.canRelease || input.canSettle) actions.push('remind');
    if (input.canRelease || input.canSettle) actions.push('settle');
  }
  return actions;
}

/** What can still go back on a goods receipt line: received − already returned. */
export function returnableQty(line: { receivedQty: DecimalInput; returnedQty: DecimalInput }) {
  const left = dec(line.receivedQty).sub(dec(line.returnedQty));
  return left.lt(0) ? dec(0) : left;
}

/** Rule 9: return quantity ≤ received − already returned; at least one line goes back. */
export function returnQtyProblems(lines: { index: number; returnable: DecimalInput; qty: DecimalInput }[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  for (const l of lines) {
    const qty = dec(l.qty);
    if (qty.lt(0)) problems.push({ field: `lines[${l.index}].qty`, message: 'Return quantity cannot be less than 0.' });
    else if (qty.gt(dec(l.returnable))) {
      problems.push({
        field: `lines[${l.index}].qty`,
        message: `You can return at most ${dec(l.returnable).toDecimalPlaces(4).toString()}: what was received, minus earlier returns.`,
      });
    }
  }
  if (!problems.length && !lines.some((l) => dec(l.qty).gt(0))) problems.push({ field: 'lines', message: 'Enter a quantity to return on at least one line.' });
  return problems;
}

/** "Top reason" groups: wrong, damaged and quality problems count together. */
export function reasonGroup(reason: string): string {
  if (/wrong|colou?r|damag|dent|stain|broken|quality|defect|expir/i.test(reason)) return 'Wrong or damaged';
  if (/too many|over|extra/i.test(reason)) return 'Too many delivered';
  return reason;
}

/** Whole days between two moments, at least 0. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}
