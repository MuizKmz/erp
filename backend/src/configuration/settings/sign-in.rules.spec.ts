import { readSignInSettings, SIGN_IN_DEFAULTS, signInKey } from './sign-in.rules';

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
});
