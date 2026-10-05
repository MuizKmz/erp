import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Quotation rules (FlowS1, S08–S09). Pure functions. */

export const QT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'ORDERED', 'LOST', 'SUPERSEDED'] as const;
export type QtStatus = (typeof QT_STATUSES)[number];
export type QtAction = 'edit' | 'delete' | 'requestApproval' | 'release' | 'email' | 'revise' | 'transfer' | 'markLost';

export const QT_LOCKED_MESSAGE = 'Released quotations are locked. Revise it to change prices or lines.';

/** A released quotation past its valid-until date is shown as Expired (not stored). */
export function isExpired(status: string, validUntil: string | null, today: string): boolean {
  return status === 'RELEASED' && Boolean(validUntil) && validUntil! < today;
}

/** Released (not yet ordered) and expiring within the warning window, e.g. 3 days (S08 banner). */
export function expiresSoon(status: string, validUntil: string | null, today: string, days: number): boolean {
  if (status !== 'RELEASED' || !validUntil || validUntil < today) return false;
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return validUntil <= limit;
}

/** Chip text on S08/S09: "Released · rev 1", "Expired", "Ordered" … */
export function quotationLabel(status: QtStatus, revision: number, expired: boolean): string {
  if (expired) return 'Expired';
  if (status === 'RELEASED') return revision > 0 ? `Released · rev ${revision}` : 'Released';
  return { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', RELEASED: 'Released', ORDERED: 'Ordered', LOST: 'Lost', SUPERSEDED: 'Revised' }[status];
}

/** A discount above the limit (15 %) on any line needs Sales Manager approval before release. */
export function discountOverLimit(lines: { discountPct: DecimalInput }[], limitPct: DecimalInput): { over: boolean; highest: string } {
  const highest = lines.reduce((max, l) => (dec(l.discountPct).gt(max) ? dec(l.discountPct) : max), dec(0));
  return { over: highest.gt(dec(limitPct)), highest: highest.toDecimalPlaces(2).toString() };
}

export function allowedQuotationActions(q: {
  status: QtStatus;
  isMigrated: boolean;
  expired: boolean;
  discountOver: boolean;
  approved: boolean;
  canEdit: boolean;
  canRelease: boolean;
  canOrder: boolean;
}): QtAction[] {
  if (q.isMigrated) return [];
  const actions: QtAction[] = [];
  if (q.status === 'DRAFT') {
    if (q.canEdit) actions.push('edit', 'delete');
    if (q.canEdit && q.discountOver && !q.approved) actions.push('requestApproval');
    if (q.canRelease && (!q.discountOver || q.approved)) actions.push('release');
    return actions;
  }
  if (q.status !== 'RELEASED') return [];
  actions.push('email');
  if (q.canEdit) actions.push('revise');
  if (!q.expired && q.canOrder) actions.push('transfer');
  if (q.canEdit) actions.push('markLost');
  return actions;
}

/** Valid-until is required to release and cannot be before the quotation date. */
export function releaseProblem(q: { validUntil: string | null; docDate: string }): string | null {
  if (!q.validUntil) return 'Set a valid-until date before releasing the quotation.';
  if (q.validUntil < q.docDate) return 'Valid until cannot be before the quotation date.';
  return null;
}
