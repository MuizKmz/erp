import { validateEnv } from './env';

const SECRET = '0123456789abcdef0123456789abcdef';
const base = { DATABASE_URL: 'mysql://x', AUTH_MODE: 'dev' };
const live = { DATABASE_URL: 'mysql://x', NODE_ENV: 'production', AUTH_MODE: 'jwt', JWT_SECRET: SECRET, COOKIE_SECURE: 'on', DEV_TENANT_CODE: 'ACME' };

describe('validateEnv', () => {
  it('accepts dev mode outside production', () => {
    expect(validateEnv({ ...base, DEV_TODAY: '2026-09-29' }).AUTH_MODE).toBe('dev');
  });

  it('never falls back to dev mode when AUTH_MODE is missing', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow('AUTH_MODE is required');
  });

  it('accepts a properly set live server', () => {
    expect(validateEnv(live)).toMatchObject({ AUTH_MODE: 'jwt', COOKIE_SECURE: true, DEV_TENANT_CODE: 'ACME', DEV_TODAY: null });
  });

  it.each([
    ['dev mode', { AUTH_MODE: 'dev' }, 'AUTH_MODE must be "jwt"'],
    ['plain cookies', { COOKIE_SECURE: 'off' }, 'COOKIE_SECURE must be "on"'],
    ['a pretend date', { DEV_TODAY: '2026-09-29' }, 'DEV_TODAY must be empty'],
    ['the demo two-factor code', { DEMO_ADMIN_2FA_BYPASS_CODE: '123456' }, 'DEMO_ADMIN_2FA_BYPASS_CODE must be empty'],
    ['no tenant of its own', { DEV_TENANT_CODE: '' }, 'DEV_TENANT_CODE must be set'],
  ])('refuses a live server with %s', (_name, change, message) => {
    expect(() => validateEnv({ ...live, ...change })).toThrow(message);
  });
});
