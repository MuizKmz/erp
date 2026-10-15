/**
 * What the access token says (AUTH_MODE=jwt): user, tenant, session and active branch (SDD 10.2). Short-lived; the
 * session behind it is checked on every request, so signing out, revoking or deactivating takes effect at once.
 */
export interface AccessClaims {
  /** user id */
  sub: string;
  /** user code, to look the user up the same way the dev guard does */
  code: string;
  /** tenant id */
  tid: string;
  /** session id */
  sid: string;
  /** active branch code */
  br: string;
}

/** Access tokens carry this audience; anything signed for another purpose (a two-factor step) is refused as one. */
export const ACCESS_AUDIENCE = 'zora-access';

/** True when every claim is there and a string: a token signed for something else cannot pass as an access token. */
export function isAccessClaims(value: unknown): value is AccessClaims {
  const c = value as Record<string, unknown> | null;
  return !!c && ['sub', 'code', 'tid', 'sid', 'br'].every((k) => typeof c[k] === 'string' && (c[k] as string).length > 0);
}

export type GateAnswer = { ok: true } | { ok: false; code: string; message: string };

/**
 * Checks that the session behind an access token is still open, and notes the activity (idle time-out, FR-SEC-065).
 * Configuration implements it, because it owns sys_session; the platform's guard only asks.
 */
export interface SessionGate {
  pass(claims: AccessClaims): Promise<GateAnswer>;
}

export const SESSION_GATE = Symbol('SESSION_GATE');
