/** Sign-in settings (A14, CONFIG_SEED_DATA.md → Sign-in settings). Each is one sys_setting row: sign_in.<name>. */
export interface SignInSettings {
  /** SRS FR-SEC-060, SDD 10.2 */
  passwordMinLength: number;
  refuseCommonPasswords: boolean;
  /** Empty = never ask to change (SDD 10.2: no forced rotation). */
  passwordMaxAgeDays: number | null;
  /** SRS FR-SEC-062: wrong passwords in a row, counted per account and per network address. */
  lockoutAttempts: number;
  lockoutMinutes: number;
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
