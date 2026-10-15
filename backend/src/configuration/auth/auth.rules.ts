/**
 * Sign-in (A02; CLAUDE.md → Phase 4 · Sign-in, rule 7). Pure functions for who is signing in, lockout, sessions and
 * devices. The service does the hashing and the writing. Times are real times, not the demo's business date.
 */

/** The same answer for an unknown user, a wrong password, an inactive account and one with no password yet. */
export const WRONG_CREDENTIALS = 'The email or user code and the password do not match.';

/** Typed into "Email or user code" (choice 11): an @ means an email, matched in lower case; otherwise a user code. */
export function identifierOf(raw: string): { email: string } | { code: string } {
  const value = raw.trim();
  return value.includes('@') ? { email: value.toLowerCase() } : { code: value.toUpperCase() };
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}

/** One more wrong password (FR-SEC-062): the count starts again once a lock has run out; the last allowed one locks. */
export function afterWrongPassword(
  failedSignIns: number,
  lockedUntil: Date | null,
  settings: { lockoutAttempts: number; lockoutMinutes: number },
  now: Date,
): { failedSignIns: number; lockedUntil: Date | null; lockedNow: boolean } {
  const start = lockedUntil && lockedUntil.getTime() <= now.getTime() ? 0 : failedSignIns;
  const failed = start + 1;
  if (failed >= settings.lockoutAttempts) {
    return { failedSignIns: failed, lockedUntil: new Date(now.getTime() + settings.lockoutMinutes * 60_000), lockedNow: true };
  }
  return { failedSignIns: failed, lockedUntil: null, lockedNow: false };
}

/** "10:30" in Malaysia time, for the lock message. */
export function klTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

export function accountLockedMessage(until: Date): string {
  return `This account is locked after too many wrong passwords. Try again after ${klTime(until)}, or ask an administrator.`;
}

export function addressLockedMessage(minutes: number): string {
  return `Too many wrong passwords from this network. Try again in ${minutes} minutes.`;
}

/** Failed attempts from one network address within the lock time also lock that address (FR-SEC-062). */
export function addressLocked(failuresInWindow: number, lockoutAttempts: number): boolean {
  return failuresInWindow >= lockoutAttempts;
}

/** A session ends after the idle time without any request (FR-SEC-065). */
export function idleExpired(lastActivityAt: Date, now: Date, idleMinutes: number): boolean {
  return now.getTime() - lastActivityAt.getTime() > idleMinutes * 60_000;
}

/** Note the activity at most once a minute, so a busy screen does not write on every request. */
export function activityWorthNoting(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() >= 60_000;
}

/** "Chrome on Windows", for the sessions list (A11) and the security log. */
export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  if (!browser && !os) return 'Unknown device';
  return [browser ?? 'A browser', os].filter((p) => p).join(' on ');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The refresh token is "<session id>.<secret>": the id finds the session, so a reused old secret ends that session. */
export function splitRefreshToken(raw: string | undefined | null): { sessionId: string; secret: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const sessionId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  return UUID.test(sessionId) && secret.length >= 32 ? { sessionId, secret } : null;
}

/** Why a session can no longer be used, or null when it can. */
export function sessionProblem(
  session: { revokedAt: Date | null; expiresAt: Date; lastActivityAt: Date },
  now: Date,
  idleMinutes: number,
): { reason: 'REVOKED' | 'EXPIRED' | 'IDLE'; message: string } | null {
  if (session.revokedAt) return { reason: 'REVOKED', message: 'You were signed out. Sign in again.' };
  if (session.expiresAt.getTime() <= now.getTime()) return { reason: 'EXPIRED', message: 'Your sign-in on this device has run out. Sign in again.' };
  if (idleExpired(session.lastActivityAt, now, idleMinutes)) return { reason: 'IDLE', message: `Signed out after ${idleMinutes} minutes without activity. Sign in again.` };
  return null;
}
