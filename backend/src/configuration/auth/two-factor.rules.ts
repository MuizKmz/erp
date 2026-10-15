/**
 * Two-factor sign-in (A03; SRS FR-SEC-061, NFR-SEC-009; rule 8): TOTP from an authenticator app, 8 single-use recovery
 * codes, required for the roles the sign-in settings name. Pure; the service does the crypto.
 */

export const RECOVERY_CODES = 8;
export const ISSUER = 'Zora Pro ERP';

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type into the app. */
export function groupedKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** "ABCD-EFGH": eight characters a person can read out, without 0/O and 1/I/L. */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function recoveryCodeFrom(bytes: Uint8Array): string {
  const chars = [...bytes.slice(0, 8)].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** What the user typed, made comparable: "abcd efgh" → "ABCD-EFGH". */
export function normalizeRecoveryCode(typed: string): string | null {
  const plain = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : null;
}

/** Six digits from the app, spaces allowed: "482 913". */
export function totpCode(typed: string): string | null {
  const digits = typed.replace(/\s/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Required when any role the user holds today is one the settings name (choice 9). */
export function twoFactorRequired(roles: readonly string[], requiredRoles: readonly string[]): boolean {
  return roles.some((r) => requiredRoles.includes(r));
}

/** The A03 set-up line: "Your role (Administrator) handles admin and finance work, so …"; the sign-in settings say which roles. */
export function setupReason(roleNames: readonly string[]): string {
  const which = roleNames.length === 1 ? `Your role (${roleNames[0]}) handles` : `Your roles (${roleNames.join(', ')}) handle`;
  return `${which} admin and finance work, so a code from your phone is needed at each sign-in.`;
}
