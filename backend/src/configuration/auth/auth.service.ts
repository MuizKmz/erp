import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SysSession, SysUser } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import type { RequestContext } from '../../platform/context/request-context';
import { ACCESS_AUDIENCE, type AccessClaims } from '../../platform/context/session-gate';
import { TenantService } from '../../platform/context/tenant.service';
import { ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SECURITY_EVENT } from '../configuration.constants';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import type { SignInSettings } from '../settings/sign-in.rules';
import { passwordProblem } from '../shared/password.rules';
import { SecurityEventsService, type RequestMeta } from '../shared/security-events.service';
import {
  accountLockedMessage,
  addressLocked,
  addressLockedMessage,
  afterWrongPassword,
  deviceName,
  identifierOf,
  isLocked,
  sessionProblem,
  splitRefreshToken,
  WRONG_CREDENTIALS,
} from './auth.rules';
import { CredentialsService, sha256, type TwoFactorSetup } from './credentials.service';
import { setupReason, twoFactorRequired } from './two-factor.rules';

export interface Issued {
  accessToken: string;
  /** When the access token runs out (15 minutes); the app refreshes before then. */
  expiresAt: string;
  branchCode: string;
  /** "<session id>.<secret>", for the httpOnly cookie only. */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

/** What a correct password leads to: signed in, or one more step for two-factor (A03). */
export type SignInAnswer =
  | ({ step: 'DONE' } & Issued)
  | { step: 'TWO_FACTOR'; ticket: string; demoBypassCode?: string }
  | { step: 'TWO_FACTOR_SETUP'; ticket: string; setup: TwoFactorSetup; reason: string; demoBypassCode?: string };

/** The step between password and code: short-lived, and never accepted as an access token (other audience). */
const TICKET_AUDIENCE = 'zora-two-factor';
const TICKET_SECONDS = 600;
interface Ticket {
  sub: string;
  tid: string;
  stage: 'code' | 'setup';
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);
const LINK_GONE = 'This link has been used or has run out. Ask for a new one.';

/**
 * A02 sign-in and A03 two-factor (Phase 4 · A5, A6): passwords, lockout, two-factor with recovery codes, sessions with
 * rotating refresh tokens, branch switch, sign-out, and single-use reset and set-password links.
 */
@Injectable()
export class AuthService {
  /** Checked against when the user is unknown, so a wrong user code takes as long as a wrong password. */
  private readonly dummyHash: Promise<string>;
  private readonly demoAdminBypassCode: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenants: TenantService,
    private readonly settings: SignInSettingsService,
    private readonly security: SecurityEventsService,
    private readonly credentials: CredentialsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    config: ConfigService<Env, true>,
  ) {
    this.dummyHash = credentials.hashPassword(randomBytes(16).toString('hex'));
    // This is intentionally a local-demo convenience, never a production authentication path.
    this.demoAdminBypassCode = process.env.NODE_ENV === 'production' ? null : config.get('DEMO_ADMIN_2FA_BYPASS_CODE', { infer: true });
  }

