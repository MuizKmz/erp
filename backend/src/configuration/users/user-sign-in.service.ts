import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CredentialsService } from '../auth/credentials.service';
import { CONFIG_ENTITY, SECURITY_EVENT } from '../configuration.constants';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import { SecurityEventsService } from '../shared/security-events.service';
import { UsersQuery } from './users.query';

/**
 * A07 · Sign-in card: what the Administrator does for someone who cannot sign in (FR-SEC-063 to 065; choice 13).
 * Each writes the user's activity line and the security log; none touches roles or branches.
 */
@Injectable()
export class UserSignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly settings: SignInSettingsService,
    private readonly activity: ActivityService,
    private readonly security: SecurityEventsService,
    private readonly query: UsersQuery,
  ) {}

  private async active(ctx: RequestContext, id: string) {
    const user = await this.query.findUser(ctx, id);
    if (!user.isActive) throw new BusinessRuleError('USER_INACTIVE', `${user.name} is inactive. Activate the user first.`);
    return user;
  }

  /** A reset link, or a set-password link when they never had a password; written to the email log (choice 10). */
  async sendLink(ctx: RequestContext, id: string) {
    const user = await this.active(ctx, id);
    const settings = await this.settings.get(ctx.tenantId);
    const kind = user.passwordHash ? 'RESET_PASSWORD' : 'SET_PASSWORD';
    const what = kind === 'RESET_PASSWORD' ? 'reset link' : 'set-password link';
    await this.prisma.$transaction(async (tx) => {
      await this.credentials.issueLink(tx, user, kind, settings.linkMinutes, ctx.user.code);
      const message = `Password ${what} sent to ${user.email}`;
      await this.activity.log(tx, ctx, { entityType: CONFIG_ENTITY.USER, entityId: user.id, docNo: user.code, action: 'link_sent', message });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.LINK_SENT, user: { code: user.code, name: user.name }, message });
    });
    return this.query.detail(ctx, id);
  }

  /** Signs the user out on every device (FR-SEC-065). */
  async revokeSessions(ctx: RequestContext, id: string) {
    const user = await this.query.findUser(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      const ended = await this.credentials.endSessions(tx, user.id, 'REVOKED');
      const message = ended ? `${user.name} signed out on ${ended} device${ended === 1 ? '' : 's'}` : `${user.name} was not signed in anywhere`;
      await this.activity.log(tx, ctx, { entityType: CONFIG_ENTITY.USER, entityId: user.id, docNo: user.code, action: 'sessions_revoked', message });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.SESSION_REVOKED, user: { code: user.code, name: user.name }, message });
    });
    return this.query.detail(ctx, id);
  }

  /** A lost phone: two-factor off and its secret and recovery codes gone; set up again at the next sign-in when a role needs it (choice 13). */
  async resetTwoFactor(ctx: RequestContext, id: string) {
    const user = await this.active(ctx, id);
    if (!user.twoFactorEnabledAt && !user.twoFactorSecret) throw new BusinessRuleError('TWO_FACTOR_OFF', `${user.name} has no two-factor to reset.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { twoFactorSecret: null, twoFactorEnabledAt: null, recoveryCodes: Prisma.DbNull } });
      const ended = await this.credentials.endSessions(tx, user.id, 'TWO_FACTOR_RESET');
      const message = `Two-factor of ${user.name} reset${ended ? `; signed out on ${ended} device${ended === 1 ? '' : 's'}` : ''}`;
      await this.activity.log(tx, ctx, { entityType: CONFIG_ENTITY.USER, entityId: user.id, docNo: user.code, action: 'two_factor_reset', message });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.TWO_FACTOR_RESET, user: { code: user.code, name: user.name }, message });
    });
    return this.query.detail(ctx, id);
  }

  /** Lifts a lockout before it runs out (FR-SEC-062). */
  async unlock(ctx: RequestContext, id: string) {
    const user = await this.active(ctx, id);
    if (!user.lockedUntil || user.lockedUntil.getTime() <= Date.now()) {
      if (user.failedSignIns === 0) throw new BusinessRuleError('NOT_LOCKED', `${user.name} is not locked.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUser.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null } });
      const message = `${user.name} unlocked`;
      await this.activity.log(tx, ctx, { entityType: CONFIG_ENTITY.USER, entityId: user.id, docNo: user.code, action: 'unlocked', message });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.UNLOCKED, user: { code: user.code, name: user.name }, message });
    });
    return this.query.detail(ctx, id);
  }
}
