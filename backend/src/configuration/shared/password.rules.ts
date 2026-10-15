/**
 * A new password (CLAUDE.md → Phase 4 · Sign-in, rule 7): long enough, not a common one, not the user's own name or
 * code, and no forced rotation (SDD 10.2). Pure; the service hashes with argon2id.
 */
import { COMMON_PASSWORDS } from './common-passwords';

export interface PasswordPolicy {
  passwordMinLength: number;
  refuseCommonPasswords: boolean;
}

/** "Password123!" → "password": common words hide behind trailing digits and symbols. */
function core(password: string): string {
  return password.toLowerCase().replace(/[\d\W_]+$/u, '');
}

/** Why the password cannot be used, or null. */
export function passwordProblem(password: string, policy: PasswordPolicy, user: { code: string; name: string; email: string }): string | null {
  if (password.length < policy.passwordMinLength) return `Use at least ${policy.passwordMinLength} characters.`;
  if (password.length > 200) return 'Use at most 200 characters.';
  if (policy.refuseCommonPasswords) {
    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(core(password)) || /^(.)\1+$/u.test(password)) return 'That password is too common. Pick something harder to guess.';
  }
  const lower = password.toLowerCase();
  const own = [user.code, user.email.split('@')[0] ?? '', ...user.name.split(/\s+/)].map((p) => p.toLowerCase()).filter((p) => p.length >= 3);
  if (own.some((p) => lower.includes(p))) return 'Do not use your name, user code or email in your password.';
  return null;
}

/** The hint under the password fields: "At least 10 characters. Common passwords are refused." */
export function passwordHint(policy: PasswordPolicy): string {
  return `At least ${policy.passwordMinLength} characters.${policy.refuseCommonPasswords ? ' Common passwords are refused.' : ''}`;
}