  async signIn(identifier: string, password: string, meta: RequestMeta): Promise<SignInAnswer> {
    const tenantId = await this.tenants.resolve();
    const settings = await this.settings.get(tenantId);
    const now = new Date();
    const typed = identifier.trim().slice(0, 150);
    const ip = meta.ipAddress ?? 'unknown';
    const attempt = (success: boolean, reason: string | null, userId: string | null) =>
      this.prisma.sysLoginAttempt.create({ data: { tenantId, identifier: typed, userId, ipAddress: ip, success, reason, createdAt: now } });

    // Too many failures from this network address lock it too (FR-SEC-062), unless the settings count per account only.
    if (settings.lockoutPerAddress) {
      const since = new Date(now.getTime() - settings.lockoutMinutes * 60_000);
      const fromAddress = await this.prisma.sysLoginAttempt.count({
        where: { tenantId, ipAddress: ip, success: false, reason: { in: ['WRONG_PASSWORD', 'UNKNOWN_USER', 'WRONG_CODE'] }, createdAt: { gte: since } },
      });
      if (addressLocked(fromAddress, settings.lockoutAttempts)) {
        await attempt(false, 'ADDRESS_LOCKED', null);
        throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ADDRESS_LOCKED', addressLockedMessage(settings.lockoutMinutes));
      }
    }

    const user = await this.prisma.sysUser.findFirst({ where: { tenantId, ...identifierOf(typed) } });
    if (!user) {
      await this.credentials.verifyPassword(await this.dummyHash, password);
      await attempt(false, 'UNKNOWN_USER', null);
      await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: null, message: `Sign-in failed for "${typed}": no such user` }, meta);
      throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CREDENTIALS', WRONG_CREDENTIALS);
    }
    const who = { code: user.code, name: user.name };
    if (isLocked(user.lockedUntil, now)) {
      await attempt(false, 'LOCKED', user.id);
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_LOCKED', accountLockedMessage(user.lockedUntil!));
    }

    const good = await this.credentials.verifyPassword(user.passwordHash, password);
    if (!good || !user.isActive) {
      const reason = !user.passwordHash ? 'NO_PASSWORD' : !good ? 'WRONG_PASSWORD' : 'INACTIVE';
      if (reason === 'WRONG_PASSWORD') await this.wrongSecret(user, settings, typed, meta, 'WRONG_PASSWORD', `Wrong password for ${user.name}`);
      else {
        await attempt(false, reason, user.id);
        await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: who, message: `Sign-in refused for ${user.name}: ${reason === 'INACTIVE' ? 'the account is inactive' : 'no password set yet'}` }, meta);
      }
      throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CREDENTIALS', WRONG_CREDENTIALS);
    }

    const profile = await this.masterData.findUserByCode(tenantId, user.code);
    const branchCode = profile?.branchCodes[0];
    if (!profile || !branchCode) {
      await attempt(false, 'NO_BRANCH', user.id);
      throw fail(HttpStatus.FORBIDDEN, 'NO_BRANCH', 'You have no branch to work in yet. Ask an administrator.');
    }

    // Two-factor (FR-SEC-061, rule 8): asked when it is on; when a role requires it and it is not set up, set up first.
    if (user.twoFactorEnabledAt) return { step: 'TWO_FACTOR', ticket: await this.ticket(user, 'code'), ...this.demoBypass(user) };
    const required = profile.roles.filter((r) => settings.twoFactorRoles.includes(r));
    if (twoFactorRequired(profile.roles, settings.twoFactorRoles)) {
      const roleNames = (await this.prisma.sysRole.findMany({ where: { tenantId, code: { in: required } }, select: { code: true, name: true } })).map((r) => r.name);
      const setup = await this.credentials.startSetup(this.prisma, user);
      return { step: 'TWO_FACTOR_SETUP', ticket: await this.ticket(user, 'setup'), setup, reason: setupReason(roleNames), ...this.demoBypass(user) };
    }
    return { step: 'DONE', ...(await this.openSession(user, branchCode, settings, typed, meta)) };
  }

  /** A03 · the code from the app, or one of the recovery codes (each works once). */
  async verifyTwoFactor(ticket: string, typed: string, meta: RequestMeta): Promise<Issued & { recoveryCodesLeft?: number }> {
    const { user, settings } = await this.fromTicket(ticket, 'code');
    if (this.isDemoBypass(user, typed) || this.credentials.checkTotp(user.twoFactorSecret, typed)) return this.openSession(user, await this.branchOf(user), settings, user.code, meta);
    const left = this.credentials.useRecoveryCode(user.recoveryCodes, typed);
    if (left) {
      await this.prisma.sysUser.update({ where: { id: user.id }, data: { recoveryCodes: left } });
      await this.security.log(this.prisma, user.tenantId, { kind: SECURITY_EVENT.RECOVERY_CODE_USED, user: { code: user.code, name: user.name }, message: `${user.name} signed in with a recovery code (${left.length} left)` }, meta);
      return { ...(await this.openSession(user, await this.branchOf(user), settings, user.code, meta)), recoveryCodesLeft: left.length };
    }
    await this.wrongSecret(user, settings, user.code, meta, 'WRONG_CODE', `Wrong two-factor code for ${user.name}`);
    throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CODE', 'That code is not right. Codes from the app change every 30 seconds.');
  }

  /** A03 · confirms the new secret with a code from the app, turns two-factor on and gives the recovery codes once. */
  async completeSetup(ticket: string, typed: string, meta: RequestMeta): Promise<Issued & { recoveryCodes: string[] }> {
    const { user, settings } = await this.fromTicket(ticket, 'setup');
    if (!this.isDemoBypass(user, typed) && !this.credentials.checkTotp(user.twoFactorSecret, typed)) {
      await this.wrongSecret(user, settings, user.code, meta, 'WRONG_CODE', `Wrong code while ${user.name} set up two-factor`);
      throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CODE', 'That code is not right. Check the app shows Zora Pro ERP, and type the code it shows now.');
    }
    const codes = this.credentials.newRecoveryCodes();
    await this.prisma.sysUser.update({ where: { id: user.id }, data: { twoFactorEnabledAt: new Date(), recoveryCodes: codes.hashes } });
    await this.security.log(this.prisma, user.tenantId, { kind: SECURITY_EVENT.TWO_FACTOR_ON, user: { code: user.code, name: user.name }, message: `${user.name} turned on two-factor sign-in` }, meta);
    return { ...(await this.openSession(user, await this.branchOf(user), settings, user.code, meta)), recoveryCodes: codes.plain };
  }

  private demoBypass(user: Pick<SysUser, 'code'>): { demoBypassCode?: string } {
    return user.code === 'ADM' && this.demoAdminBypassCode ? { demoBypassCode: this.demoAdminBypassCode } : {};
  }

  private isDemoBypass(user: Pick<SysUser, 'code'>, typed: string): boolean {
    return user.code === 'ADM' && !!this.demoAdminBypassCode && typed.trim() === this.demoAdminBypassCode;
  }

  /** Single use with rotation (SDD 10.2): an old token presented again ends the whole session. */
  async refresh(raw: string | undefined, meta: RequestMeta): Promise<Issued> {
    const tenantId = await this.tenants.resolve();
    const token = splitRefreshToken(raw);
    if (!token) throw fail(HttpStatus.UNAUTHORIZED, 'NOT_SIGNED_IN', 'Sign in to continue.');
    const session = await this.prisma.sysSession.findFirst({ where: { id: token.sessionId, tenantId } });
    if (!session) throw fail(HttpStatus.UNAUTHORIZED, 'NOT_SIGNED_IN', 'Sign in to continue.');
    const user = await this.prisma.sysUser.findUniqueOrThrow({ where: { id: session.userId } });
    const who = { code: user.code, name: user.name };
    const now = new Date();
    const settings = await this.settings.get(tenantId);

    if (!session.revokedAt && !sameHash(sha256(token.secret), session.refreshTokenHash)) {
      await this.end(session, 'TOKEN_REUSED', now);
      await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.TOKEN_REUSED, user: who, message: `An old sign-in token for ${user.name} was used again, so that session was ended` }, meta);
      throw fail(HttpStatus.UNAUTHORIZED, 'SIGNED_OUT', 'You were signed out for safety. Sign in again.');
    }
    const problem = sessionProblem(session, now, settings.idleMinutes) ?? (user.isActive ? null : { reason: 'REVOKED' as const, message: 'Your account is no longer active. Ask an administrator.' });
    if (problem) {
      if (problem.reason !== 'REVOKED') {
        await this.end(session, problem.reason, now);
        await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.SESSION_ENDED, user: who, message: problem.message.replace(/ Sign in again\.$/, '') }, meta);
      }
      throw fail(HttpStatus.UNAUTHORIZED, problem.reason === 'IDLE' ? 'SIGNED_OUT_IDLE' : 'SIGNED_OUT', problem.message);
    }

    const profile = await this.masterData.findUserByCode(tenantId, user.code);
    const branchCode = profile?.branchCodes.includes(session.activeBranchCode) ? session.activeBranchCode : profile?.branchCodes[0];
    if (!branchCode) throw fail(HttpStatus.FORBIDDEN, 'NO_BRANCH', 'You have no branch to work in yet. Ask an administrator.');
    const secret = randomBytes(32).toString('base64url');
    const rotated = await this.prisma.sysSession.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      data: { refreshTokenHash: sha256(secret), lastActivityAt: now, activeBranchCode: branchCode },
    });
    if (rotated.count !== 1) throw fail(HttpStatus.UNAUTHORIZED, 'SIGNED_OUT', 'You were signed out. Sign in again.');
    return { ...(await this.access(user, tenantId, session.id, branchCode, settings)), refreshToken: `${session.id}.${secret}`, refreshExpiresAt: session.expiresAt };
  }

  /** Ends this device's session; the cookie is cleared by the controller either way. */
  async signOut(raw: string | undefined, meta: RequestMeta): Promise<void> {
    const token = splitRefreshToken(raw);
    if (!token) return;
    const tenantId = await this.tenants.resolve();
    const session = await this.prisma.sysSession.findFirst({ where: { id: token.sessionId, tenantId, revokedAt: null } });
    if (!session || !sameHash(sha256(token.secret), session.refreshTokenHash)) return;
    await this.end(session, 'SIGNED_OUT', new Date());
    const user = await this.prisma.sysUser.findUnique({ where: { id: session.userId }, select: { code: true, name: true } });
    await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.SIGNED_OUT, user, message: `${user?.name ?? 'A user'} signed out on ${session.device ?? 'a device'}` }, meta);
  }

  /** A new access token for another of the user's branches (FR-SEC-021). The header cannot do this in sign-in mode. */
  async switchBranch(ctx: RequestContext, branchCode: string): Promise<Issued> {
    if (!ctx.sessionId) throw fail(HttpStatus.BAD_REQUEST, 'NO_SESSION', 'Switching branch needs sign-in.');
    if (!ctx.user.branchCodes.includes(branchCode)) {
      throw fail(HttpStatus.FORBIDDEN, 'BRANCH_NOT_ALLOWED', `${ctx.user.name} does not work in branch ${branchCode}.`);
    }
    await this.prisma.sysSession.update({ where: { id: ctx.sessionId }, data: { activeBranchCode: branchCode, lastActivityAt: new Date() } });
    const settings = await this.settings.get(ctx.tenantId);
    return this.access({ id: ctx.user.id, code: ctx.user.code }, ctx.tenantId, ctx.sessionId, branchCode, settings);
  }

  /** Forgot password (FR-SEC-063): a link if the account exists; the same answer either way. */
  async forgot(identifier: string, meta: RequestMeta): Promise<void> {
    const tenantId = await this.tenants.resolve();
    const settings = await this.settings.get(tenantId);
    const user = await this.prisma.sysUser.findFirst({ where: { tenantId, isActive: true, ...identifierOf(identifier.trim().slice(0, 150)) } });
    if (!user) return;
    // One link a minute is enough; more would only fill the mailbox.
    const recent = await this.prisma.sysAuthToken.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent) return;
    await this.prisma.$transaction(async (tx) => {
      await this.credentials.issueLink(tx, user, user.passwordHash ? 'RESET_PASSWORD' : 'SET_PASSWORD', settings.linkMinutes, user.code);
      await this.security.log(tx, tenantId, { kind: SECURITY_EVENT.RESET_REQUESTED, user: { code: user.code, name: user.name }, message: `${user.name} asked for a password link` }, meta);
    });
  }

  /** What a link is for, so the page can say "Set your password" or "Reset your password". */
  async checkLink(raw: string) {
    const token = await this.liveLink(raw);
    const user = await this.prisma.sysUser.findUniqueOrThrow({ where: { id: token.userId }, select: { code: true, name: true, email: true } });
    const settings = await this.settings.get(token.tenantId);
    return { kind: token.kind, user, expiresAt: token.expiresAt.toISOString(), passwordMinLength: settings.passwordMinLength, refuseCommonPasswords: settings.refuseCommonPasswords };
  }

  /** A new password from a link: works once, ends every session, clears a lockout (rule 7). */
  async resetWithLink(raw: string, newPassword: string, meta: RequestMeta): Promise<{ code: string }> {
    const token = await this.liveLink(raw);
    const user = await this.prisma.sysUser.findUniqueOrThrow({ where: { id: token.userId } });
    const settings = await this.settings.get(user.tenantId);
    const problem = passwordProblem(newPassword, settings, user);
    if (problem) throw ValidationFailedError.field('newPassword', problem);
    const hash = await this.credentials.hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.sysAuthToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw fail(HttpStatus.GONE, 'LINK_GONE', LINK_GONE);
      await tx.sysUser.update({ where: { id: user.id }, data: { passwordHash: hash, passwordChangedAt: new Date(), failedSignIns: 0, lockedUntil: null } });
      const ended = await this.credentials.endSessions(tx, user.id, 'PASSWORD_RESET');
      const set = token.kind === 'SET_PASSWORD';
      await this.security.log(tx, user.tenantId, {
        kind: set ? SECURITY_EVENT.PASSWORD_SET : SECURITY_EVENT.PASSWORD_RESET,
        user: { code: user.code, name: user.name },
        message: `${user.name} ${set ? 'set their password' : 'reset their password'} with a link${ended ? `; ${ended} session${ended === 1 ? '' : 's'} ended` : ''}`,
      }, meta);
    });
    return { code: user.code };
  }

  private async liveLink(raw: string) {
    const token = await this.prisma.sysAuthToken.findUnique({ where: { tokenHash: sha256(raw ?? '') } });
    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) throw fail(HttpStatus.GONE, 'LINK_GONE', LINK_GONE);
    return token;
  }

  /** A wrong password or code (FR-SEC-062): recorded, counted towards the lockout, and logged. */
  private async wrongSecret(user: SysUser, settings: SignInSettings, typed: string, meta: RequestMeta, reason: 'WRONG_PASSWORD' | 'WRONG_CODE', message: string): Promise<void> {
    const now = new Date();
    const who = { code: user.code, name: user.name };
    await this.prisma.$transaction(async (tx) => {
      await tx.sysLoginAttempt.create({ data: { tenantId: user.tenantId, identifier: typed, userId: user.id, ipAddress: meta.ipAddress ?? 'unknown', success: false, reason, createdAt: now } });
      const next = afterWrongPassword(user.failedSignIns, user.lockedUntil, settings, now);
      await tx.sysUser.update({ where: { id: user.id }, data: { failedSignIns: next.failedSignIns, lockedUntil: next.lockedUntil } });
      await this.security.log(tx, user.tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: who, message: `${message} (${next.failedSignIns} in a row)` }, meta);
      if (next.lockedNow) {
        await this.security.log(tx, user.tenantId, { kind: SECURITY_EVENT.LOCKED_OUT, user: who, message: `${user.name} locked for ${settings.lockoutMinutes} minutes after ${next.failedSignIns} wrong tries` }, meta);
      }
    });
  }

  private ticket(user: SysUser, stage: Ticket['stage']): Promise<string> {
    const claims: Ticket = { sub: user.id, tid: user.tenantId, stage };
    return this.jwt.signAsync(claims, { expiresIn: TICKET_SECONDS, audience: TICKET_AUDIENCE });
  }

  private async fromTicket(raw: string, stage: Ticket['stage']): Promise<{ user: SysUser; settings: SignInSettings }> {
    let claims: Ticket;
    try {
      claims = await this.jwt.verifyAsync<Ticket>(raw, { audience: TICKET_AUDIENCE });
    } catch {
      throw fail(HttpStatus.UNAUTHORIZED, 'TICKET_EXPIRED', 'That took too long. Sign in again.');
    }
    if (claims.stage !== stage) throw fail(HttpStatus.UNAUTHORIZED, 'TICKET_EXPIRED', 'Sign in again.');
    const user = await this.prisma.sysUser.findFirst({ where: { id: claims.sub, tenantId: claims.tid } });
    if (!user || !user.isActive) throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CREDENTIALS', WRONG_CREDENTIALS);
    if (isLocked(user.lockedUntil, new Date())) throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_LOCKED', accountLockedMessage(user.lockedUntil!));
    return { user, settings: await this.settings.get(user.tenantId) };
  }

  private async branchOf(user: SysUser): Promise<string> {
    const branch = (await this.masterData.findUserByCode(user.tenantId, user.code))?.branchCodes[0];
    if (!branch) throw fail(HttpStatus.FORBIDDEN, 'NO_BRANCH', 'You have no branch to work in yet. Ask an administrator.');
    return branch;
  }

  /** Signed in: a session for this device, the lockout count cleared, and the attempt recorded. */
  private async openSession(user: SysUser, branchCode: string, settings: SignInSettings, typed: string, meta: RequestMeta): Promise<Issued> {
    const now = new Date();
    const secret = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(now.getTime() + settings.refreshDays * 86_400_000);
    const device = deviceName(meta.userAgent);
    const session = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sysSession.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          refreshTokenHash: sha256(secret),
          activeBranchCode: branchCode,
          device,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
          createdAt: now,
          lastActivityAt: now,
          expiresAt: refreshExpiresAt,
        },
      });
      await tx.sysUser.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: now } });
      await tx.sysLoginAttempt.create({ data: { tenantId: user.tenantId, identifier: typed, userId: user.id, ipAddress: meta.ipAddress ?? 'unknown', success: true, reason: null, createdAt: now } });
      await this.security.log(tx, user.tenantId, { kind: SECURITY_EVENT.SIGNED_IN, user: { code: user.code, name: user.name }, message: `${user.name} signed in on ${device}`, data: { sessionId: s.id } }, meta);
      return s;
    });
    return { ...(await this.access(user, user.tenantId, session.id, branchCode, settings)), refreshToken: `${session.id}.${secret}`, refreshExpiresAt };
  }

  private async access(user: { id: string; code: string }, tenantId: string, sessionId: string, branchCode: string, settings: SignInSettings): Promise<Issued> {
    const claims: AccessClaims = { sub: user.id, code: user.code, tid: tenantId, sid: sessionId, br: branchCode };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: settings.accessMinutes * 60, audience: ACCESS_AUDIENCE });
    return { accessToken, expiresAt: new Date(Date.now() + settings.accessMinutes * 60_000).toISOString(), branchCode };
  }

  private async end(session: SysSession, reason: string, now: Date): Promise<void> {
    await this.prisma.sysSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
  }
}
