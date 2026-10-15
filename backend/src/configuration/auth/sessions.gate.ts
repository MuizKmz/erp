import { Injectable } from '@nestjs/common';
import type { AccessClaims, GateAnswer, SessionGate } from '../../platform/context/session-gate';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SECURITY_EVENT } from '../configuration.constants';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import { SecurityEventsService } from '../shared/security-events.service';
import { activityWorthNoting, sessionProblem } from './auth.rules';

/**
 * The platform's JWT guard asks here on every request (AUTH_MODE=jwt): the session must still be open, not past its
 * 30 days and not idle for 30 minutes (FR-SEC-065). Signing out, revoking and deactivating therefore work at once.
 */
@Injectable()
export class SessionsGate implements SessionGate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SignInSettingsService,
    private readonly security: SecurityEventsService,
  ) {}

  async pass(claims: AccessClaims): Promise<GateAnswer> {
    const session = await this.prisma.sysSession.findFirst({ where: { id: claims.sid, tenantId: claims.tid, userId: claims.sub } });
    if (!session) return { ok: false, code: 'SIGNED_OUT', message: 'You were signed out. Sign in again.' };
    const now = new Date();
    const { idleMinutes } = await this.settings.get(claims.tid);
    const problem = sessionProblem(session, now, idleMinutes);
    if (problem) {
      if (problem.reason !== 'REVOKED') {
        const ended = await this.prisma.sysSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokedReason: problem.reason } });
        if (ended.count) {
          const user = await this.prisma.sysUser.findUnique({ where: { id: claims.sub }, select: { code: true, name: true } });
          await this.security.log(this.prisma, claims.tid, { kind: SECURITY_EVENT.SESSION_ENDED, user, message: problem.message.replace(/ Sign in again\.$/, '') }, { ipAddress: session.ipAddress, userAgent: session.userAgent });
        }
      }
      return { ok: false, code: problem.reason === 'IDLE' ? 'SIGNED_OUT_IDLE' : 'SIGNED_OUT', message: problem.message };
    }
    if (activityWorthNoting(session.lastActivityAt, now)) {
      await this.prisma.sysSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastActivityAt: now } });
    }
    return { ok: true };
  }
}
