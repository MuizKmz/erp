/**
 * Users (A06, A07; CLAUDE.md → Phase 4, rules 1 to 4). Pure functions: the service passes plain values and gets back
 * the field errors, the refusal or the words the screens show. Dates are calendar days as 2026-09-29.
 */
import { dayText } from '../../platform/activity/audit.rules';
import { ADMIN_ROLE } from '../../platform/context/permission.rules';
import type { FieldError } from '../../platform/http/errors';
import { countOf, joinAnd } from '../shared/text.rules';

/** LMY, SC1, AP-CLERK-2: capitals, digits, dashes and underscores. A code never changes (rule 1). */
export const USER_CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

export const USER_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  jobTitle: 'Job title',
  department: 'Department',
  roles: 'Roles',
  branches: 'Branches',
  defaultBranch: 'Default branch',
  isActive: 'Active',
};

/** A role on the user form: which role, and the days it gives permissions (both inclusive, empty = no limit). */
export interface RoleRow {
  roleCode: string;
  validFrom: string | null;
  validUntil: string | null;
}

/** Each role picked from the list, once, with Until on or after From (rule 4); an active user has at least one (rule 3). */
export function roleRowErrors(rows: readonly RoleRow[], roleNames: ReadonlyMap<string, string>): FieldError[] {
  if (!rows.length) return [{ field: 'roles', message: 'Give the user at least one role.' }];
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const field = `roles[${i}]`;
    const name = roleNames.get(r.roleCode);
    if (!name) errors.push({ field, message: 'Pick the role from the list.' });
    else if (seen.has(r.roleCode)) errors.push({ field, message: `${name} is in the list twice.` });
    else if (r.validFrom && r.validUntil && r.validUntil < r.validFrom) errors.push({ field, message: `Until (${dayText(r.validUntil)}) is before From (${dayText(r.validFrom)}).` });
    seen.add(r.roleCode);
  });
  return errors;
}

/** At least one branch, picked from the active ones (one the user already had may stay), and the default among them (rule 3). */
export function branchErrors(
  branches: readonly string[],
  defaultBranch: string | null,
  known: ReadonlyMap<string, { name: string; isActive: boolean }>,
  had: readonly string[],
): FieldError[] {
  if (!branches.length) return [{ field: 'branches', message: 'Give the user at least one branch. A user with no branch cannot make documents.' }];
  const errors: FieldError[] = [];
  for (const code of branches) {
    const b = known.get(code);
    if (!b) errors.push({ field: 'branches', message: `${code} is not a branch.` });
    else if (!b.isActive && !had.includes(code)) errors.push({ field: 'branches', message: `${code} is inactive. Pick an active branch.` });
  }
  if (!defaultBranch || !branches.includes(defaultBranch)) errors.push({ field: 'defaultBranch', message: 'Pick the default branch among their branches.' });
  else if (known.get(defaultBranch) && !known.get(defaultBranch)!.isActive) errors.push({ field: 'defaultBranch', message: `${defaultBranch} is inactive. Pick an active branch as the default.` });
  return errors;
}

/** True when the role counts on the day: started, and not past its last day. */
export function roleCounts(row: RoleRow, today: string): boolean {
  return (!row.validFrom || row.validFrom <= today) && (!row.validUntil || row.validUntil >= today);
}

/** Holds Administrator for good: it has started and has no end date, so it cannot run out (rule 2). */
export function holdsAdminForGood(rows: readonly RoleRow[], today: string): boolean {
  return rows.some((r) => r.roleCode === ADMIN_ROLE && !r.validUntil && (!r.validFrom || r.validFrom <= today));
}

/** At least one active user always holds Administrator (rule 2). */
export function lastAdminRefusal(name: string, stillAdmin: boolean, otherAdmins: number): string | null {
  return stillAdmin || otherAdmins > 0 ? null : `${name} is the only active user who holds Administrator for good. Give the role to someone else first.`;
}

/** Why the user cannot be made inactive: yourself, or the last Administrator. */
export function deactivateRefusal(isSelf: boolean, name: string, isLastAdmin: boolean): string | null {
  if (isSelf) return 'You cannot deactivate yourself. Ask another administrator.';
  if (isLastAdmin) return lastAdminRefusal(name, false, 0);
  return null;
}

export type TwoFactorState = 'REQUIRED_MISSING' | 'REQUIRED_SET' | 'SET' | 'NOT_REQUIRED';

/** Two-factor as A06 shows it: required by a role (setting, choice 9), and set up or not. */
export function twoFactorState(required: boolean, enabled: boolean): TwoFactorState {
  if (required) return enabled ? 'REQUIRED_SET' : 'REQUIRED_MISSING';
  return enabled ? 'SET' : 'NOT_REQUIRED';
}

