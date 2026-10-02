import { dec, type DecimalInput } from '../../platform/http/decimal';

/**
 * Goods receipt rules (FlowP4, CLAUDE.md rule 1). Pure functions, no database.
 */

export type ReceiptStatus = 'DRAFT' | 'CONFIRMED';
export type ReceiptAction = 'edit' | 'delete' | 'confirm';

/** Purchase orders that can be received: released or partly received, with something still open. */
export const RECEIVABLE_PO_STATUSES = ['RELEASED', 'PARTIAL'] as const;

export function allowedReceiptActions(input: { status: ReceiptStatus; isMigrated: boolean; canEdit: boolean; canConfirm: boolean }): ReceiptAction[] {
  if (input.status !== 'DRAFT' || input.isMigrated || !input.canEdit) return [];
  return input.canConfirm ? ['edit', 'delete', 'confirm'] : ['edit', 'delete'];
}

/** Open on a PO line: ordered − received − cancelled. */
export function openQty(line: { orderedQty: DecimalInput; receivedQty: DecimalInput; cancelledQty: DecimalInput }) {
  return dec(line.orderedQty).sub(dec(line.receivedQty)).sub(dec(line.cancelledQty));
}

export interface ReceiveLineInput {
  index: number;
  open: DecimalInput;
  receiving: DecimalInput;
  locationCode: string | null;
}

export interface FieldProblem {
  field: string;
  message: string;
}

/** Rule 1: never more than the open quantity (over-receipt is off). Checked on every save. */
export function quantityProblems(lines: ReceiveLineInput[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const l of lines) {
    const receiving = dec(l.receiving);
    if (receiving.lt(0)) problems.push({ field: `lines[${l.index}].receivedQty`, message: 'Receiving now cannot be less than 0.' });
    else if (receiving.gt(dec(l.open))) {
      problems.push({
        field: `lines[${l.index}].receivedQty`,
        message: `Receiving now cannot be more than the open quantity (${dec(l.open).toDecimalPlaces(4).toString()}).`,
      });
    }
  }
  return problems;
}

/** Extra checks before a receipt can be confirmed (FlowP4 step 5). */
export function confirmProblems(input: {
  lines: ReceiveLineInput[];
  supplierDoNo: string | null | undefined;
  validLocations: string[];
  docDate: string;
  today: string;
  poDate: string;
}): FieldProblem[] {
  const problems = quantityProblems(input.lines);
  if (!input.supplierDoNo?.trim()) problems.push({ field: 'supplierDoNo', message: "Enter the supplier's delivery order number." });
  if (!input.lines.some((l) => dec(l.receiving).gt(0))) problems.push({ field: 'lines', message: 'Count at least one item before you confirm.' });
  for (const l of input.lines) {
    if (!dec(l.receiving).gt(0)) continue;
    if (!l.locationCode) problems.push({ field: `lines[${l.index}].locationCode`, message: 'Pick where it is put away.' });
    else if (!input.validLocations.includes(l.locationCode)) {
      problems.push({ field: `lines[${l.index}].locationCode`, message: `${l.locationCode} is not a location in this warehouse.` });
    }
  }
  if (input.docDate > input.today) problems.push({ field: 'docDate', message: 'The received date cannot be in the future.' });
  if (input.docDate < input.poDate) problems.push({ field: 'docDate', message: 'The received date cannot be before the PO date.' });
  return problems;
}

/** How many are short against what was open: Σ (open − receiving). */
export function shortQty(lines: { open: DecimalInput; receiving: DecimalInput }[]) {
  return lines.reduce((sum, l) => sum.add(dec(l.open).sub(dec(l.receiving))), dec(0));
}

/** The PO after a receipt: Done when nothing is open on any line, else Partially received. */
export function poStatusAfter(lines: { orderedQty: DecimalInput; receivedQty: DecimalInput; cancelledQty: DecimalInput }[]): 'PARTIAL' | 'DONE' {
  return lines.every((l) => openQty(l).lte(0)) ? 'DONE' : 'PARTIAL';
}
