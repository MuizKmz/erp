/**
 * Environment variables, checked once at start-up so a typo fails loudly instead of at the first request.
 * See backend/.env.example.
 */
export interface Env {
  DATABASE_URL: string;
  /** dev: the x-dev-user header picks the user (no password). jwt: sign-in with a password (Phase 4 · A5). */
  AUTH_MODE: 'dev' | 'jwt';
  /** Signs the access tokens. Required with AUTH_MODE=jwt, at least 32 characters. */
  JWT_SECRET: string | null;
  /** Local demo only: six-digit two-factor shortcut for the seeded ADM account. Never active in production. */
  DEMO_ADMIN_2FA_BYPASS_CODE: string | null;
  /** Send the refresh cookie only over HTTPS. Off for localhost. */
  COOKIE_SECURE: boolean;
  DEV_DEFAULT_USER: string;
  /** The tenant this server serves, in both modes (one tenant per server for now, SDD ADR-05). */
  DEV_TENANT_CODE: string;
  PORT: number;
  CORS_ORIGIN: string;
  /** Where the web app runs; used for links in emails (supplier reply links). */
  APP_URL: string;
  UPLOAD_DIR: string;
  UPLOAD_MAX_BYTES: number;
  OUTBOX_DISPATCH: boolean;
  OUTBOX_INTERVAL_MS: number;
  /** Dev only: pretend today is this date (YYYY-MM-DD) so screens match the mockups (29 Sep 2026). */
  DEV_TODAY: string | null;
}

function toInt(name: string, value: unknown, fallback: number, problems: string[]): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    problems.push(`${name} must be a positive whole number (got "${String(value)}")`);
    return fallback;
  }
  return n;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];
  const str = (name: string, fallback?: string): string => {
    const value = raw[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is required`);
    return '';
  };

  const authMode = str('AUTH_MODE', 'dev');
  if (authMode !== 'dev' && authMode !== 'jwt') {
    problems.push(`AUTH_MODE must be "dev" or "jwt" (got "${authMode}")`);
  }
  const jwtSecret = typeof raw.JWT_SECRET === 'string' && raw.JWT_SECRET.trim() !== '' ? raw.JWT_SECRET.trim() : null;
  if (authMode === 'jwt' && (!jwtSecret || jwtSecret.length < 32)) {
    problems.push('JWT_SECRET must be set to at least 32 random characters when AUTH_MODE=jwt');
  }
  const demoAdminBypassCode = typeof raw.DEMO_ADMIN_2FA_BYPASS_CODE === 'string' && raw.DEMO_ADMIN_2FA_BYPASS_CODE.trim() !== '' ? raw.DEMO_ADMIN_2FA_BYPASS_CODE.trim() : null;
  if (demoAdminBypassCode && !/^\d{6}$/.test(demoAdminBypassCode)) {
    problems.push('DEMO_ADMIN_2FA_BYPASS_CODE must be exactly six digits');
  }
  const cookieSecure = str('COOKIE_SECURE', 'off').toLowerCase();
  if (!['on', 'off'].includes(cookieSecure)) {
    problems.push(`COOKIE_SECURE must be "on" or "off" (got "${cookieSecure}")`);
  }

  const dispatch = str('OUTBOX_DISPATCH', 'on').toLowerCase();
  if (!['on', 'off'].includes(dispatch)) {
    problems.push(`OUTBOX_DISPATCH must be "on" or "off" (got "${dispatch}")`);
  }

  const devToday = typeof raw.DEV_TODAY === 'string' && raw.DEV_TODAY.trim() !== '' ? raw.DEV_TODAY.trim() : null;
  if (devToday && !/^\d{4}-\d{2}-\d{2}$/.test(devToday)) {
    problems.push(`DEV_TODAY must look like 2026-09-29 (got "${devToday}")`);
  }

  const env: Env = {
    DATABASE_URL: str('DATABASE_URL'),
    AUTH_MODE: authMode === 'jwt' ? 'jwt' : 'dev',
    JWT_SECRET: jwtSecret,
    DEMO_ADMIN_2FA_BYPASS_CODE: demoAdminBypassCode,
    COOKIE_SECURE: cookieSecure === 'on',
    DEV_DEFAULT_USER: str('DEV_DEFAULT_USER', 'LMY').toUpperCase(),
    DEV_TENANT_CODE: str('DEV_TENANT_CODE', 'CLB'),
    PORT: toInt('PORT', raw.PORT, 3000, problems),
    CORS_ORIGIN: str('CORS_ORIGIN', 'http://localhost:5173'),
    APP_URL: str('APP_URL', 'http://localhost:5173').replace(/\/+$/, ''),
    UPLOAD_DIR: str('UPLOAD_DIR', 'uploads'),
    UPLOAD_MAX_BYTES: toInt('UPLOAD_MAX_BYTES', raw.UPLOAD_MAX_BYTES, 10 * 1024 * 1024, problems),
    OUTBOX_DISPATCH: dispatch === 'on',
    OUTBOX_INTERVAL_MS: toInt('OUTBOX_INTERVAL_MS', raw.OUTBOX_INTERVAL_MS, 5000, problems),
    DEV_TODAY: devToday,
  };

  if (problems.length) {
    throw new Error(`Invalid backend/.env:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}
