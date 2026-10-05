import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Sales order rules (FlowS2, S10–S12). Pure functions. */

export const SO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE', 'CANCELLED'] as const;
export type SoStatus = (typeof SO_STATUSES)[number];

export type OrderAction = 'edit' | 'delete' | 'requestApproval' | 'release' | 'email' | 'deliver' | 'invoice' | 'proforma' | 'cancelBalance' | 'flow';

export const ORDER_LOCKED_MESSAGE = 'Released orders are locked. Change them by revision, or cancel the undelivered balance.';

/**
 * What the current user may do with an order. A draft over its credit limit must be approved before it can be
 * released; while it waits, it is locked. The requester never decides their own request (the inbox checks that).
 */
export function allowedOrderActions(o: {
  status: SoStatus;
  isMigrated: boolean;
  creditNeedsApproval: boolean;
  creditBlocked: boolean;
  approved: boolean;
  hasOpenBalance: boolean;
  hasToInvoice: boolean;
  canEdit: boolean;
  canRelease: boolean;
  canDeliver: boolean;
  canInvoice: boolean;
  canProforma: boolean;
  canCancel: boolean;
}): OrderAction[] {
  if (o.isMigrated) return [];
  const actions: OrderAction[] = [];
  if (o.status === 'DRAFT') {
    if (o.canEdit) actions.push('edit', 'delete');
    if (o.canEdit && o.creditNeedsApproval && !o.approved) actions.push('requestApproval');
    if (o.canRelease && !o.creditBlocked && (!o.creditNeedsApproval || o.approved)) actions.push('release');
    return actions;
  }
  if (o.status === 'PENDING_APPROVAL') return [];
  actions.push('email', 'flow');
  if (o.status === 'RELEASED' || o.status === 'PARTIAL') {
    if (o.hasOpenBalance && o.canDeliver) actions.push('deliver');
    if (o.hasOpenBalance && o.canProforma) actions.push('proforma');
    if (o.hasOpenBalance && o.canCancel) actions.push('cancelBalance');
  }
  if (o.hasToInvoice && o.canInvoice) actions.push('invoice');
  return actions;
}

export interface OrderLineInput {
  index: number;
  qty: DecimalInput;
  unitPrice: DecimalInput;
  discountPct: DecimalInput;
}

/** Field problems on order lines: quantity above 0, price not negative, discount 0–100 %. */
export function lineProblems(lines: OrderLineInput[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  for (const l of lines) {
    if (!dec(l.qty).gt(0)) problems.push({ field: `lines[${l.index}].qty`, message: 'Quantity must be more than 0.' });
    if (dec(l.unitPrice).lt(0)) problems.push({ field: `lines[${l.index}].unitPrice`, message: 'Unit price cannot be negative.' });
    if (dec(l.discountPct).lt(0) || dec(l.discountPct).gt(100)) problems.push({ field: `lines[${l.index}].discountPct`, message: 'Discount must be between 0% and 100%.' });
  }
  return problems;
}

/** "Partial · 60 of 100 delivered" chip next to the status on S11, and "Balance cancelled" for a closed balance. */
export function statusLabel(status: SoStatus, balanceCancelled: boolean): string {
  if (balanceCancelled) return 'Balance cancelled';
  return { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', RELEASED: 'Released', PARTIAL: 'Partial', DONE: 'Done', CANCELLED: 'Cancelled' }[status];
}

/** Stock warning at release (policy: warn, never block): "60 in stock, 40 short". Null when nothing is short. */
export function stockShortfall(lines: { itemCode: string; qty: Prisma.Decimal; onHand: Prisma.Decimal; isStock: boolean }[]): string | null {
  const short = lines.filter((l) => l.isStock && l.onHand.lt(l.qty));
  if (!short.length) return null;
  const plain = (v: Prisma.Decimal) => (v.isInteger() ? v.toFixed(0) : v.toFixed(2));
  return short
    .map((l) => `${lines.length > 1 ? `${l.itemCode}: ` : ''}${plain(l.onHand.gt(0) ? l.onHand : dec(0))} in stock, ${plain(l.qty.sub(l.onHand.gt(0) ? l.onHand : dec(0)))} short`)
    .join('; ');
}

/** Credit column on S10: "Over limit", "OK", or "Checked on save" for a draft not checked yet. */
export function creditLabel(result: string | null, status: SoStatus): string {
  if (!result) return status === 'DRAFT' ? 'Checked on save' : 'OK';
  if (result === 'OVER_LIMIT' || result === 'BLOCKED') return 'Over limit';
  if (result === 'WARNED') return 'Warning';
  return 'OK';
}
