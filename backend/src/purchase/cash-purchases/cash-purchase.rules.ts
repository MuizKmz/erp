import { dec, toRmText, type DecimalInput } from '../../platform/http/decimal';

/**
 * Cash purchase rules (FlowP7, CLAUDE.md rule 10). Pure functions, no database.
 */

export type CashPurchaseStatus = 'DRAFT' | 'RELEASED';
export type CashPurchaseAction = 'edit' | 'delete' | 'release';

/** Rule 10: at most RM 1,000.00 per receipt; anything bigger needs a purchase order. */
export const CASH_PURCHASE_LIMIT = '1000.00';

export function allowedCashPurchaseActions(input: { status: CashPurchaseStatus; isMigrated: boolean; canEdit: boolean; canRelease: boolean }): CashPurchaseAction[] {
  if (input.status !== 'DRAFT' || input.isMigrated) return [];
  const actions: CashPurchaseAction[] = [];
  if (input.canEdit || input.canRelease) actions.push('edit', 'delete');
  if (input.canRelease) actions.push('release');
  return actions;
}

export interface CashCheck {
  key: 'limit' | 'photo' | 'supplier' | 'payment';
  ok: boolean;
  text: string;
}

/** The "Checks" panel; every one must pass before release. */
export function cashChecks(input: {
  total: DecimalInput;
  hasPhoto: boolean;
  supplierActive: boolean;
  supplierName: string;
  payment: { label: string; active: boolean; branchCode: string; holder: string | null } | null;
  branchCode: string;
  limit?: DecimalInput;
}): CashCheck[] {
  const limit = input.limit ?? CASH_PURCHASE_LIMIT;
  const under = dec(input.total).lte(dec(limit));
  const paymentOk = Boolean(input.payment && input.payment.active && input.payment.branchCode === input.branchCode);
  return [
    { key: 'limit', ok: under, text: under ? `${toRmText(input.total)} is within the ${toRmText(limit)} limit` : `${toRmText(input.total)} is over the ${toRmText(limit)} limit. Raise a purchase order instead.` },
    { key: 'photo', ok: input.hasPhoto, text: input.hasPhoto ? 'Receipt photo is attached' : 'Add a photo of the receipt' },
    { key: 'supplier', ok: input.supplierActive, text: input.supplierActive ? 'Supplier is active in Master Data' : `${input.supplierName} is blocked in Master Data` },
    {
      key: 'payment',
      ok: paymentOk,
      text: !input.payment
        ? 'Pick how it was paid'
        : paymentOk
          ? `${input.payment.label} is allowed for ${input.payment.holder ?? input.branchCode}`
          : `${input.payment.label} is not allowed for this branch`,
    },
  ];
}
