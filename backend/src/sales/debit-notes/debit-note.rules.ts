/** Sales debit note rules (FlowS6 steps 9–11, S25, S26, rule 11). Pure functions. */

export const DN_STATUSES = ['DRAFT', 'RELEASED'] as const;
export type DnStatus = (typeof DN_STATUSES)[number];
export type DebitNoteAction = 'edit' | 'delete' | 'release';

export const DEBIT_REASONS = ['Extra service requested', 'Price correction', 'Missed freight charge', 'Rush delivery charge', 'Other'] as const;

export const DN_LOCKED_MESSAGE = 'A released debit note cannot be changed. It is already added to the invoice.';

/** Rule 11: a debit note always points to exactly one released invoice. */
export function invoiceProblem(inv: { status: string; docNo: string } | null): string | null {
  if (!inv) return 'Pick the released invoice the charge belongs to.';
  if (inv.status !== 'RELEASED') return `${inv.docNo} is not released. A debit note can only add to a released invoice.`;
  return null;
}

/** "Delivery trip, Klang Valley" or "Delivery trip, Klang Valley and 2 more". */
export function debitSummary(lines: { itemName: string }[]): string {
  if (!lines.length) return '';
  return lines.length === 1 ? lines[0]!.itemName : `${lines[0]!.itemName} and ${lines.length - 1} more`;
}

export function allowedDebitActions(d: { status: DnStatus; isMigrated: boolean; canEdit: boolean }): DebitNoteAction[] {
  if (d.isMigrated || d.status !== 'DRAFT' || !d.canEdit) return [];
  return ['edit', 'delete', 'release'];
}
