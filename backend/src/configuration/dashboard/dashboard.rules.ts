/** A1 · Configuration home: the cards and the *Needs attention* lines (CfgHome.html). Pure functions. */

export interface AttentionLine {
  key: string;
  /** The linked words that start the line: "2 users", "Auditor", "Company". */
  lead: string;
  text: string;
  to: string;
}

/** "Purchase, Sales, Core and Configuration". */
export function joinAnd(items: readonly string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "1 user", "2 users". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Names on a card, at most three: "HQ Shah Alam · Penang Branch", "A · B · C and 2 more". */
export function namesText(names: readonly string[]): string {
  if (!names.length) return 'None yet';
  return names.length <= 3 ? names.join(' · ') : `${names.slice(0, 3).join(' · ')} and ${names.length - 3} more`;
}

/** "14 active · 0 locked", with the inactive ones when there are any. */
export function usersText(active: number, locked: number, inactive: number): string {
  return [`${active} active`, `${locked} locked`, ...(inactive ? [`${inactive} inactive`] : [])].join(' · ');
}

/** "16 starter roles · 0 custom". */
export function rolesText(starter: number, custom: number): string {
  return `${countOf(starter, 'starter role')} · ${custom} custom`;
}

/** Users whose roles need two-factor and who have not set it up (FR-SEC-061): they cannot finish signing in. */
export function twoFactorAttention(names: readonly string[]): AttentionLine | null {
  if (!names.length) return null;
  return {
    key: 'two-factor',
    lead: countOf(names.length, 'user'),
    text: `must set up two-factor before they can sign in: ${names.join(', ')}. Their roles carry admin or finance authority.`,
    to: '/config/users?twoFactor=missing',
  };
}

/** The read-only audit role (FR-SEC-015, choice 7) is there to be given to someone. */
export function auditorAttention(holders: number, roleId: string | null): AttentionLine | null {
  if (holders > 0 || !roleId) return null;
  return { key: 'auditor', lead: 'Auditor', text: 'is a starter role nobody holds yet. Give it to whoever reviews the audit trail.', to: `/config/roles/${roleId}` };
}

/** The seller's identity on every e-Invoice. Demo tax numbers are flagged on the Company page (A04). */
const COMPANY_FIELD: Record<string, string> = {
  tin: 'TIN',
  registrationNo: 'registration number',
};

/** An invented TIN or registration number must be replaced before a real e-Invoice goes out (choice 14). */
export function demoAttention(demoFields: readonly string[]): AttentionLine | null {
  const labels = Object.keys(COMPANY_FIELD).filter((f) => demoFields.includes(f)).map((f) => COMPANY_FIELD[f]!);
  if (!labels.length) return null;
  return { key: 'company-demo', lead: 'Company', text: `has demo values for its ${joinAnd(labels)}. Replace them before the first real e-Invoice.`, to: '/config/company' };
}

/** The demo fields of a company or branch row (a JSON array of field names). */
export function demoFieldsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
