import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import type { FieldChange } from '../../platform/activity/audit.rules';
import type { RequestContext } from '../../platform/context/request-context';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import type { Tx } from '../../platform/prisma/prisma.service';
import type { ConfigEntityType } from '../configuration.constants';

export interface ConfigChange {
  entityType: ConfigEntityType;
  entityId: string;
  /** The record's code (CLB, HQ): it never changes. */
  code: string;
  /** Short machine word: created, updated, deactivated, activated. */
  action: string;
  /** Sentence for the Activity panel. */
  message: string;
  /** Old and new values, kept with the activity line (rule 9). */
  changes?: FieldChange[];
  /** The config.* event to publish. */
  event: string;
  /** The record after the change, as the event carries it. */
  snapshot: Prisma.InputJsonValue;
}

/**
 * Every Configuration change, in the caller's transaction: the activity line with old and new values and the config.*
 * event (CLAUDE.md → Phase 4, module boundaries rule 4).
 */
@Injectable()
export class ConfigRecordsService {
  constructor(
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
  ) {}

  async record(tx: Tx, ctx: RequestContext, change: ConfigChange): Promise<void> {
    await this.activity.log(tx, ctx, {
      entityType: change.entityType,
      entityId: change.entityId,
      docNo: change.code,
      action: change.action,
      message: change.message,
      ...(change.changes?.length && { data: { changes: change.changes.map((c) => ({ ...c })) } }),
    });
    await this.outbox.publish(tx, ctx, [
      {
        name: change.event,
        aggregateType: change.entityType,
        aggregateId: change.entityId,
        payload: { code: change.code, action: change.action, changedFields: (change.changes ?? []).map((c) => c.field), snapshot: change.snapshot },
      },
    ]);
  }
}
