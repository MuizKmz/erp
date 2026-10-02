/**
 * Supplier debit note rules (FlowP6 steps 9–12, CLAUDE.md rule 11). Pure functions, no database.
 * A debit note always points to one supplier invoice; a charge that is not on the PO needs the Purchasing
 * Manager's approval, otherwise it is released directly.
 */

export type DebitNoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'RELEASED' | 'REJECTED';
export type DebitNoteAction = 'edit' | 'delete' | 'submit' | 'release';

export const DEBIT_REASONS = ['Charge not on the PO', 'Freight surcharge', 'Price increase agreed', 'Extra work agreed', 'Other'] as const;

/** Invoices a debit note can add to: any recorded invoice that was not rejected. */
export const DEBITABLE_INVOICE_STATUSES = ['TO_MATCH', 'PENDING_APPROVAL', 'APPROVED', 'PAID'] as const;

/** Rule 11: every charge must be an item on the purchase order, or the note needs approval. */
export function chargesOnPo(chargeItemCodes: string[], poItemCodes: string[]): { onPo: boolean; notOnPo: string[] } {
  const notOnPo = [...new Set(chargeItemCodes.filter((c) => !poItemCodes.includes(c)))];
  return { onPo: notOnPo.length === 0, notOnPo };
}

/** Drafts: on the PO → release directly; not on the PO → send for approval. */
export function allowedDebitNoteActions(input: { status: DebitNoteStatus; isMigrated: boolean; canEdit: boolean; onPo: boolean }): DebitNoteAction[] {
  if (input.status !== 'DRAFT' && input.status !== 'REJECTED') return [];
  if (input.isMigrated || !input.canEdit) return [];
  if (input.status === 'REJECTED') return ['delete'];
  return ['edit', 'delete', input.onPo ? 'release' : 'submit'];
}