export const TWO_FACTOR_TEXT: Record<TwoFactorState, string> = {
  REQUIRED_MISSING: 'Required · not set up',
  REQUIRED_SET: 'Required · set up',
  SET: 'Set up',
  NOT_REQUIRED: 'Not required',
};

/** The two-factor filter on A06: missing, set (required or not), notRequired. */
export function twoFactorMatches(state: TwoFactorState, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === 'missing') return state === 'REQUIRED_MISSING';
  if (filter === 'set') return state === 'REQUIRED_SET' || state === 'SET';
  if (filter === 'notRequired') return state === 'NOT_REQUIRED';
  return true;
}

export type UserStatus = 'active' | 'locked' | 'inactive';

/** The status tab a user falls in. A locked user is still active (Active counts them too). */
export function userStatus(isActive: boolean, lockedUntil: Date | null, now: Date): UserStatus {
  if (!isActive) return 'inactive';
  return lockedUntil && lockedUntil.getTime() > now.getTime() ? 'locked' : 'active';
}

export const STATUS_LABEL: Record<UserStatus, string> = { active: 'Active', locked: 'Locked', inactive: 'Inactive' };

/** "Aina Rahman · Sales agent · HQ" under the user title. */
export function userSubtitle(name: string, jobTitle: string | null, branches: readonly string[]): string {
  return [name, jobTitle, branches.join(', ')].filter((p) => p).join(' · ');
}

/** Under the branch switches: where the user works and where new documents start. */
export function branchNote(branches: readonly string[], defaultBranch: string | null): string {
  const after = 'A user with no branch cannot make documents.';
  if (!branches.length) return after;
  if (branches.length === 1) return `Works in ${branches[0]} only. ${after}`;
  return `Works in ${joinAnd(branches)}; new documents start in ${defaultBranch ?? branches[0]}, the default branch. ${after}`;
}

/** Under the roles table, with the customers an agent-scoped role limits the user to (A7). */
export function rolesNote(name: string, agentRoles: readonly string[], customers: readonly string[]): string {
  const agent = agentRoles.length
    ? ` ${joinAnd(agentRoles)} ${agentRoles.length === 1 ? 'limits' : 'limit'} them to their own customers (${name}: ${customers.length ? customers.join(', ') : 'none yet'}).`
    : '';
  return `Permissions are the sum of all roles.${agent} A role can end on a date for temporary access.`;
}

/** "from 1 Oct 2026 until 31 Dec 2026", "until 31 Dec 2026", or empty. */
function datesText(r: RoleRow): string {
  return [r.validFrom ? `from ${dayText(r.validFrom)}` : null, r.validUntil ? `until ${dayText(r.validUntil)}` : null].filter((d) => d).join(' ');
}

/** The roles as the audit line reads them: "Sales agent, Billing (until 31 Dec 2026)". */
export function rolesText(rows: readonly RoleRow[], names: ReadonlyMap<string, string>): string {
  return rows.map((r) => (datesText(r) ? `${names.get(r.roleCode) ?? r.roleCode} (${datesText(r)})` : (names.get(r.roleCode) ?? r.roleCode))).join(', ');
}

/** What changed in the user's roles, for the security log: "added Auditor; removed Billing; Sales agent now until 31 Dec 2026". */
export function roleChangeText(before: readonly RoleRow[], after: readonly RoleRow[], names: ReadonlyMap<string, string>): string | null {
  const name = (code: string) => names.get(code) ?? code;
  const was = new Map(before.map((r) => [r.roleCode, r]));
  const now = new Set(after.map((r) => r.roleCode));
  const added = after.filter((r) => !was.has(r.roleCode)).map((r) => name(r.roleCode));
  const removed = before.filter((r) => !now.has(r.roleCode)).map((r) => name(r.roleCode));
  const redated = after
    .filter((r) => was.has(r.roleCode) && (was.get(r.roleCode)!.validFrom !== r.validFrom || was.get(r.roleCode)!.validUntil !== r.validUntil))
    .map((r) => `${name(r.roleCode)} now ${datesText(r) || 'without dates'}`);
  const parts = [...(added.length ? [`added ${joinAnd(added)}`] : []), ...(removed.length ? [`removed ${joinAnd(removed)}`] : []), ...redated];
  return parts.length ? parts.join('; ') : null;
}

/** "16 permissions from 3 roles." on the Effective permissions card. */
export function effectiveText(permissions: number, roles: number): string {
  return `${countOf(permissions, 'permission')} from ${countOf(roles, 'role')}.`;
}
