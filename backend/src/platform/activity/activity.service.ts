import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClockService } from '../clock/clock.service';
import type { RequestContext } from '../context/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface ActivityEntry {
  entityType: string;
  entityId: string;
  docNo?: string | null;
  /** Short machine word: created, submitted, approved, rejected, released … */
  action: string;
  /** Sentence shown in the Activity panel: "Released and emailed to Kilang Kain Jaya Sdn Bhd". */
  message: string;
  comment?: string | null;
  data?: Prisma.InputJsonValue;
}

export interface ActivityItem {
  id: string;
  action: string;
  message: string;
  comment: string | null;
  userCode: string;
  userName: string;
  at: string;
}

/** Writes sys_activity in the same transaction as the change it describes. */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async log(tx: Tx, ctx: RequestContext, entry: ActivityEntry): Promise<void> {
    await tx.sysActivity.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        docNo: entry.docNo ?? null,
        action: entry.action,
        message: entry.message,
        comment: entry.comment ?? null,
        data: entry.data,
        userCode: ctx.user.code,
        userName: ctx.user.name,
        createdAt: this.clock.now(),
      },
    });
  }

  /** Newest first, for a document's Activity panel. */
  async listFor(tenantId: string, entityType: string, entityId: string): Promise<ActivityItem[]> {
    const rows = await this.prisma.sysActivity.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      message: r.message,
      comment: r.comment,
      userCode: r.userCode,
      userName: r.userName,
      at: r.createdAt.toISOString(),
    }));
  }
}
