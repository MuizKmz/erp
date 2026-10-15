import { passwordChangeDue, readSignInSettings, settingsErrors, SIGN_IN_DEFAULTS, signInKey } from './sign-in.rules';

describe('sign-in settings', () => {
  it('starts from the settings CONFIG_SEED_DATA.md decides', () => {
    expect(readSignInSettings([])).toEqual(SIGN_IN_DEFAULTS);
    expect(SIGN_IN_DEFAULTS).toMatchObject({ passwordMinLength: 10, lockoutAttempts: 5, lockoutMinutes: 15, idleMinutes: 30, accessMinutes: 15, refreshDays: 30, linkMinutes: 60 });
    expect(signInKey('lockoutAttempts')).toBe('sign_in.lockoutAttempts');
  });

  it('takes a stored value of the right kind, and falls back on a malformed one', () => {
    const settings = readSignInSettings([
      { key: 'sign_in.lockoutAttempts', value: 6 },
      { key: 'sign_in.idleMinutes', value: '45' },
      { key: 'sign_in.passwordMaxAgeDays', value: 90 },
      { key: 'sign_in.twoFactorRoles', value: ['ADMIN'] },
      { key: 'sign_in.refuseCommonPasswords', value: 0 },
      { key: 'other.setting', value: 1 },
    ]);
    expect(settings.lockoutAttempts).toBe(6);
    expect(settings.idleMinutes).toBe(30);
    expect(settings.passwordMaxAgeDays).toBe(90);
    expect(settings.twoFactorRoles).toEqual(['ADMIN']);
    expect(settings.refuseCommonPasswords).toBe(true);
    expect(readSignInSettings([{ key: 'sign_in.passwordMaxAgeDays', value: -1 }]).passwordMaxAgeDays).toBeNull();
  });

  it('never hands out the defaults themselves to change', () => {
    readSignInSettings([]).twoFactorRoles.push('STORE');
    expect(SIGN_IN_DEFAULTS.twoFactorRoles).not.toContain('STORE');
  });

  it('checks the A14 form: whole numbers in range, a listed password age, roles that exist', () => {
    const roles = new Set(['ADMIN', 'FINANCE_MANAGER', 'STORE']);
    expect(settingsErrors({ ...SIGN_IN_DEFAULTS, twoFactorRoles: ['ADMIN'] }, roles)).toEqual([]);
    expect(settingsErrors({ ...SIGN_IN_DEFAULTS, passwordMinLength: 7, idleMinutes: 30.5, linkMinutes: 2000, passwordMaxAgeDays: 30, twoFactorRoles: ['ADMIN', 'NOPE', 'GONE'] }, roles)).toEqual([
      { field: 'passwordMinLength', message: 'Shortest password: a whole number from 8 to 64.' },
      { field: 'idleMinutes', message: 'Sign out after no activity: a whole number from 5 to 480.' },
      { field: 'linkMinutes', message: 'Reset and set-password links last: a whole number from 10 to 1440.' },
      { field: 'passwordMaxAgeDays', message: 'Pick never, 90, 180 or 365 days.' },
      { field: 'twoFactorRoles', message: 'NOPE, GONE are not roles.' },
    ]);
    expect(settingsErrors({ ...SIGN_IN_DEFAULTS, twoFactorRoles: ['NOPE'] }, roles)[0]!.message).toBe('NOPE is not a role.');
  });

  it('asks for a new password only when a maximum age is set and passed (SDD 10.2: no forced rotation by default)', () => {
    const now = new Date('2026-10-15T08:00:00Z');
    const created = new Date('2026-01-01T00:00:00Z');
    expect(passwordChangeDue(null, created, null, now)).toBe(false);
    expect(passwordChangeDue(null, created, 90, now)).toBe(true); // never changed: counted from when the account was made
    expect(passwordChangeDue(new Date('2026-08-01T00:00:00Z'), created, 90, now)).toBe(false);
    expect(passwordChangeDue(new Date('2026-07-01T00:00:00Z'), created, 90, now)).toBe(true);
  });
});
