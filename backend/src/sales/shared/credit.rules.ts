import type { Prisma } from '@prisma/client';
import { dec, toMoney, toRmText, type DecimalInput } from '../../platform/http/decimal';

/**
 * Credit check (CLAUDE.md → Sales business rules 2, FlowS2 step 1). Pure functions.
 *   exposure after = owed now + other open orders + this document   → compared with the credit limit
 *   overdue now                                                      → compared with the overdue limit
 * What happens on a breach comes from Credit Control (S29): ALLOW, WARN, APPROVAL or BLOCK.
 */

export type CreditAction = 'ALLOW' | 'WARN' | 'APPROVAL' | 'BLOCK';
export type CreditResult = 'PASSED' | 'WARNED' | 'OVER_LIMIT' | 'BLOCKED';

export interface CreditInput {
  /** null = no limit */
  creditLimit: DecimalInput | null;
  overdueLimit: DecimalInput | null;
  owed: DecimalInput;
  overdue: DecimalInput;
  otherOpen: DecimalInput;
  thisDocument: DecimalInput;
}

export interface CreditRule {
  overCreditAction: string;
  overOverdueAction: string;
}

export interface CreditCheck {
  exposureAfter: Prisma.Decimal;
  headroom: Prisma.Decimal | null;
  overCredit: Prisma.Decimal;
  overOverdue: Prisma.Decimal;
  /** The strongest action the breaches call for (PASS when nothing is breached). */
  action: CreditAction | 'PASS';
  result: CreditResult;
}

const STRENGTH: Record<CreditAction | 'PASS', number> = { PASS: 0, ALLOW: 1, WARN: 2, APPROVAL: 3, BLOCK: 4 };
const asAction = (v: string): CreditAction => (['ALLOW', 'WARN', 'APPROVAL', 'BLOCK'].includes(v) ? (v as CreditAction) : 'APPROVAL');

export function checkCredit(input: CreditInput, rule: CreditRule): CreditCheck {
  const exposureAfter = dec(input.owed).add(dec(input.otherOpen)).add(dec(input.thisDocument));
  const headroom = input.creditLimit === null ? null : dec(input.creditLimit).sub(exposureAfter);
  const overCredit = headroom !== null && headroom.lt(0) ? headroom.neg() : dec(0);
  const overOverdue = input.overdueLimit === null ? dec(0) : max0(dec(input.overdue).sub(dec(input.overdueLimit)));

  let action: CreditAction | 'PASS' = 'PASS';
  if (overCredit.gt(0)) action = stronger(action, asAction(rule.overCreditAction));
  if (overOverdue.gt(0)) action = stronger(action, asAction(rule.overOverdueAction));
  const result: CreditResult = action === 'BLOCK' ? 'BLOCKED' : action === 'APPROVAL' ? 'OVER_LIMIT' : action === 'WARN' ? 'WARNED' : 'PASSED';
  return { exposureAfter, headroom, overCredit, overOverdue, action, result };
}

function max0(v: Prisma.Decimal): Prisma.Decimal {
  return v.gt(0) ? v : dec(0);
}

function stronger(a: CreditAction | 'PASS', b: CreditAction): CreditAction | 'PASS' {
  return STRENGTH[b] > STRENGTH[a] ? b : a;
}

/** "Credit limit over by RM 2,400.00 · overdue limit over by RM 2,000.00" (approval reason, S02). */
export function breachText(check: Pick<CreditCheck, 'overCredit' | 'overOverdue'>): string {
  const parts = [
    check.overCredit.gt(0) && `Credit limit over by ${toRmText(check.overCredit)}`,
    check.overOverdue.gt(0) && `${check.overCredit.gt(0) ? 'overdue' : 'Overdue'} limit over by ${toRmText(check.overOverdue)}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** The activity line written when the check runs on save. */
export function creditActivityText(input: CreditInput, check: CreditCheck): string {
  if (check.action === 'PASS' || check.action === 'ALLOW') {
    const limit = input.creditLimit === null ? 'no limit' : toRmText(input.creditLimit);
    return `Credit check passed: owed ${toRmText(input.owed)} + this order ${toRmText(input.thisDocument)} = ${toRmText(dec(input.owed).add(dec(input.thisDocument)))} of ${limit}`;
  }
  const parts = [
    check.overCredit.gt(0) && `over the credit limit by ${toRmText(check.overCredit)}`,
    check.overOverdue.gt(0) && `the overdue limit by ${toRmText(check.overOverdue)}`,
  ].filter(Boolean);
  const what = parts.join(' and ');
  if (check.action === 'WARN') return `Credit warning: ${what}`;
  if (check.action === 'BLOCK') return `Credit check blocked the order: ${what}`;
  return `Credit check did not pass: ${what}`;
}

/** Stored on the document as "Credit at save" (JSON, money as strings). */
export function creditSnapshot(input: CreditInput, check: CreditCheck, scope: string, checkedAt: Date, extra: Record<string, string> = {}) {
  return {
    scope,
    checkedAt: checkedAt.toISOString(),
    creditLimit: input.creditLimit === null ? null : toMoney(input.creditLimit),
    owed: toMoney(input.owed),
    otherOpen: toMoney(input.otherOpen),
    thisDocument: toMoney(input.thisDocument),
    exposureAfter: toMoney(check.exposureAfter),
    headroom: check.headroom === null ? null : toMoney(check.headroom),
    overCredit: toMoney(check.overCredit),
    overdue: toMoney(input.overdue),
    overdueLimit: input.overdueLimit === null ? null : toMoney(input.overdueLimit),
    overOverdue: toMoney(check.overOverdue),
    result: check.result,
    ...extra,
  };
}
