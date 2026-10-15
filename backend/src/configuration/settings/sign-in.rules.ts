/** Sign-in settings (A14, CONFIG_SEED_DATA.md → Sign-in settings). Each is one sys_setting row: sign_in.<name>. */
export interface SignInSettings {
  /** SRS FR-SEC-060, SDD 10.2 */
  passwordMinLength: number;
  refuseCommonPasswords: boolean;
  /** Empty = never ask to change (SDD 10.2: no forced rotation). */
  passwordMaxAgeDays: number | null;
  /** SRS FR-SEC-062: wrong passwords in a row lock the account. */
  lockoutAttempts: number;
  lockoutMinutes: number;
  /** Count failures per network address too (A14 "Count per"); off = per account only, for a shared office address. */
  lockoutPerAddress: boolean;
  /** SRS FR-SEC-065 */
  idleMinutes: number;
  /** How long a device stays signed in (rotating refresh token). */
  refreshDays: number;
  accessMinutes: number;
  /** Reset and set-password links (FR-SEC-063). */
  linkMinutes: number;
  /** Roles whose holders must use two-factor (FR-SEC-061, choice 9). */
  twoFactorRoles: string[];
  /** Email a set-password link to a new user (FR-SEC-064, choice 10). */
  emailSetPasswordLink: boolean;
}

export const SIGN_IN_DEFAULTS: Readonly<SignInSettings> = {
  passwordMinLength: 10,
  refuseCommonPasswords: true,
  passwordMaxAgeDays: null,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
  lockoutPerAddress: true,
  idleMinutes: 30,
  refreshDays: 30,
  accessMinutes: 15,
  linkMinutes: 60,
  twoFactorRoles: ['ADMIN', 'MASTER_DATA_ADMIN', 'FINANCE_DIRECTOR', 'FINANCE_MANAGER'],
  emailSetPasswordLink: true,
};

export const SIGN_IN_PREFIX = 'sign_in.';

export const signInKey = (name: keyof SignInSettings) => `${SIGN_IN_PREFIX}${name}`;

/** The settings from their rows; a missing or malformed row falls back to its default. */
export function readSignInSettings(rows: { key: string; value: unknown }[]): SignInSettings {
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...SIGN_IN_DEFAULTS, twoFactorRoles: [...SIGN_IN_DEFAULTS.twoFactorRoles] } as SignInSettings;
  for (const name of Object.keys(SIGN_IN_DEFAULTS) as (keyof SignInSettings)[]) {
    const value = stored.get(signInKey(name));
    const fallback = SIGN_IN_DEFAULTS[name];
    const ok =
      value === undefined
        ? false
        : Array.isArray(fallback)
          ? Array.isArray(value) && value.every((v) => typeof v === 'string')
          : fallback === null
            ? value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0)
            : typeof value === typeof fallback;
    if (ok) (out as unknown as Record<string, unknown>)[name] = value;
  }
  return out;
}

/** What the A14 form may set: whole numbers in sensible ranges, and two-factor roles that exist. */
export const SETTING_LIMITS: Record<'passwordMinLength' | 'lockoutAttempts' | 'lockoutMinutes' | 'idleMinutes' | 'refreshDays' | 'linkMinutes', [number, number, string]> = {
  passwordMinLength: [8, 64, 'Shortest password'],
  lockoutAttempts: [3, 20, 'Lock the account after'],
  lockoutMinutes: [1, 1440, 'Lock for'],
  idleMinutes: [5, 480, 'Sign out after no activity'],
  refreshDays: [1, 90, 'A device stays signed in'],
  linkMinutes: [10, 1440, 'Reset and set-password links last'],
};

/** "Ask to change regularly": never (SDD 10.2) or every so many days. */
export const PASSWORD_AGE_CHOICES = [null, 90, 180, 365] as const;

export function settingsErrors(s: SignInSettings, roleCodes: ReadonlySet<string>): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  for (const [field, [min, max, label]] of Object.entries(SETTING_LIMITS)) {
    const value = s[field as keyof typeof SETTING_LIMITS];
    if (!Number.isInteger(value) || value < min || value > max) errors.push({ field, message: `${label}: a whole number from ${min} to ${max}.` });
  }
  if (!(PASSWORD_AGE_CHOICES as readonly (number | null)[]).includes(s.passwordMaxAgeDays)) errors.push({ field: 'passwordMaxAgeDays', message: 'Pick never, 90, 180 or 365 days.' });
  const unknown = s.twoFactorRoles.filter((r) => !roleCodes.has(r));
  if (unknown.length) errors.push({ field: 'twoFactorRoles', message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a role' : 'are not roles'}.` });
  return errors;
}

export const SETTING_LABELS: Record<keyof SignInSettings, string> = {
  passwordMinLength: 'Shortest password',
  refuseCommonPasswords: 'Common passwords refused',
  passwordMaxAgeDays: 'Ask to change every (days)',
  lockoutAttempts: 'Lock after wrong passwords',
  lockoutMinutes: 'Lock for (minutes)',
  lockoutPerAddress: 'Count per network address too',
  idleMinutes: 'Sign out after no activity (minutes)',
  refreshDays: 'A device stays signed in (days)',
  accessMinutes: 'Access token (minutes)',
  linkMinutes: 'Links last (minutes)',
  twoFactorRoles: 'Two-factor required for',
  emailSetPasswordLink: 'Email a set-password link to new users',
};

/** Whether the password is old enough to ask for a new one (never, when the setting is empty). */
export function passwordChangeDue(changedAt: Date | null, createdAt: Date, maxAgeDays: number | null, now: Date): boolean {
  if (maxAgeDays === null) return false;
  return now.getTime() - (changedAt ?? createdAt).getTime() > maxAgeDays * 86_400_000;
}
