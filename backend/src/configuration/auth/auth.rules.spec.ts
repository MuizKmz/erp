import {
  accountLockedMessage,
  activityWorthNoting,
  addressLocked,
  addressLockedMessage,
  afterWrongPassword,
  deviceName,
  identifierOf,
  idleExpired,
  isLocked,
  klTime,
  sessionProblem,
  splitRefreshToken,
} from './auth.rules';

const at = (iso: string) => new Date(iso);
const settings = { lockoutAttempts: 5, lockoutMinutes: 15 };

describe('sign-in', () => {
  it('reads an email in lower case and a user code in capitals (choice 11)', () => {
    expect(identifierOf('  Aina@Warehouse.com ')).toEqual({ email: 'aina@warehouse.com' });
    expect(identifierOf('ar')).toEqual({ code: 'AR' });
  });

  it('locks the account on the fifth wrong password for 15 minutes, and counts again once a lock has run out (FR-SEC-062)', () => {
    const now = at('2026-10-15T02:00:00Z');
    expect(afterWrongPassword(3, null, settings, now)).toEqual({ failedSignIns: 4, lockedUntil: null, lockedNow: false });
    expect(afterWrongPassword(4, null, settings, now)).toEqual({ failedSignIns: 5, lockedUntil: at('2026-10-15T02:15:00Z'), lockedNow: true });
    expect(afterWrongPassword(5, at('2026-10-15T01:50:00Z'), settings, now)).toEqual({ failedSignIns: 1, lockedUntil: null, lockedNow: false });
    expect(isLocked(at('2026-10-15T02:15:00Z'), now)).toBe(true);
    expect(isLocked(at('2026-10-15T01:59:00Z'), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });

  it('locks a network address after the same number of failures, and says when to try again in Malaysia time', () => {
    expect(addressLocked(4, 5)).toBe(false);
    expect(addressLocked(5, 5)).toBe(true);
    expect(klTime(at('2026-10-15T02:30:00Z'))).toBe('10:30');
    expect(accountLockedMessage(at('2026-10-15T02:30:00Z'))).toBe('This account is locked after too many wrong passwords. Try again after 10:30, or ask an administrator.');
    expect(addressLockedMessage(15)).toBe('Too many wrong passwords from this network. Try again in 15 minutes.');
  });

  it('ends a session after 30 minutes without a request, and notes activity at most once a minute (FR-SEC-065)', () => {
    const last = at('2026-10-15T02:00:00Z');
    expect(idleExpired(last, at('2026-10-15T02:30:00Z'), 30)).toBe(false);
    expect(idleExpired(last, at('2026-10-15T02:30:01Z'), 30)).toBe(true);
    expect(activityWorthNoting(last, at('2026-10-15T02:00:59Z'))).toBe(false);
    expect(activityWorthNoting(last, at('2026-10-15T02:01:00Z'))).toBe(true);
    const open = { revokedAt: null, expiresAt: at('2026-11-14T02:00:00Z'), lastActivityAt: last };
    expect(sessionProblem(open, at('2026-10-15T02:10:00Z'), 30)).toBeNull();
    expect(sessionProblem(open, at('2026-10-15T03:00:00Z'), 30)).toEqual({ reason: 'IDLE', message: 'Signed out after 30 minutes without activity. Sign in again.' });
    expect(sessionProblem({ ...open, revokedAt: last }, last, 30)?.reason).toBe('REVOKED');
    expect(sessionProblem(open, at('2026-11-14T02:00:00Z'), 99_999)?.reason).toBe('EXPIRED');
  });

  it('splits the refresh token into the session and its secret, refusing anything else', () => {
    const secret = 'x'.repeat(43);
    expect(splitRefreshToken(`5f0b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c.${secret}`)).toEqual({ sessionId: '5f0b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c', secret });
    expect(splitRefreshToken('not-a-session.secret')).toBeNull();
    expect(splitRefreshToken(`5f0b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c.short`)).toBeNull();
    expect(splitRefreshToken(undefined)).toBeNull();
  });

  it('names the device from the browser', () => {
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge on Windows');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceName('node')).toBe('Unknown device');
    expect(deviceName(null)).toBe('Unknown device');
  });
});
