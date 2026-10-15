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

export type GateAnswer = { ok: true } | { ok: false; code: string; message: string };

/**
 * Checks that the session behind an access token is still open, and notes the activity (idle time-out, FR-SEC-065).
 * Configuration implements it, because it owns sys_session; the platform's guard only asks.
 */
export interface SessionGate {
  pass(claims: AccessClaims): Promise<GateAnswer>;
}

export const SESSION_GATE = Symbol('SESSION_GATE');
