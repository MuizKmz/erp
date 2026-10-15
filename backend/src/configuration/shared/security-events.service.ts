import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import type { Tx } from '../../platform/prisma/prisma.service';

export interface SecurityEntry {
  kind: string;
  /** Whose account it is about. */
  user: { code: string; name: string };
  /** "Roles of Aina Rahman changed: added Auditor". */
  message: string;
  data?: Prisma.InputJsonValue;
}

/**
 * The security log (sys_security_event, NFR-SEC-012; choice 15): role changes and deactivations now, sign-ins, lockouts,
 * password and two-factor changes from A5. Append only: nothing in the application changes or deletes a row (rule 9).
 */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly clock: ClockService) {}

  async record(tx: Tx, ctx: RequestContext, entry: SecurityEntry): Promise<void> {
    await tx.sysSecurityEvent.create({
      data: {
        tenantId: ctx.tenantId,
        kind: entry.kind,
        userCode: entry.user.code,
        userName: entry.user.name,
        actorCode: ctx.user.code,
        message: entry.message,
        data: entry.data,
        createdAt: this.clock.now(),
      },
    });
  }
}
