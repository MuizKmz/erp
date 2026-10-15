// Sign-in mode for this file only: set before the app module is loaded (it is required inside beforeAll).
process.env.AUTH_MODE = 'jwt';
process.env.JWT_SECRET = 'e2e-only-secret-0123456789abcdef0123456789abcdef';
process.env.DEMO_ADMIN_2FA_BYPASS_CODE = '123456';

import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { DiscoveryService as Discovery, MetadataScanner as Scanner } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { TENANT_ID } from '../prisma/seed/util';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/platform/context/context.decorators';
import type { Api } from './e2e-helpers';

interface Answer<T = any> {
  status: number;
  body: T;
  cookie: string | null;
}

/**
 * Sign-in (CLAUDE.md → Phase 4 · A5, A6), against the API with AUTH_MODE=jwt: passwords, rotating refresh tokens and
 * their reuse, branch switch, sign-out, idle time-out, lockout, every endpoint without a token (401) and without the
 * permission (403); two-factor, password links, My account and the sign-in settings. The other suites run in dev mode.
 */
describe('Sign-in (end to end, AUTH_MODE=jwt)', () => {
  let api: Api;
  let base = '';
  let helpers: typeof import('./e2e-helpers');

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    helpers = require('./e2e-helpers');
    helpers.reseed();
    api = await helpers.startApi();
    base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    helpers?.reseed();
  }, 300_000);

  async function call<T = any>(method: string, route: string, opts: { token?: string; cookie?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.cookie = opts.cookie;
    const res = await fetch(`${base}/${route}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const setCookie = res.headers.get('set-cookie');
    const cookie = setCookie?.match(/zora_refresh=([^;]*)/)?.[1];
    return { status: res.status, body: (await res.json().catch(() => null)) as T, cookie: cookie ? `zora_refresh=${cookie}` : null };
  }
  const signIn = (identifier: string, password = 'Zora-demo-2026') => call('POST', 'auth/sign-in', { body: { identifier, password } });

  /** Two-factor secrets set up in this file, by user code, so later sign-ins can make a code like the phone would. */
  const secrets = new Map<string, string>();
  /** Sign-in to the end: sets up two-factor when a role requires it (A03), or types the code from the "app". */
  async function signInFully(identifier: string, password = 'Zora-demo-2026'): Promise<Answer> {
    const first = await signIn(identifier, password);
    if (first.body?.step === 'TWO_FACTOR_SETUP') {
      const secret = (first.body.setup.key as string).replace(/ /g, '');
      secrets.set(identifier, secret);
      return call('POST', 'auth/two-factor/setup', { body: { ticket: first.body.ticket, code: authenticator.generate(secret) } });
    }
    if (first.body?.step === 'TWO_FACTOR') return call('POST', 'auth/two-factor', { body: { ticket: first.body.ticket, code: authenticator.generate(secrets.get(identifier)!) } });
    return first;
  }
  /** The newest email of a kind for a user, and the link token in it. */
  async function mailed(userCode: string, templateKey: string) {
    const user = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: userCode } });
    const email = await api.prisma.sysEmailLog.findFirstOrThrow({ where: { tenantId: TENANT_ID, entityId: user.id, templateKey }, orderBy: { createdAt: 'desc' } });
    return { email, token: email.body.match(/token=([A-Za-z0-9_-]+)/)![1]! };
  }
  const clearAttempts = () => api.prisma.sysLoginAttempt.deleteMany({ where: { tenantId: TENANT_ID } });

  it('says it runs in sign-in mode, and hides the dev user list', async () => {
    expect((await call('GET', 'auth/mode')).body).toEqual({ mode: 'jwt', tenantName: 'CLB Groups', signIn: { lockoutAttempts: 5, lockoutMinutes: 15, refreshDays: 30, idleMinutes: 30 } });
    expect((await call('GET', 'dev/users')).status).toBe(404);
  });

  it('signs in with a user code or an email, and gives the same answer for a wrong password and an unknown user', async () => {
    const wrong = await signIn('ar', 'not-the-password');
    const unknown = await signIn('nobody@warehouse.com');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ code: 'WRONG_CREDENTIALS', message: 'The email or user code and the password do not match.' });
    expect(unknown.body).toEqual(wrong.body);

    const ok = await signIn('Aina@Warehouse.com');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ branchCode: 'HQ', accessToken: expect.any(String) });
    expect(ok.cookie).toMatch(/^zora_refresh=[0-9a-f-]{36}\./);
    const me = await call('GET', 'me', { token: ok.body.accessToken });
    expect(me.body.user.code).toBe('AR');
    expect((await call('GET', 'me')).status).toBe(401);
    const attempts = await api.prisma.sysLoginAttempt.groupBy({ by: ['success'], where: { tenantId: TENANT_ID }, _count: { _all: true } });
    expect(Object.fromEntries(attempts.map((a) => [String(a.success), a._count._all]))).toEqual({ false: 2, true: 1 });
    const user = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'AR' } });
    expect(user.failedSignIns).toBe(0);
    expect(user.lastSignInAt).not.toBeNull();
  });

  it('rotates the refresh token, and ends the whole session when an old one comes back (SDD 10.2)', async () => {
    const first = await signIn('LMY');
    const second = await call('POST', 'auth/refresh', { cookie: first.cookie });
    expect(second.status).toBe(200);
    expect(second.cookie).not.toBe(first.cookie);
    const third = await call('POST', 'auth/refresh', { cookie: second.cookie });
    expect(third.status).toBe(200);

    const replay = await call('POST', 'auth/refresh', { cookie: first.cookie });
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe('You were signed out for safety. Sign in again.');
    expect((await call('GET', 'me', { token: third.body.accessToken })).status).toBe(401);
    const logged = await api.prisma.sysSecurityEvent.findFirstOrThrow({ where: { tenantId: TENANT_ID, kind: 'TOKEN_REUSED' } });
    expect(logged.message).toBe('An old sign-in token for Lim Mei Ying was used again, so that session was ended');
  });

  it('switches branch with a new token only; the x-branch header does nothing in sign-in mode (FR-SEC-021)', async () => {
    const fo = await signIn('FO');
    expect((await call('GET', 'me', { token: fo.body.accessToken, headers: { 'x-branch': 'PNG' } })).body.branchCode).toBe('HQ');
    const png = await call('POST', 'auth/switch-branch', { token: fo.body.accessToken, body: { branchCode: 'PNG' } });
    expect(png.status).toBe(200);
    expect((await call('GET', 'me', { token: png.body.accessToken })).body.branchCode).toBe('PNG');
    const refreshed = await call('POST', 'auth/refresh', { cookie: fo.cookie });
    expect(refreshed.body.branchCode).toBe('PNG');
    const notTheirs = await call('POST', 'auth/switch-branch', { token: png.body.accessToken, body: { branchCode: 'KL' } });
    expect(notTheirs.status).toBe(403);
  });

  it('signs out, ends an idle session after 30 minutes, and ends the sessions of a deactivated user', async () => {
    const na = await signIn('NA');
    const out = await call('POST', 'auth/sign-out', { cookie: na.cookie });
    expect(out.status).toBe(200);
    expect((await call('GET', 'me', { token: na.body.accessToken })).body).toEqual({ code: 'SIGNED_OUT', message: 'You were signed out. Sign in again.' });

    const rah = await signIn('RAH');
    const rahim = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'RAH' } });
    const session = await api.prisma.sysSession.findFirstOrThrow({ where: { tenantId: TENANT_ID, userId: rahim.id, revokedAt: null } });
    await api.prisma.sysSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
    const idle = await call('GET', 'me', { token: rah.body.accessToken });
    expect(idle.status).toBe(401);
    expect(idle.body).toEqual({ code: 'SIGNED_OUT_IDLE', message: 'Signed out after 30 minutes without activity. Sign in again.' });
    expect((await api.prisma.sysSession.findUniqueOrThrow({ where: { id: session.id } })).revokedReason).toBe('IDLE');

    const nur = await signIn('NUR');
    const admin = await signInFully('ADM');
    const nurUser = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'NUR' } });
    const off = await call('POST', `config/users/${nurUser.id}/deactivate`, { token: admin.body.accessToken, body: { version: nurUser.version } });
    expect(off.status).toBe(201);
    expect((await call('GET', 'me', { token: nur.body.accessToken })).status).toBe(401);
    expect((await signIn('NUR')).status).toBe(401);
  });

  describe('every endpoint', () => {
    interface Route {
      method: string;
      path: string;
      isPublic: boolean;
      permissions: string[];
    }
    const PUBLIC = [
      'GET /health',
      'GET /dev/users',
      'GET /auth/mode',
      'POST /auth/sign-in',
      'POST /auth/refresh',
      'POST /auth/sign-out',
      'POST /auth/two-factor',
      'POST /auth/two-factor/setup',
      'POST /auth/forgot',
      'POST /auth/link',
      'POST /auth/reset',
    ];
    /** Signed in, no permission: who you are, the launcher, attachments (checked against their document), branch switch, My account, the dev-only receipt stub. */
    const SIGNED_IN_ONLY = [
      'GET /me',
      'GET /me/modules',
      'POST /attachments',
      'GET /attachments/:id',
      'GET /attachments/:id/download',
      'POST /dev/finance/receipts',
      'POST /auth/switch-branch',
      'GET /account',
      'POST /account/password',
      'DELETE /account/sessions/:id',
      'POST /account/sessions/sign-out-others',
      'POST /account/two-factor/setup',
      'POST /account/two-factor/enable',
      'POST /account/two-factor/disable',
      'POST /account/two-factor/recovery-codes',
    ];

    function routes(): Route[] {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const core = require('@nestjs/core') as typeof import('@nestjs/core');
      const discovery = api.app.get(core.DiscoveryService, { strict: false }) as Discovery;
      const scanner = api.app.get(core.MetadataScanner, { strict: false }) as Scanner;
      const out: Route[] = [];
      for (const { instance, metatype } of discovery.getControllers()) {
        if (!instance || !metatype) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
        for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
          const handler = (instance as Record<string, unknown>)[name] as object;
          const path = Reflect.getMetadata(PATH_METADATA, handler);
          if (path === undefined) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]!;
          out.push({
            method,
            path: `/${base}/${String(path)}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
            isPublic: !!(Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, metatype)),
            permissions: ((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, metatype)) as string[] | undefined) ?? [],
          });
        }
      }
      return out;
    }
    const filled = (path: string) => path.slice(1).replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
    const label = (r: Route) => `${r.method} ${r.path}`;

    it('lets nobody in without signing in, except the public ones (FR-SEC-008, SDD 10.4)', async () => {
      const all = routes();
      expect(all.length).toBeGreaterThan(300);
      expect(all.filter((r) => r.isPublic).map(label).sort()).toEqual([...PUBLIC].sort());
      expect(all.filter((r) => !r.isPublic && !r.permissions.length).map(label).sort()).toEqual([...SIGNED_IN_ONLY].sort());
      const letIn: string[] = [];
      for (const r of all.filter((x) => !x.isPublic)) {
        const res = await call(r.method, filled(r.path), { body: r.method === 'GET' ? undefined : {} });
        if (res.status !== 401) letIn.push(`${label(r)} → ${res.status}`);
      }
      expect(letIn).toEqual([]);
    }, 180_000);

    it('refuses every action to a user whose roles give no permission (403)', async () => {
      const hq = await api.prisma.sysBranch.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'HQ' } });
      const role = await api.prisma.sysRole.create({ data: { tenantId: TENANT_ID, code: 'E2E_NOTHING', name: 'Nothing', createdBy: 'E2E' } });
      const user = await api.prisma.sysUser.create({
        data: { tenantId: TENANT_ID, code: 'E2E_NONE', name: 'No Permissions', email: 'none@warehouse.com', passwordHash: await argon2.hash('Nothing-at-all-2026', { type: argon2.argon2id }), createdBy: 'E2E' },
      });
      await api.prisma.sysUserRole.create({ data: { tenantId: TENANT_ID, userId: user.id, roleId: role.id } });
      await api.prisma.sysUserBranch.create({ data: { tenantId: TENANT_ID, userId: user.id, branchId: hq.id, isDefault: true } });
      const none = await signIn('E2E_NONE', 'Nothing-at-all-2026');
      expect(none.status).toBe(200);

      const letThrough: string[] = [];
      const guarded = routes().filter((r) => r.permissions.length);
      for (const r of guarded) {
        const res = await call(r.method, filled(r.path), { token: none.body.accessToken, body: r.method === 'GET' ? undefined : {} });
        if (res.status !== 403) letThrough.push(`${label(r)} → ${res.status}`);
      }
      expect(guarded.length).toBeGreaterThan(300);
      expect(letThrough).toEqual([]);
    }, 180_000);
  });

  it('locks an account after 5 wrong passwords, and a network address after 5 failures (FR-SEC-062)', async () => {
    await api.prisma.sysLoginAttempt.deleteMany({ where: { tenantId: TENANT_ID } });
    for (let i = 1; i <= 5; i++) expect((await signIn('SIT', `wrong-${i}`)).status).toBe(401);
    const sit = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'SIT' } });
    expect(sit.failedSignIns).toBe(5);
    expect(sit.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await api.prisma.sysSecurityEvent.count({ where: { tenantId: TENANT_ID, kind: 'LOCKED_OUT', userCode: 'SIT' } })).toBe(1);

    const blockedAddress = await signIn('TWL');
    expect(blockedAddress.status).toBe(429);
    expect(blockedAddress.body).toEqual({ code: 'ADDRESS_LOCKED', message: 'Too many wrong passwords from this network. Try again in 15 minutes.' });

    await api.prisma.sysLoginAttempt.deleteMany({ where: { tenantId: TENANT_ID } });
    const lockedAccount = await signIn('SIT');
    expect(lockedAccount.status).toBe(429);
    expect(lockedAccount.body.code).toBe('ACCOUNT_LOCKED');
    expect((await signIn('TWL')).status).toBe(200);
  });

  describe('two-factor, password links, My account and settings (A6)', () => {
    beforeEach(() => clearAttempts());

    it('lets only the explicitly enabled demo Administrator use 123456 instead of scanning an authenticator', async () => {
      // An earlier authorization test signs ADM in fully. Reset just its authenticator state so this test covers the
      // first-time setup screen as well as the code-at-sign-in screen.
      await api.prisma.sysUser.updateMany({
        where: { tenantId: TENANT_ID, code: 'ADM' },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null, recoveryCodes: Prisma.DbNull },
      });
      const admin = await signIn('ADM');
      expect(admin.body).toMatchObject({ step: 'TWO_FACTOR_SETUP', demoBypassCode: '123456' });
      const adminSecret = (admin.body.setup.key as string).replace(/ /g, '');
      secrets.set('ADM', adminSecret);
      expect((await call('POST', 'auth/two-factor/setup', { body: { ticket: admin.body.ticket, code: '123456' } })).status).toBe(200);

      const again = await signIn('ADM');
      expect(again.body).toMatchObject({ step: 'TWO_FACTOR', demoBypassCode: '123456' });
      expect((await call('POST', 'auth/two-factor', { body: { ticket: again.body.ticket, code: '123456' } })).status).toBe(200);

      const other = await signIn('RI');
      expect(other.body.step).toBe('TWO_FACTOR_SETUP');
      expect((await call('POST', 'auth/two-factor/setup', { body: { ticket: other.body.ticket, code: '123456' } })).status).toBe(401);
    });

    it('asks a finance role to set up two-factor first, then for a code; a recovery code works once (FR-SEC-061)', async () => {
      const first = await signIn('RI');
      expect(first.status).toBe(200);
      expect(first.cookie).toBeNull();
      expect(first.body).toMatchObject({
        step: 'TWO_FACTOR_SETUP',
        ticket: expect.any(String),
        reason: 'Your roles (Finance Director, Finance Manager) handle admin and finance work, so a code from your phone is needed at each sign-in.',
        setup: { key: expect.stringMatching(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/), otpauthUrl: expect.stringMatching(/^otpauth:\/\/totp\/Zora%20Pro%20ERP/), qr: expect.stringMatching(/^data:image\/png;base64,/) },
      });
      const rosnah = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'RI' } });
      expect(await api.prisma.sysSession.count({ where: { userId: rosnah.id } })).toBe(0);
      expect((await call('GET', 'me', { token: first.body.ticket })).status).toBe(401); // a ticket is not an access token

      const secret = (first.body.setup.key as string).replace(/ /g, '');
      const wrong = await call('POST', 'auth/two-factor/setup', { body: { ticket: first.body.ticket, code: '000000' } });
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('WRONG_CODE');
      const done = await call('POST', 'auth/two-factor/setup', { body: { ticket: first.body.ticket, code: authenticator.generate(secret) } });
      expect(done.status).toBe(200);
      expect(done.cookie).toMatch(/^zora_refresh=/);
      expect(done.body.recoveryCodes).toHaveLength(8);
      expect(done.body.recoveryCodes.every((c: string) => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c))).toBe(true);
      secrets.set('RI', secret);

      const again = await signIn('RI');
      expect(again.body).toEqual({ step: 'TWO_FACTOR', ticket: expect.any(String) });
      const byCode = await call('POST', 'auth/two-factor', { body: { ticket: again.body.ticket, code: authenticator.generate(secret) } });
      expect(byCode.status).toBe(200);
      expect((await call('GET', 'me', { token: byCode.body.accessToken })).body.user.code).toBe('RI');

      const recovery = (done.body.recoveryCodes[0] as string).toLowerCase().replace('-', ' ');
      const lost = await signIn('RI');
      const byRecovery = await call('POST', 'auth/two-factor', { body: { ticket: lost.body.ticket, code: recovery } });
      expect(byRecovery.status).toBe(200);
      expect(byRecovery.body.recoveryCodesLeft).toBe(7);
      const reuse = await call('POST', 'auth/two-factor', { body: { ticket: (await signIn('RI')).body.ticket, code: recovery } });
      expect(reuse.status).toBe(401);

      // Required by a role, so it cannot be turned off from My account (rule 8).
      const off = await call('POST', 'account/two-factor/disable', { token: byCode.body.accessToken, body: { password: 'Zora-demo-2026' } });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('TWO_FACTOR_REQUIRED');
      const kinds = await api.prisma.sysSecurityEvent.findMany({ where: { tenantId: TENANT_ID, userCode: 'RI' }, orderBy: { createdAt: 'asc' }, select: { kind: true } });
      expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(['TWO_FACTOR_ON', 'RECOVERY_CODE_USED', 'SIGN_IN_FAILED']));
    });

    it('forgot password: the same answer for anyone; the emailed link sets a password once and signs out everywhere (FR-SEC-063)', async () => {
      const before = await signIn('TWL');
      const answer = { message: 'If an account matches, a link to reset the password is on its way to its email.' };
      expect((await call('POST', 'auth/forgot', { body: { identifier: 'nobody@warehouse.com' } })).body).toEqual(answer);
      expect((await call('POST', 'auth/forgot', { body: { identifier: 'twl' } })).body).toEqual(answer);
      const { email, token } = await mailed('TWL', 'sign_in.reset');
      expect(email).toMatchObject({ toAddress: 'weiling@warehouse.com', subject: 'Reset your Zora Pro ERP password' });
      expect(await api.prisma.sysAuthToken.count({ where: { tokenHash: token } })).toBe(0); // only the hash is kept

      expect((await call('POST', 'auth/link', { body: { token } })).body).toMatchObject({ kind: 'RESET_PASSWORD', user: { code: 'TWL', name: 'Tan Wei Ling' }, passwordMinLength: 10 });
      const short = await call('POST', 'auth/reset', { body: { token, newPassword: 'short' } });
      expect(short.body.errors).toEqual([{ field: 'newPassword', message: 'Use at least 10 characters.' }]);
      const common = await call('POST', 'auth/reset', { body: { token, newPassword: 'qwertyuiop' } });
      expect(common.body.errors[0].message).toBe('That password is too common. Pick something harder to guess.');
      const own = await call('POST', 'auth/reset', { body: { token, newPassword: 'weiling-2026-x' } });
      expect(own.body.errors[0].message).toBe('Do not use your name, user code or email in your password.');

      const reset = await call('POST', 'auth/reset', { body: { token, newPassword: 'Ocean-lantern-42' } });
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual({ code: 'TWL' });
      expect((await call('POST', 'auth/refresh', { cookie: before.cookie })).status).toBe(401);
      const used = await call('POST', 'auth/reset', { body: { token, newPassword: 'Another-lantern-43' } });
      expect(used.status).toBe(410);
      expect(used.body).toEqual({ code: 'LINK_GONE', message: 'This link has been used or has run out. Ask for a new one.' });
      expect((await signIn('TWL')).status).toBe(401);
      expect((await signIn('TWL', 'Ocean-lantern-42')).status).toBe(200);
      expect(await api.prisma.sysSecurityEvent.count({ where: { tenantId: TENANT_ID, userCode: 'TWL', kind: { in: ['RESET_REQUESTED', 'PASSWORD_RESET'] } } })).toBe(2);
    });

    it('My account: change the password, sign out other devices, and turn two-factor on and off when no role needs it (A11)', async () => {
      const here = await signIn('AR');
      const phone = await signIn('AR');
      const view = await call('GET', 'account', { token: here.body.accessToken });
      expect(view.body).toMatchObject({
        me: { code: 'AR', name: 'Aina Rahman', email: 'aina@warehouse.com', roles: ['Sales agent', 'Billing', 'Sales store'] },
        signInOn: true,
        password: { hint: 'At least 10 characters. Common passwords are refused.', changeDue: false },
        twoFactor: { enabled: false, required: false, recoveryCodesLeft: 0 },
      });
      const sessions = view.body.sessions as { id: string; current: boolean }[];
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      const other = sessions.find((s) => !s.current && s.id === phone.cookie!.slice('zora_refresh='.length).split('.')[0])!;
      expect((await call('DELETE', `account/sessions/${other.id}`, { token: here.body.accessToken })).status).toBe(200);
      expect((await call('POST', 'auth/refresh', { cookie: phone.cookie })).status).toBe(401);

      const tablet = await signIn('AR');
      const wrongCurrent = await call('POST', 'account/password', { token: here.body.accessToken, body: { currentPassword: 'nope', newPassword: 'River-stone-2026' } });
      expect(wrongCurrent.body.errors).toEqual([{ field: 'currentPassword', message: 'That is not your current password.' }]);
      const changed = await call('POST', 'account/password', { token: here.body.accessToken, body: { currentPassword: 'Zora-demo-2026', newPassword: 'River-stone-2026' } });
      expect(changed.status).toBe(200);
      expect(changed.body.sessions).toHaveLength(1); // this device stays; the others end (rule 7)
      expect((await call('POST', 'auth/refresh', { cookie: tablet.cookie })).status).toBe(401);
      expect((await call('GET', 'me', { token: here.body.accessToken })).status).toBe(200);

      const setup = await call('POST', 'account/two-factor/setup', { token: here.body.accessToken });
      expect(setup.body).toMatchObject({ key: expect.any(String), qr: expect.stringMatching(/^data:image\/png;base64,/) });
      const secret = (setup.body.key as string).replace(/ /g, '');
      expect((await call('POST', 'account/two-factor/enable', { token: here.body.accessToken, body: { code: '123456' } })).status).toBe(400);
      const on = await call('POST', 'account/two-factor/enable', { token: here.body.accessToken, body: { code: authenticator.generate(secret) } });
      expect(on.status).toBe(200);
      expect(on.body.recoveryCodes).toHaveLength(8);
      expect(on.body.account.twoFactor).toEqual({ enabled: true, required: false, recoveryCodesLeft: 8 });
      expect((await signIn('AR', 'River-stone-2026')).body.step).toBe('TWO_FACTOR');

      expect((await call('POST', 'account/two-factor/disable', { token: here.body.accessToken, body: { password: 'Zora-demo-2026' } })).status).toBe(400);
      const off = await call('POST', 'account/two-factor/disable', { token: here.body.accessToken, body: { password: 'River-stone-2026' } });
      expect(off.body.twoFactor.enabled).toBe(false);
      expect((await signIn('AR', 'River-stone-2026')).body.step).toBe('DONE');
      const kinds = (await api.prisma.sysSecurityEvent.findMany({ where: { tenantId: TENANT_ID, userCode: 'AR', kind: { in: ['PASSWORD_CHANGED', 'SESSION_REVOKED', 'TWO_FACTOR_ON', 'TWO_FACTOR_OFF'] } } })).map((e) => e.kind);
      expect(kinds.sort()).toEqual(['PASSWORD_CHANGED', 'SESSION_REVOKED', 'TWO_FACTOR_OFF', 'TWO_FACTOR_ON']);
    });

    it('the Administrator adds a user with a set-password link, signs them out, unlocks them and resets two-factor (A07)', async () => {
      const admin = await signInFully('ADM');
      const token = admin.body.accessToken as string;
      const created = await call('POST', 'config/users', { token, body: { code: 'NEW', name: 'Hana Yusof', email: 'hana@warehouse.com', roles: [{ roleCode: 'SALES_AGENT' }], branches: ['HQ'], defaultBranch: 'HQ' } });
      expect(created.status).toBe(201);
      expect((await signIn('NEW', 'anything-at-all')).status).toBe(401); // no password until the link is used
      const setLink = await mailed('NEW', 'sign_in.set_password');
      expect((await call('POST', 'auth/link', { body: { token: setLink.token } })).body.kind).toBe('SET_PASSWORD');
      expect((await call('POST', 'auth/reset', { body: { token: setLink.token, newPassword: 'Harbour-light-77' } })).status).toBe(200);
      const hana = await signIn('NEW', 'Harbour-light-77');
      expect(hana.body.step).toBe('DONE');

      const id = created.body.id as string;
      const detail = await call('GET', `config/users/${id}`, { token });
      expect(detail.body.signIn).toMatchObject({ hasPassword: true, openSessions: 1 });
      expect(detail.body.allowedActions).toEqual(['edit', 'deactivate', 'send-link', 'revoke-sessions']);
      const revoked = await call('POST', `config/users/${id}/revoke-sessions`, { token });
      expect(revoked.body.signIn.openSessions).toBe(0);
      expect((await call('GET', 'me', { token: hana.body.accessToken })).status).toBe(401);

      for (let i = 0; i < 5; i++) await signIn('NEW', `wrong-${i}`);
      await clearAttempts(); // the address count is not what this checks
      expect((await signIn('NEW', 'Harbour-light-77')).body.code).toBe('ACCOUNT_LOCKED');
      const locked = await call('GET', `config/users/${id}`, { token });
      expect(locked.body).toMatchObject({ status: 'locked', allowedActions: expect.arrayContaining(['unlock']) });
      const unlocked = await call('POST', `config/users/${id}/unlock`, { token });
      expect(unlocked.body.status).toBe('active');
      expect((await signIn('NEW', 'Harbour-light-77')).status).toBe(200);

      const sent = await call('POST', `config/users/${id}/send-link`, { token });
      expect(sent.body.signIn.emails.map((e: { kind: string }) => e.kind)).toEqual(['sign_in.reset', 'sign_in.set_password']);
      const resetLink = await mailed('NEW', 'sign_in.reset');
      await api.prisma.sysAuthToken.updateMany({ where: { userId: id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await call('POST', 'auth/link', { body: { token: resetLink.token } })).status).toBe(410);

      const ri = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'RI' } });
      const riDetail = await call('GET', `config/users/${ri.id}`, { token });
      expect(riDetail.body.allowedActions).toContain('reset-two-factor');
      expect((await call('POST', `config/users/${ri.id}/reset-two-factor`, { token })).status).toBe(200);
      expect((await signIn('RI')).body.step).toBe('TWO_FACTOR_SETUP');
      const logged = await api.prisma.sysSecurityEvent.findMany({ where: { tenantId: TENANT_ID, actorCode: 'ADM', kind: { in: ['LINK_SENT', 'SESSION_REVOKED', 'UNLOCKED', 'TWO_FACTOR_RESET'] } } });
      expect(logged.map((e) => e.kind).sort()).toEqual(['LINK_SENT', 'LINK_SENT', 'SESSION_REVOKED', 'TWO_FACTOR_RESET', 'UNLOCKED']);
    });

    it('sign-in settings are checked, logged and apply on the next request (A14)', async () => {
      const admin = await signInFully('ADM');
      const token = admin.body.accessToken as string;
      const view = await call('GET', 'config/settings/sign-in', { token });
      expect(view.body).toMatchObject({ tenantName: 'CLB Groups', allowedActions: ['edit'], settings: { passwordMinLength: 10, lockoutAttempts: 5, lockoutPerAddress: true, twoFactorRoles: ['ADMIN', 'MASTER_DATA_ADMIN', 'FINANCE_DIRECTOR', 'FINANCE_MANAGER'] } });
      const version = view.body.version as number;

      const bad = await call('PATCH', 'config/settings/sign-in', { token, body: { version, passwordMinLength: 7, twoFactorRoles: ['ADMIN', 'NOPE'] } });
      expect(bad.status).toBe(400);
      expect(bad.body.errors).toEqual([
        { field: 'passwordMinLength', message: 'Shortest password: a whole number from 8 to 64.' },
        { field: 'twoFactorRoles', message: 'NOPE is not a role.' },
      ]);
      const saved = await call('PATCH', 'config/settings/sign-in', { token, body: { version, lockoutAttempts: 3, lockoutPerAddress: false, passwordMaxAgeDays: 90 } });
      expect(saved.status).toBe(200);
      expect(saved.body.settings).toMatchObject({ lockoutAttempts: 3, lockoutPerAddress: false, passwordMaxAgeDays: 90 });
      expect((await call('PATCH', 'config/settings/sign-in', { token, body: { version, lockoutAttempts: 4 } })).status).toBe(409);
      const logged = await api.prisma.sysSecurityEvent.findFirstOrThrow({ where: { tenantId: TENANT_ID, kind: 'SETTINGS_CHANGED' } });
      expect(logged.message).toBe('Sign-in settings: Changed ask to change every (days) Never → 90, lock after wrong passwords 5 → 3 and count per network address too Yes → No');
      expect(await api.prisma.sysActivity.count({ where: { tenantId: TENANT_ID, entityType: 'SYS_SETTING' } })).toBe(1);

      // Three wrong passwords now lock the account; the address is no longer counted, so others still sign in.
      for (let i = 0; i < 3; i++) await signIn('HAF', `wrong-${i}`);
      for (let i = 0; i < 3; i++) await signIn('nobody', `wrong-${i}`);
      expect((await signIn('HAF')).body.code).toBe('ACCOUNT_LOCKED');
      expect((await signIn('FO')).status).toBe(200);
      // Asked to change regularly: a password older than 90 days is due (the launcher shows a banner).
      expect((await call('GET', 'account', { token })).body.password.changeDue).toBe(false);
      await api.prisma.sysUser.updateMany({ where: { tenantId: TENANT_ID, code: 'ADM' }, data: { passwordChangedAt: new Date(Date.now() - 91 * 86_400_000) } });
      expect((await call('GET', 'account', { token })).body.password.changeDue).toBe(true);
    });
  });
});
