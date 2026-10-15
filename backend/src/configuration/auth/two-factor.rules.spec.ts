import { groupedKey, normalizeRecoveryCode, RECOVERY_ALPHABET, recoveryCodeFrom, setupReason, totpCode, twoFactorRequired } from './two-factor.rules';

describe('two-factor rules (rule 8; SRS FR-SEC-061)', () => {
  it('shows the key in groups of four, to type into the app', () => {
    expect(groupedKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupedKey('JBSWY3')).toBe('JBSW Y3');
  });

  it('makes recovery codes people can read out: ABCD-EFGH, without 0, O, 1, I or L', () => {
    const code = recoveryCodeFrom(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 99]));
    expect(code).toBe('ABCD-EFGH');
    expect(recoveryCodeFrom(Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255]))).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(RECOVERY_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('reads a recovery code however it is typed', () => {
    expect(normalizeRecoveryCode('abcd efgh')).toBe('ABCD-EFGH');
    expect(normalizeRecoveryCode(' ABCD-EFGH ')).toBe('ABCD-EFGH');
    expect(normalizeRecoveryCode('ABCDEFG')).toBeNull();
  });

  it('takes six digits from the app, spaces allowed', () => {
    expect(totpCode('482 913')).toBe('482913');
    expect(totpCode('48291')).toBeNull();
    expect(totpCode('48291a')).toBeNull();
  });

  it('is required when any role the user holds is one the settings name', () => {
    const required = ['ADMIN', 'FINANCE_MANAGER'];
    expect(twoFactorRequired(['SALES_AGENT', 'FINANCE_MANAGER'], required)).toBe(true);
    expect(twoFactorRequired(['SALES_AGENT'], required)).toBe(false);
    expect(twoFactorRequired(['ADMIN'], [])).toBe(false);
  });

  it('says why on the set-up page, as CfgTwoFactor.html does', () => {
    expect(setupReason(['Administrator'])).toBe('Your role (Administrator) handles admin and finance work, so a code from your phone is needed at each sign-in.');
    expect(setupReason(['Finance Director', 'Finance Manager'])).toBe('Your roles (Finance Director, Finance Manager) handle admin and finance work, so a code from your phone is needed at each sign-in.');
  });
});
