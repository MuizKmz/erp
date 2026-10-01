import { dec, toMoney, toRmText, type DecimalInput } from '../../platform/http/decimal';

/**
 * Purchase order approval limits (CLAUDE.md rule 3, Approval Rules P24):
 *   HQ over RM 10,000 → Purchasing Manager · Penang over RM 5,000 → Branch Manager
 *   any branch over RM 50,000 → also Finance Director · under the limit the buyer releases directly.
 * "Over" means strictly more than the limit.
 */

export interface PoLimitRule {
  /** null = every branch */
  branchCode: string | null;
  thresholdAmount: DecimalInput | null;
  approverRole: string | null;
  approverCode: string | null;
  approverName: string | null;
  secondOverAmount: DecimalInput | null;
  secondApproverRole: string | null;
  secondApproverCode: string | null;
  secondApproverName: string | null;
}

export interface ApprovalStepNeed {
  approverRole: string;
  approverCode: string | null;
  approverName: string | null;
}

export interface PoApprovalNeed {
  required: boolean;
  /** For the user: "RM 46,200.00 is over the RM 10,000.00 limit for HQ Shah Alam." */
  reason: string;
  limit: string | null;
  steps: ApprovalStepNeed[];
  /** Second approver line in the dialog: "Not needed · under RM 50,000.00" */
  second: { needed: boolean; over: string | null; text: string };
}

/** The rule for a branch, falling back to the all-branches rule. */
export function pickRule(rules: PoLimitRule[], branchCode: string): PoLimitRule | undefined {
  return rules.find((r) => r.branchCode === branchCode) ?? rules.find((r) => r.branchCode === null);
}

export function poApprovalNeed(input: {
  branchCode: string;
  branchName: string;
  total: DecimalInput;
  rules: PoLimitRule[];
}): PoApprovalNeed {
  const rule = pickRule(input.rules, input.branchCode);
  const total = dec(input.total);
  if (!rule || rule.thresholdAmount === null) {
    return {
      required: false,
      reason: `No approval limit is set for ${input.branchName}.`,
      limit: null,
      steps: [],
      second: { needed: false, over: null, text: 'Not needed' },
    };
  }

  const limit = dec(rule.thresholdAmount);
  const steps: ApprovalStepNeed[] = [];
  const overFirst = total.gt(limit) && rule.approverRole !== null;
  if (overFirst) {
    steps.push({ approverRole: rule.approverRole!, approverCode: rule.approverCode, approverName: rule.approverName });
  }

  const secondLimit = rule.secondOverAmount === null ? null : dec(rule.secondOverAmount);
  const overSecond = secondLimit !== null && total.gt(secondLimit) && rule.secondApproverRole !== null;
  if (overSecond) {
    steps.push({ approverRole: rule.secondApproverRole!, approverCode: rule.secondApproverCode, approverName: rule.secondApproverName });
  }

  const second = !secondLimit
    ? { needed: false, over: null, text: 'Not needed' }
    : overSecond
      ? { needed: true, over: toMoney(secondLimit), text: `${rule.secondApproverName ?? rule.secondApproverRole} · over ${toRmText(secondLimit)}` }
      : { needed: false, over: toMoney(secondLimit), text: `Not needed · under ${toRmText(secondLimit)}` };

  if (steps.length === 0) {
    return {
      required: false,
      reason: `${toRmText(total)} is under the ${toRmText(limit)} ${input.branchCode} limit.`,
      limit: toMoney(limit),
      steps,
      second,
    };
  }

  const breached = overFirst ? limit : secondLimit!;
  return {
    required: true,
    reason: `${toRmText(total)} is over the ${toRmText(breached)} limit for ${input.branchName}.`,
    limit: toMoney(breached),
    steps,
    second,
  };
}
