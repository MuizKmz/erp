import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, NotFoundError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CredentialsService } from '../auth/credentials.service';
import { twoFactorRequired } from '../auth/two-factor.rules';
import { SECURITY_EVENT } from '../configuration.constants';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import { passwordChangeDue } from '../settings/sign-in.rules';
import { passwordHint, passwordProblem } from '../shared/password.rules';
import { SecurityEventsService, type RequestMeta } from '../shared/security-events.service';

/** A11 · My account: everyone signed in may open it (choice 20). Changes here are the user's own, logged in the security log. */
@Injectable()
export class AccountService {
  private readonly jwtMode: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly settings: SignInSettingsService,
    private readonly security: SecurityEventsService,
    config: ConfigService<Env, true>,
  ) {
    this.jwtMode = config.get('AUTH_MODE', { infer: true }) === 'jwt';
  }

  private async me(ctx: RequestContext) {
    return this.prisma.sysUser.findUniqueOrThrow({ where: { id: ctx.user.id } });
  }

  private who(ctx: RequestContext) {
    return { code: ctx.user.code, name: ctx.user.name };
  }

  async view(ctx: RequestContext) {
    const [user, settings, sessions, roles] = await Promise.all([
      this.me(ctx),
      this.settings.get(ctx.tenantId),
      this.prisma.sysSession.findMany({ where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActivityAt: 'desc' } }),
      this.prisma.sysRole.findMany({ where: { tenantId: ctx.tenantId, code: { in: ctx.user.roles } }, select: { code: true, name: true } }),
    ]);
    const required = twoFactorRequired(ctx.user.roles, settings.twoFactorRoles);
    const codesLeft = Array.isArray(user.recoveryCodes) ? user.recoveryCodes.length : 0;
    return {
      me: { code: user.code, name: user.name, email: user.email, roles: ctx.user.roles.map((c) => roles.find((r) => r.code === c)?.name ?? c) },
      signInOn: this.jwtMode,
      password: {
        hint: passwordHint(settings),
        changedAt: user.passwordChangedAt?.toISOString() ?? null,
        changeDue: passwordChangeDue(user.passwordChangedAt, user.createdAt, settings.passwordMaxAgeDays, new Date()),
      },
      twoFactor: { enabled: !!user.twoFactorEnabledAt, required, recoveryCodesLeft: user.twoFactorEnabledAt ? codesLeft : 0 },
      sessions: sessions.map((s) => ({
        id: s.id,
        device: s.device ?? 'Unknown device',
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        current: s.id === ctx.sessionId,
      })),
      idleMinutes: settings.idleMinutes,
      refreshDays: settings.refreshDays,
    };
  }

  /** The current password first; the new one meets the policy; other devices are signed out (rule 7). */
  async changePassword(ctx: RequestContext, current: string, next: string, meta: RequestMeta) {
    const user = await this.me(ctx);
    const settings = await this.settings.get(ctx.tenantId);
    if (!(await this.credentials.verifyPassword(user.passwordHash, current))) throw ValidationFailedError.field('currentPassword', 'That is not your current password.');
    if (current === next) throw ValidationFailedError.field('newPassword', 'Pick a password different from the current one.');
    const problem = passwordProblem(next, settings, user);
    if (problem) throw ValidationFailedError.field('newPassword', problem);
    const hash = await this.credentials.hashPassword(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { passwordHash: hash, passwordChangedAt: new Date() } });
      const ended = await this.credentials.endSessions(tx, user.id, 'PASSWORD_CHANGED', ctx.sessionId);
      await this.security.log(tx, ctx.tenantId, {
        kind: SECURITY_EVENT.PASSWORD_CHANGED,
        user: this.who(ctx),
        message: `${user.name} changed their password${ended ? `; signed out on ${ended} other device${ended === 1 ? '' : 's'}` : ''}`,
      }, meta);
    });
    return this.view(ctx);
  }

  /** Signs out one of the user's own devices (FR-SEC-065). */
  async endSession(ctx: RequestContext, sessionId: string, meta: RequestMeta) {
    const session = await this.prisma.sysSession.findFirst({ where: { id: sessionId, userId: ctx.user.id, revokedAt: null } });
    if (!session) throw new NotFoundError('Session');
    await this.prisma.sysSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'REVOKED' } });
    await this.security.log(this.prisma, ctx.tenantId, { kind: SECURITY_EVENT.SESSION_REVOKED, user: this.who(ctx), message: `${ctx.user.name} signed out ${session.device ?? 'a device'}` }, meta);
    return this.view(ctx);
  }

  async endOtherSessions(ctx: RequestContext, meta: RequestMeta) {
    const ended = await this.credentials.endSessions(this.prisma, ctx.user.id, 'REVOKED', ctx.sessionId);
    if (ended) await this.security.log(this.prisma, ctx.tenantId, { kind: SECURITY_EVENT.SESSION_REVOKED, user: this.who(ctx), message: `${ctx.user.name} signed out everywhere else (${ended} device${ended === 1 ? '' : 's'})` }, meta);
    return this.view(ctx);
  }

  /** Starts two-factor for someone whose roles do not require it (or who reset it): a new secret to scan. */
  async startTwoFactor(ctx: RequestContext) {
    const user = await this.me(ctx);
    if (user.twoFactorEnabledAt) throw new BusinessRuleError('TWO_FACTOR_ON', 'Two-factor is already on.');
    return this.credentials.startSetup(this.prisma, user);
  }

  async enableTwoFactor(ctx: RequestContext, code: string, meta: RequestMeta) {
    const user = await this.me(ctx);
    if (user.twoFactorEnabledAt) throw new BusinessRuleError('TWO_FACTOR_ON', 'Two-factor is already on.');
    if (!user.twoFactorSecret) throw new BusinessRuleError('NO_SETUP', 'Start the set-up first.');
    if (!this.credentials.checkTotp(user.twoFactorSecret, code)) throw ValidationFailedError.field('code', 'That code is not right. Type the code the app shows now.');
    const codes = this.credentials.newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { twoFactorEnabledAt: new Date(), recoveryCodes: codes.hashes } });
      await this.security.log(tx, ctx.tenantId, { kind: SECURITY_EVENT.TWO_FACTOR_ON, user: this.who(ctx), message: `${user.name} turned on two-factor sign-in` }, meta);
    });
    return { recoveryCodes: codes.plain, account: await this.view(ctx) };
  }

  /** Off only when no role requires it (rule 8); the password confirms it is really them. */
  async disableTwoFactor(ctx: RequestContext, password: string, meta: RequestMeta) {
    const user = await this.me(ctx);
    const settings = await this.settings.get(ctx.tenantId);
    if (twoFactorRequired(ctx.user.roles, settings.twoFactorRoles)) {
      throw new BusinessRuleError('TWO_FACTOR_REQUIRED', 'Your roles require two-factor, so it stays on. If you lose your phone, use a recovery code or ask the Administrator to reset it.');
    }
    if (!(await this.credentials.verifyPassword(user.passwordHash, password))) throw ValidationFailedError.field('password', 'That is not your current password.');
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { twoFactorSecret: null, twoFactorEnabledAt: null, recoveryCodes: Prisma.DbNull } });
      await this.security.log(tx, ctx.tenantId, { kind: SECURITY_EVENT.TWO_FACTOR_OFF, user: this.who(ctx), message: `${user.name} turned off two-factor sign-in` }, meta);
    });
    return this.view(ctx);
  }

  /** 8 new recovery codes; the old ones stop working. */
  async newRecoveryCodes(ctx: RequestContext, password: string, meta: RequestMeta) {
    const user = await this.me(ctx);
    if (!user.twoFactorEnabledAt) throw new BusinessRuleError('TWO_FACTOR_OFF', 'Turn on two-factor first.');
    if (!(await this.credentials.verifyPassword(user.passwordHash, password))) throw ValidationFailedError.field('password', 'That is not your current password.');
    const codes = this.credentials.newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { recoveryCodes: codes.hashes } });
      await this.security.log(tx, ctx.tenantId, { kind: SECURITY_EVENT.TWO_FACTOR_ON, user: this.who(ctx), message: `${user.name} made new recovery codes; the old ones stopped working` }, meta);
    });
    return { recoveryCodes: codes.plain, account: await this.view(ctx) };
  }
}
