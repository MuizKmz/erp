import {
  branchErrors,
  branchNote,
  deactivateRefusal,
  effectiveText,
  holdsAdminForGood,
  lastAdminRefusal,
  roleChangeText,
  roleCounts,
  roleRowErrors,
  rolesNote,
  rolesText,
  twoFactorMatches,
  twoFactorState,
  USER_CODE,
  userStatus,
  userSubtitle,
} from './users.rules';

const names = new Map([
  ['ADMIN', 'Administrator'],
  ['SALES_AGENT', 'Sales agent'],
  ['SALES_BILLING', 'Billing'],
  ['AUDITOR', 'Auditor'],
]);
const role = (roleCode: string, validFrom: string | null = null, validUntil: string | null = null) => ({ roleCode, validFrom, validUntil });

describe('users', () => {
  it('takes codes of capitals, digits, dashes and underscores', () => {
    expect(USER_CODE.test('LMY')).toBe(true);
    expect(USER_CODE.test('AP_CLERK-2')).toBe(true);
    expect(USER_CODE.test('lmy')).toBe(false);
    expect(USER_CODE.test('-LMY')).toBe(false);
  });

  it('wants at least one role, each from the list and once, with Until on or after From (rules 3 and 4)', () => {
    expect(roleRowErrors([], names)).toEqual([{ field: 'roles', message: 'Give the user at least one role.' }]);
    expect(roleRowErrors([role('SALES_AGENT'), role('NOPE'), role('SALES_AGENT'), role('SALES_BILLING', '2026-10-01', '2026-09-30')], names)).toEqual([
      { field: 'roles[1]', message: 'Pick the role from the list.' },
      { field: 'roles[2]', message: 'Sales agent is in the list twice.' },
      { field: 'roles[3]', message: 'Until (30 Sep 2026) is before From (1 Oct 2026).' },
    ]);
    expect(roleRowErrors([role('SALES_AGENT', '2026-10-01', '2026-10-01')], names)).toEqual([]);
  });

  it('wants at least one active branch and the default among them (rule 3)', () => {
    const known = new Map([
      ['HQ', { name: 'HQ Shah Alam', isActive: true }],
      ['KL', { name: 'KL', isActive: false }],
    ]);
    expect(branchErrors([], null, known, [])).toEqual([{ field: 'branches', message: 'Give the user at least one branch. A user with no branch cannot make documents.' }]);
    expect(branchErrors(['HQ', 'KL', 'XX'], 'PNG', known, [])).toEqual([
      { field: 'branches', message: 'KL is inactive. Pick an active branch.' },
      { field: 'branches', message: 'XX is not a branch.' },
      { field: 'defaultBranch', message: 'Pick the default branch among their branches.' },
    ]);
    expect(branchErrors(['HQ', 'KL'], 'HQ', known, ['KL'])).toEqual([]);
    expect(branchErrors(['HQ', 'KL'], 'KL', known, ['KL'])).toEqual([{ field: 'defaultBranch', message: 'KL is inactive. Pick an active branch as the default.' }]);
  });

  it('counts a role from its first day to its last day (rule 4)', () => {
    expect(roleCounts(role('SALES_AGENT', null, '2026-09-29'), '2026-09-29')).toBe(true);
    expect(roleCounts(role('SALES_AGENT', null, '2026-09-28'), '2026-09-29')).toBe(false);
    expect(roleCounts(role('SALES_AGENT', '2026-09-30'), '2026-09-29')).toBe(false);
  });

  it('always keeps one active user who holds Administrator for good (rule 2)', () => {
    expect(holdsAdminForGood([role('ADMIN')], '2026-09-29')).toBe(true);
    expect(holdsAdminForGood([role('ADMIN', null, '2026-12-31')], '2026-09-29')).toBe(false);
    expect(holdsAdminForGood([role('ADMIN', '2026-10-01')], '2026-09-29')).toBe(false);
    expect(lastAdminRefusal('Admin', false, 0)).toBe('Admin is the only active user who holds Administrator for good. Give the role to someone else first.');
    expect(lastAdminRefusal('Admin', false, 1)).toBeNull();
    expect(lastAdminRefusal('Admin', true, 0)).toBeNull();
    expect(deactivateRefusal(true, 'Admin', false)).toBe('You cannot deactivate yourself. Ask another administrator.');
    expect(deactivateRefusal(false, 'Admin', true)).toContain('only active user who holds Administrator');
    expect(deactivateRefusal(false, 'Aina Rahman', false)).toBeNull();
  });

  it('shows two-factor and status as A06 does, and filters on them', () => {
    expect(twoFactorState(true, false)).toBe('REQUIRED_MISSING');
    expect(twoFactorState(true, true)).toBe('REQUIRED_SET');
    expect(twoFactorState(false, true)).toBe('SET');
    expect(twoFactorState(false, false)).toBe('NOT_REQUIRED');
    expect(twoFactorMatches('REQUIRED_MISSING', 'missing')).toBe(true);
    expect(twoFactorMatches('SET', 'set')).toBe(true);
    expect(twoFactorMatches('REQUIRED_SET', 'notRequired')).toBe(false);
    expect(twoFactorMatches('NOT_REQUIRED', undefined)).toBe(true);
    const now = new Date('2026-09-29T02:15:00Z');
    expect(userStatus(true, null, now)).toBe('active');
    expect(userStatus(true, new Date('2026-09-29T02:30:00Z'), now)).toBe('locked');
    expect(userStatus(true, new Date('2026-09-29T02:00:00Z'), now)).toBe('active');
    expect(userStatus(false, null, now)).toBe('inactive');
  });

  it('writes the lines A07 shows, in neutral words', () => {
    expect(userSubtitle('Aina Rahman', 'Sales agent', ['HQ'])).toBe('Aina Rahman · Sales agent · HQ');
    expect(userSubtitle('Nurul', null, ['HQ'])).toBe('Nurul · HQ');
    expect(branchNote(['HQ'], 'HQ')).toBe('Works in HQ only. A user with no branch cannot make documents.');
    expect(branchNote(['HQ', 'PNG'], 'HQ')).toBe('Works in HQ and PNG; new documents start in HQ, the default branch. A user with no branch cannot make documents.');
    expect(rolesNote('Aina Rahman', ['Sales agent'], ['C-0012', 'C-0102'])).toBe(
      'Permissions are the sum of all roles. Sales agent limits them to their own customers (Aina Rahman: C-0012, C-0102). A role can end on a date for temporary access.',
    );
    expect(rolesNote('Lim Mei Ying', [], [])).toBe('Permissions are the sum of all roles. A role can end on a date for temporary access.');
    expect(effectiveText(16, 3)).toBe('16 permissions from 3 roles.');
    expect(effectiveText(1, 1)).toBe('1 permission from 1 role.');
  });

  it('reads role changes for the audit and the security log', () => {
    expect(rolesText([role('SALES_AGENT'), role('SALES_BILLING', null, '2026-12-31'), role('AUDITOR', '2026-10-01', '2026-10-31')], names)).toBe(
      'Sales agent, Billing (until 31 Dec 2026), Auditor (from 1 Oct 2026 until 31 Oct 2026)',
    );
    expect(roleChangeText([role('SALES_AGENT'), role('SALES_BILLING')], [role('SALES_AGENT', null, '2026-12-31'), role('AUDITOR')], names)).toBe(
      'added Auditor; removed Billing; Sales agent now until 31 Dec 2026',
    );
    expect(roleChangeText([role('SALES_AGENT', null, '2026-12-31')], [role('SALES_AGENT')], names)).toBe('Sales agent now without dates');
    expect(roleChangeText([role('SALES_AGENT')], [role('SALES_AGENT')], names)).toBeNull();
  });
});
