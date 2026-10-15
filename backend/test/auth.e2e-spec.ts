// Sign-in mode for this file only: set before the app module is loaded (it is required inside beforeAll).
process.env.AUTH_MODE = 'jwt';
process.env.JWT_SECRET = 'e2e-only-secret-0123456789abcdef0123456789abcdef';

import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { DiscoveryService as Discovery, MetadataScanner as Scanner } from '@nestjs/core';
import * as argon2 from 'argon2';
import { TENANT_ID } from '../prisma/seed/util';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/platform/context/context.decorators';
import type { Api } from './e2e-helpers';

interface Answer<T = any> {
  status: number;
  body: T;
  cookie: string | null;
}

/**
 * Sign-in (CLAUDE.md → Phase 4 · A5), against the API with AUTH_MODE=jwt: passwords, rotating refresh tokens and their
 * reuse, branch switch, sign-out, idle time-out, lockout, and every endpoint without a token (401) and without the
 * permission (403). The other suites run in dev mode and are unaffected.
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
    const admin = await signIn('ADM');
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
    const PUBLIC = ['GET /health', 'GET /dev/users', 'GET /auth/mode', 'POST /auth/sign-in', 'POST /auth/refresh', 'POST /auth/sign-out'];
    /** Signed in, no permission: who you are, the launcher, attachments (checked against their document), branch switch, the dev-only receipt stub. */
    const SIGNED_IN_ONLY = ['GET /me', 'GET /me/modules', 'POST /attachments', 'GET /attachments/:id', 'GET /attachments/:id/download', 'POST /dev/finance/receipts', 'POST /auth/switch-branch'];

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
});
