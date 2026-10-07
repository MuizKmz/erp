/** Operation Policies rules (S29–S33): labels and the change-history wording. Pure functions. */

export const CREDIT_DOCS = ['QUOTATION', 'SALES_ORDER', 'DELIVERY', 'INVOICE', 'CASH_SALE'] as const;
export type CreditDoc = (typeof CREDIT_DOCS)[number];
export const CREDIT_ACTIONS = ['ALLOW', 'WARN', 'APPROVAL', 'BLOCK'] as const;
export type CreditActionCode = (typeof CREDIT_ACTIONS)[number];
export const APPROVER_ROLES = ['SALES_MANAGER', 'FINANCE_MANAGER'] as const;

export const DOC_LABEL: Record<CreditDoc, string> = {
  QUOTATION: 'Quotation',
  SALES_ORDER: 'Sales order',
  DELIVERY: 'Delivery order',
  INVOICE: 'Invoice',
  CASH_SALE: 'Cash sales',
};
export const ACTION_LABEL: Record<CreditActionCode, string> = { ALLOW: 'Allow', WARN: 'Allow, show warning', APPROVAL: 'Require approval', BLOCK: 'Block' };
export const ROLE_LABEL: Record<string, string> = { SALES_MANAGER: 'Sales Manager', FINANCE_MANAGER: 'Finance Manager' };
export const SCOPE_LABEL: Record<string, string> = { GROUP: 'Group-wide', BRANCH: 'Per branch' };

export const TOGGLES = {
  stockCheck: 'Stock check while entering',
  invoiceFromDelivered: 'Invoice from delivered quantity only',
  strictPriceList: 'Strict price list',
  roundTo5Sen: 'Round totals to 5 sen',
  showMargin: 'Show estimated margin',
  skipCreditForSystem: 'Skip credit check for system-made documents',
} as const;
export type ToggleKey = keyof typeof TOGGLES;

export interface CreditRuleView {
  docType: CreditDoc;
  overCreditAction: CreditActionCode;
  overOverdueAction: CreditActionCode;
  approverRole: string | null;
}

/** A rule that can require approval needs an approver; one that never does has none. */
export function ruleProblems(rules: CreditRuleView[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  rules.forEach((r, i) => {
    const needs = r.overCreditAction === 'APPROVAL' || r.overOverdueAction === 'APPROVAL';
    if (needs && !r.approverRole) problems.push({ field: `rules[${i}].approverRole`, message: `${DOC_LABEL[r.docType]}: pick who approves.` });
  });
  return problems;
}

/** Cleans a rule before saving: no approver when nothing needs approval. */
export function normaliseRule(r: CreditRuleView): CreditRuleView {
  const needs = r.overCreditAction === 'APPROVAL' || r.overOverdueAction === 'APPROVAL';
  return { ...r, approverRole: needs ? r.approverRole : null };
}

/**
 * Change-history lines for S29, in the wording of the seed:
 * "Invoice, over credit limit: Block → Require approval", "Sales order approver set to Sales Manager",
 * "Credit scope: Per branch → Group-wide", "Strict price list: On → Off".
 */
export function creditChanges(
  before: { scope: string; toggles: Record<ToggleKey, boolean>; rules: CreditRuleView[] },
  after: { scope: string; toggles: Record<ToggleKey, boolean>; rules: CreditRuleView[] },
): string[] {
  const out: string[] = [];
  if (before.scope !== after.scope) out.push(`Credit scope: ${SCOPE_LABEL[before.scope] ?? before.scope} → ${SCOPE_LABEL[after.scope] ?? after.scope}`);
  for (const r of after.rules) {
    const b = before.rules.find((x) => x.docType === r.docType);
    if (!b) continue;
    const doc = DOC_LABEL[r.docType];
    if (b.overCreditAction !== r.overCreditAction) out.push(`${doc}, over credit limit: ${ACTION_LABEL[b.overCreditAction]} → ${ACTION_LABEL[r.overCreditAction]}`);
    if (b.overOverdueAction !== r.overOverdueAction) out.push(`${doc}, over overdue limit: ${ACTION_LABEL[b.overOverdueAction]} → ${ACTION_LABEL[r.overOverdueAction]}`);
    if ((b.approverRole ?? null) !== (r.approverRole ?? null)) {
      out.push(r.approverRole ? `${doc} approver set to ${ROLE_LABEL[r.approverRole] ?? r.approverRole}` : `${doc} no longer needs an approver`);
    }
  }
  for (const key of Object.keys(TOGGLES) as ToggleKey[]) {
    if (before.toggles[key] !== after.toggles[key]) out.push(`${TOGGLES[key]}: ${before.toggles[key] ? 'On' : 'Off'} → ${after.toggles[key] ? 'On' : 'Off'}`);
  }
  return out;
}

/** "Enquiry: restart Never → Every month", "Delivery order: separate per branch Yes → No". */
export function numberingChanges(
  before: { docType: string; name: string; resetEvery: string; perBranch: boolean }[],
  after: { docType: string; resetEvery: string; perBranch: boolean }[],
): string[] {
  const restart = (v: string) => (v === 'MONTH' ? 'Every month' : 'Never');
  const out: string[] = [];
  for (const a of after) {
    const b = before.find((x) => x.docType === a.docType);
    if (!b) continue;
    if (b.resetEvery !== a.resetEvery) out.push(`${b.name}: restart ${restart(b.resetEvery)} → ${restart(a.resetEvery)}`);
    if (b.perBranch !== a.perBranch) out.push(`${b.name}: separate per branch ${b.perBranch ? 'Yes' : 'No'} → ${a.perBranch ? 'Yes' : 'No'}`);
  }
  return out;
}

/** A short upper-case code from a name: "Showroom display" → "SHOWROOMD" trimmed to 10. */
export function codeFromName(name: string, taken: string[]): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'TYPE';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now() % 100}`;
}

// ── Excluded items (S32) ─────────────────────────────────────────────────────

export const EXCLUSION_REASONS = ['Supplier recall', 'Not offered in branch', 'Seasonal', 'Pricing under review', 'Quality issue', 'Other'] as const;

export type ExclusionState = 'ACTIVE' | 'SCHEDULED' | 'ENDED';

/**
 * An exclusion is active from its start date until its end date (or until removed). One that starts later is
 * scheduled; it already shows in the list so nobody adds it twice.
 */
export function exclusionState(e: { fromDate: string; untilDate: string | null; removed: boolean }, today: string): ExclusionState {
  if (e.removed || (e.untilDate !== null && e.untilDate < today)) return 'ENDED';
  if (e.fromDate > today) return 'SCHEDULED';
  return 'ACTIVE';
}

export function exclusionProblems(e: { fromDate: string; untilDate: string | null; overlaps: boolean }): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (e.untilDate && e.untilDate < e.fromDate) problems.push({ field: 'untilDate', message: 'Until cannot be before From.' });
  if (e.overlaps) problems.push({ field: 'itemCode', message: 'This item is already excluded in that branch for those dates.' });
  return problems;
}

/** Template key from its name: "Payment thank-you" → "PAYMENT_THANK_YOU". */
export function templateKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'TEMPLATE';
}
