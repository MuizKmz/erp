/**
 * A12 · Security log (NFR-SEC-012; choice 15): how each kind of event reads on the screen. Pure. The log itself is
 * append only: nothing in the application changes or deletes a row (rule 9).
 */
import { SECURITY_EVENT as E } from '../configuration.constants';

/** Chip colour, as the other lists use them: done green, pending amber, cancelled red, draft grey. */
export type ChipGroup = 'done' | 'pending' | 'cancelled' | 'draft';

export const SECURITY_KINDS: Record<string, { label: string; group: ChipGroup }> = {
  [E.SIGNED_IN]: { label: 'Signed in', group: 'done' },
  [E.SIGN_IN_FAILED]: { label: 'Sign-in failed', group: 'pending' },
  [E.LOCKED_OUT]: { label: 'Account locked', group: 'cancelled' },
  [E.SIGNED_OUT]: { label: 'Signed out', group: 'draft' },
  [E.SESSION_ENDED]: { label: 'Session ended', group: 'draft' },
  [E.TOKEN_REUSED]: { label: 'Old token used', group: 'cancelled' },
  [E.SESSION_REVOKED]: { label: 'Session revoked', group: 'draft' },
  [E.PASSWORD_CHANGED]: { label: 'Password changed', group: 'draft' },
  [E.PASSWORD_RESET]: { label: 'Password reset', group: 'draft' },
  [E.PASSWORD_SET]: { label: 'Password set', group: 'draft' },
  [E.RESET_REQUESTED]: { label: 'Reset asked for', group: 'draft' },
  [E.LINK_SENT]: { label: 'Reset link sent', group: 'draft' },
  [E.TWO_FACTOR_ON]: { label: 'Two-factor on', group: 'done' },
  [E.TWO_FACTOR_OFF]: { label: 'Two-factor off', group: 'pending' },
  [E.TWO_FACTOR_RESET]: { label: 'Two-factor reset', group: 'pending' },
  [E.RECOVERY_CODE_USED]: { label: 'Recovery code used', group: 'pending' },
  [E.DEMO_CODE_USED]: { label: 'Demo code used', group: 'pending' },
  [E.UNLOCKED]: { label: 'Unlocked', group: 'draft' },
  [E.SETTINGS_CHANGED]: { label: 'Settings changed', group: 'draft' },
  [E.USER_CREATED]: { label: 'User added', group: 'draft' },
  [E.ROLES_CHANGED]: { label: 'Roles changed', group: 'draft' },
  [E.USER_DEACTIVATED]: { label: 'User deactivated', group: 'pending' },
  [E.USER_ACTIVATED]: { label: 'User activated', group: 'draft' },
  [E.ROLE_CHANGED]: { label: 'Role changed', group: 'draft' },
};

export function kindLabel(kind: string): { label: string; group: ChipGroup } {
  return SECURITY_KINDS[kind] ?? { label: kind, group: 'draft' };
}

/** The period filter on A12 and A13: "Last 7 days" by default. */
export const PERIODS = { day: 1, week: 7, month: 30, year: 365 } as const;
export type Period = keyof typeof PERIODS | 'all';

export function periodStart(period: Period | undefined, now: Date): Date | null {
  const days = PERIODS[(period ?? 'week') as keyof typeof PERIODS];
  return days ? new Date(now.getTime() - days * 86_400_000) : null;
}

/** "Lim Mei Ying signed in on Chrome on Windows · 10.0.4.21": the sentence, then where it came from. */
export function securityDetail(message: string, ipAddress: string | null): string {
  const ip = ipAddress?.replace(/^::ffff:/, '');
  return ip ? `${message} · ${ip}` : message;
}

/** A CSV cell, quoted so commas, quotes and line breaks survive a spreadsheet. */
export function csvCell(value: string | null | undefined): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`;
}
