import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SysSession } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import type { RequestContext } from '../../platform/context/request-context';
import type { AccessClaims } from '../../platform/context/session-gate';
import { TenantService } from '../../platform/context/tenant.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SECURITY_EVENT } from '../configuration.constants';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import type { SignInSettings } from '../settings/sign-in.rules';
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

/** argon2id with the library's defaults (64 MiB, 3 passes): NFR-SEC-003, SDD 10.2. */
export const ARGON2 = { type: argon2.argon2id } as const;

export interface Issued {
  accessToken: string;
  /** When the access token runs out (15 minutes); the app refreshes before then. */
  expiresAt: string;
  branchCode: string;
  /** "<session id>.<secret>", for the httpOnly cookie only. */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);

/** A02 sign-in (Phase 4 · A5): passwords, lockout, sessions with rotating refresh tokens, branch switch and sign-out. */
@Injectable()
export class AuthService {
  /** Checked against when the user is unknown, so a wrong user code takes as long as a wrong password. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenants: TenantService,
    private readonly settings: SignInSettingsService,
    private readonly security: SecurityEventsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {
    this.dummyHash = argon2.hash(randomBytes(16).toString('hex'), ARGON2);
  }

  async signIn(identifier: string, password: string, meta: RequestMeta): Promise<Issued> {
    const tenantId = await this.tenants.resolve();
    const settings = await this.settings.get(tenantId);
    const now = new Date();
    const typed = identifier.trim().slice(0, 150);
    const attempt = (success: boolean, reason: string | null, userId: string | null) =>
      this.prisma.sysLoginAttempt.create({ data: { tenantId, identifier: typed, userId, ipAddress: meta.ipAddress ?? 'unknown', success, reason, createdAt: now } });

    // Too many failures from this network address lock it too (FR-SEC-062).
    const since = new Date(now.getTime() - settings.lockoutMinutes * 60_000);
    const fromAddress = await this.prisma.sysLoginAttempt.count({
      where: { tenantId, ipAddress: meta.ipAddress ?? 'unknown', success: false, reason: { in: ['WRONG_PASSWORD', 'UNKNOWN_USER'] }, createdAt: { gte: since } },
    });
    if (addressLocked(fromAddress, settings.lockoutAttempts)) {
      await attempt(false, 'ADDRESS_LOCKED', null);
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ADDRESS_LOCKED', addressLockedMessage(settings.lockoutMinutes));
    }

    const user = await this.prisma.sysUser.findFirst({ where: { tenantId, ...identifierOf(typed) } });
    if (!user) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      await attempt(false, 'UNKNOWN_USER', null);
      await this.security.log(this.prisma, tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: null, message: `Sign-in failed for "${typed}": no such user` }, meta);
      throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CREDENTIALS', WRONG_CREDENTIALS);
    }
    const who = { code: user.code, name: user.name };
    if (isLocked(user.lockedUntil, now)) {
      await attempt(false, 'LOCKED', user.id);
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_LOCKED', accountLockedMessage(user.lockedUntil!));
    }

    const good = !!user.passwordHash && (await argon2.verify(user.passwordHash, password).catch(() => false));
    if (!good || !user.isActive) {
      const reason = !user.passwordHash ? 'NO_PASSWORD' : !good ? 'WRONG_PASSWORD' : 'INACTIVE';
      await this.prisma.$transaction(async (tx) => {
        await tx.sysLoginAttempt.create({ data: { tenantId, identifier: typed, userId: user.id, ipAddress: meta.ipAddress ?? 'unknown', success: false, reason, createdAt: now } });
        if (reason === 'WRONG_PASSWORD') {
          const next = afterWrongPassword(user.failedSignIns, user.lockedUntil, settings, now);
          await tx.sysUser.update({ where: { id: user.id }, data: { failedSignIns: next.failedSignIns, lockedUntil: next.lockedUntil } });
          await this.security.log(tx, tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: who, message: `Wrong password for ${user.name} (${next.failedSignIns} in a row)` }, meta);
          if (next.lockedNow) {
            await this.security.log(tx, tenantId, { kind: SECURITY_EVENT.LOCKED_OUT, user: who, message: `${user.name} locked for ${settings.lockoutMinutes} minutes after ${next.failedSignIns} wrong passwords` }, meta);
          }
        } else {
          await this.security.log(tx, tenantId, { kind: SECURITY_EVENT.SIGN_IN_FAILED, user: who, message: `Sign-in refused for ${user.name}: ${reason === 'INACTIVE' ? 'the account is inactive' : 'no password set yet'}` }, meta);
        }
      });
      throw fail(HttpStatus.UNAUTHORIZED, 'WRONG_CREDENTIALS', WRONG_CREDENTIALS);
    }

    const profile = await this.masterData.findUserByCode(tenantId, user.code);
    const branchCode = profile?.branchCodes[0];
    if (!branchCode) {
      await attempt(false, 'NO_BRANCH', user.id);
      throw fail(HttpStatus.FORBIDDEN, 'NO_BRANCH', 'You have no branch to work in yet. Ask an administrator.');
    }

    const secret = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(now.getTime() + settings.refreshDays * 86_400_000);
    const device = deviceName(meta.userAgent);
    const session = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sysSession.create({
        data: {
          tenantId,
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
      await tx.sysLoginAttempt.create({ data: { tenantId, identifier: typed, userId: user.id, ipAddress: meta.ipAddress ?? 'unknown', success: true, reason: null, createdAt: now } });
      await this.security.log(tx, tenantId, { kind: SECURITY_EVENT.SIGNED_IN, user: who, message: `${user.name} signed in on ${device}`, data: { sessionId: s.id } }, meta);
      return s;
    });
    return { ...(await this.access(user, tenantId, session.id, branchCode, settings)), refreshToken: `${session.id}.${secret}`, refreshExpiresAt };
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

  private async access(user: { id: string; code: string }, tenantId: string, sessionId: string, branchCode: string, settings: SignInSettings): Promise<Issued> {
    const claims: AccessClaims = { sub: user.id, code: user.code, tid: tenantId, sid: sessionId, br: branchCode };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: settings.accessMinutes * 60 });
    return { accessToken, expiresAt: new Date(Date.now() + settings.accessMinutes * 60_000).toISOString(), branchCode };
  }

  private async end(session: SysSession, reason: string, now: Date): Promise<void> {
    await this.prisma.sysSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
  }
}
