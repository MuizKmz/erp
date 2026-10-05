import type { Prisma } from '@prisma/client';
import { dec } from '../../platform/http/decimal';
import { SAL_ENTITY, SAL_ROLE } from '../shared/sales.constants';

/** Sales home (S01) rules. Pure functions. */

export type ApprovalKind = 'CREDIT' | 'PRICE' | 'DISCOUNT';

/**
 * Why a Sales document waits for approval: a quotation for a discount, a sales order or delivery for credit,
 * an invoice for credit when Finance decides and for price when the Sales Manager decides.
 */
export function approvalKind(entityType: string, approverRole: string | null): ApprovalKind {
  if (entityType === SAL_ENTITY.QUOTATION) return 'DISCOUNT';
  if (entityType === SAL_ENTITY.INVOICE) return approverRole === SAL_ROLE.FINANCE_MANAGER ? 'CREDIT' : 'PRICE';
  return 'CREDIT';
}

/** "2 over credit limit · 1 price override" */
export function waitingSummary(kinds: ApprovalKind[]): string {
  const count = (k: ApprovalKind) => kinds.filter((x) => x === k).length;
  const parts = [
    count('CREDIT') && `${count('CREDIT')} over credit limit`,
    count('PRICE') && `${count('PRICE')} price ${count('PRICE') === 1 ? 'override' : 'overrides'}`,
    count('DISCOUNT') && `${count('DISCOUNT')} ${count('DISCOUNT') === 1 ? 'discount' : 'discounts'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing waiting for you';
}

/** Open quantity of a sales order line still to deliver. */
export function toDeliver(l: { orderedQty: Prisma.Decimal; deliveredQty: Prisma.Decimal; cancelledQty: Prisma.Decimal }): Prisma.Decimal {
  const open = l.orderedQty.sub(l.deliveredQty).sub(l.cancelledQty);
  return open.gt(0) ? open : dec(0);
}

/** Delivered but not yet invoiced on a sales order line. */
export function toInvoice(l: { deliveredQty: Prisma.Decimal; invoicedQty: Prisma.Decimal }): Prisma.Decimal {
  const open = l.deliveredQty.sub(l.invoicedQty);
  return open.gt(0) ? open : dec(0);
}

/** Whole days between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The one-line reason on the Sales home approvals card: "Over credit limit by RM 2,400.00", "Price 12% below price list". */
export function shortReason(kind: ApprovalKind, reason: string): string {
  if (kind === 'CREDIT') {
    const credit = /credit limit over by (RM [\d,.]+)/i.exec(reason) ?? /over (?:the )?credit limit by (RM [\d,.]+)/i.exec(reason);
    if (credit) return `Over credit limit by ${credit[1]}`;
    const overdue = /overdue limit over by (RM [\d,.]+)/i.exec(reason);
    if (overdue) return `Over overdue limit by ${overdue[1]}`;
  }
  if (kind === 'PRICE') {
    const pct = /(\d+(?:\.\d+)?)% below/i.exec(reason);
    if (pct) return `Price ${pct[1]}% below price list`;
  }
  if (kind === 'DISCOUNT') {
    const pct = /discount (\d+(?:\.\d+)?)%/i.exec(reason);
    if (pct) return `Discount ${pct[1]}%, above the limit`;
  }
  return reason.split(' · ')[0] ?? reason;
}
