import type { Prisma } from '@prisma/client';
import { dec, roundMoney, type DecimalInput } from '../../platform/http/decimal';

/** Proforma rules (FlowS4, S21, S22, rule 9). Pure functions. */

export const PF_STATUSES = ['DRAFT', 'SENT', 'PAID', 'USED', 'CANCELLED'] as const;
export type PfStatus = (typeof PF_STATUSES)[number];
export type PfRequestKind = 'DEPOSIT_PCT' | 'PAY_BEFORE_RELEASE';

export type ProformaAction = 'edit' | 'delete' | 'release' | 'email' | 'cancel';

export const PF_LOCKED_MESSAGE = 'A sent proforma cannot be changed. Cancel it and make a new one if the request changes.';

/** Deposit requested: a percentage of the order total, or the whole total when the customer pays before release. */
export function depositAmount(kind: PfRequestKind, orderTotal: DecimalInput, pct: DecimalInput | null): Prisma.Decimal {
  if (kind === 'PAY_BEFORE_RELEASE') return dec(orderTotal);
  return roundMoney(dec(orderTotal).mul(dec(pct ?? 0)).div(100));
}

/**
 * The status a proforma shows. Finance records payments (fin_receipt_stub); a sent proforma whose receipts cover
 * the amount is Paid, without Sales changing anything by hand.
 */
export function effectiveStatus(status: PfStatus, amount: DecimalInput, received: DecimalInput): PfStatus {
  if (status === 'SENT' && dec(received).gte(dec(amount)) && dec(amount).gt(0)) return 'PAID';
  return status;
}

/** Chip text: "Draft", "Sent", "Paid", "Used on INV-0002", "Cancelled". */
export function proformaLabel(status: PfStatus, usedOnInvoice: string | null): string {
  if (status === 'USED') return usedOnInvoice ? `Used on ${usedOnInvoice}` : 'Used on invoice';
  return { DRAFT: 'Draft', SENT: 'Sent', PAID: 'Paid', CANCELLED: 'Cancelled', USED: 'Used on invoice' }[status];
}

/** "Deposit 30%" or "Pay before release" */
export function requestLabel(kind: PfRequestKind, pct: DecimalInput | null): string {
  return kind === 'PAY_BEFORE_RELEASE' ? 'Pay before release' : `Deposit ${dec(pct ?? 0).toDecimalPlaces(2).toString()}%`;
}

export function requestProblem(kind: PfRequestKind, pct: DecimalInput | null): string | null {
  if (kind === 'PAY_BEFORE_RELEASE') return null;
  if (pct === null || pct === '') return 'Enter the deposit percentage.';
  const p = dec(pct);
  if (p.lte(0) || p.gt(100)) return 'Deposit % must be more than 0 and at most 100.';
  return null;
}

/**
 * The deposit that the order's next invoice uses (rule 9): only a paid proforma not used yet, once, and never more
 * than the invoice total.
 */
export function depositToUse(invoiceTotal: DecimalInput, proforma: { amount: DecimalInput; received: DecimalInput } | null): Prisma.Decimal {
  if (!proforma) return dec(0);
  const paid = Prisma_min(dec(proforma.received), dec(proforma.amount));
  return Prisma_min(paid, dec(invoiceTotal));
}

export function allowedProformaActions(p: { status: PfStatus; isMigrated: boolean; canEdit: boolean }): ProformaAction[] {
  if (p.isMigrated || !p.canEdit) return [];
  if (p.status === 'DRAFT') return ['edit', 'delete', 'release'];
  if (p.status === 'SENT') return ['email', 'cancel'];
  if (p.status === 'PAID') return ['email'];
  return [];
}

function Prisma_min(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lt(b) ? a : b;
}
