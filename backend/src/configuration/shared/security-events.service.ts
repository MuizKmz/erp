import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../platform/context/request-context';
import type { PrismaService, Tx } from '../../platform/prisma/prisma.service';

export interface SecurityEntry {
  kind: string;
  /** Whose account it is about. */
  user: { code: string; name: string } | null;
  /** "Roles of Aina Rahman changed: added Auditor". */
  message: string;
  data?: Prisma.InputJsonValue;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The security log (sys_security_event, NFR-SEC-012; choice 15): sign-ins, failures, lockouts and sign-outs, role and
 * account changes; password and two-factor changes from A6. Append only: nothing in the application changes or deletes
 * a row (rule 9). Times are real times, not the demo's business date (DEV_TODAY).
 */
@Injectable()
export class SecurityEventsService {
  /** A change an administrator made, in their transaction. */
  async record(tx: Tx, ctx: RequestContext, entry: SecurityEntry): Promise<void> {
    await this.write(tx, ctx.tenantId, entry, { actorCode: ctx.user.code });
  }

  /** Something that happened at sign-in, before anyone is signed in (or about the signed-in user themselves). */
  async log(db: Tx | PrismaService, tenantId: string, entry: SecurityEntry, meta: RequestMeta): Promise<void> {
    await this.write(db, tenantId, entry, meta);
  }

  private async write(db: Tx | PrismaService, tenantId: string, entry: SecurityEntry, extra: Partial<RequestMeta> & { actorCode?: string }): Promise<void> {
    await db.sysSecurityEvent.create({
      data: {
        tenantId,
        kind: entry.kind,
        userCode: entry.user?.code ?? null,
        userName: entry.user?.name ?? null,
        actorCode: extra.actorCode ?? null,
        message: entry.message,
        ipAddress: extra.ipAddress ?? null,
        userAgent: extra.userAgent ?? null,
        data: entry.data,
        createdAt: new Date(),
      },
    });
  }
}
