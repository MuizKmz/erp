import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import type { RequestContext } from '../../platform/context/request-context';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import type { Tx } from '../../platform/prisma/prisma.service';
import type { CoreEntityType } from '../core.constants';
import type { FieldChange } from './audit.rules';

export interface CoreChange {
  entityType: CoreEntityType;
  entityId: string;
  /** The record's business code (FB-OAK-01, C-0012): what other systems match on. */
  code: string;
  /** Short machine word: created, updated, blocked, activated … */
  action: string;
  /** Sentence for the Activity panel. */
  message: string;
  /** What changed, kept with the activity line (before and after values). */
  changes?: FieldChange[];
  /** The mdm.* event to publish. */
  event: string;
  /** The record after the change, as the event carries it (codes and plain values). */
  snapshot: Prisma.InputJsonValue;
  /** Extra payload fields, e.g. the enquiry a new customer came from. */
  extra?: Record<string, Prisma.InputJsonValue | null>;
}

/**
 * Every Core change, in the caller's transaction: the activity line with the changed fields and the mdm.* event
 * (CLAUDE.md → Phase 3, module boundaries rule 5).
 */
@Injectable()
export class CoreRecordsService {
  constructor(
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
  ) {}

  async record(tx: Tx, ctx: RequestContext, change: CoreChange): Promise<void> {
    await this.activity.log(tx, ctx, {
      entityType: change.entityType,
      entityId: change.entityId,
      docNo: change.code,
      action: change.action,
      message: change.message,
      ...(change.changes?.length && { data: { changes: change.changes.map((c) => ({ ...c })) } }),
    });
    await this.outbox.publish(tx, ctx, [{
      name: change.event,
      aggregateType: change.entityType,
      aggregateId: change.entityId,
      payload: {
        code: change.code,
        ...change.extra,
        changedFields: (change.changes ?? []).map((c) => c.field),
        snapshot: change.snapshot,
      },
    }]);
  }
}
