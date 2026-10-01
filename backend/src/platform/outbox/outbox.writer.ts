import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../context/request-context';
import { assertInTransaction, type Tx } from '../prisma/prisma.service';
import { isValidEventName } from './outbox.rules';
import type { NewEvent } from './outbox.types';

/**
 * Saves events in the caller's transaction, so an event exists if and only if the change committed.
 * Delivery happens later in OutboxDispatcher. Never call another module directly.
 */
@Injectable()
export class OutboxWriter {
  async publish(tx: Tx, ctx: RequestContext, events: NewEvent[]): Promise<void> {
    assertInTransaction(tx, 'OutboxWriter.publish');
    if (events.length === 0) return;

    for (const event of events) {
      if (!isValidEventName(event.name)) {
        throw new Error(`Event name "${event.name}" must look like purchase.order.released`);
      }
    }

    const occurredAt = new Date();
    await tx.sysOutbox.createMany({
      data: events.map((event) => ({
        tenantId: ctx.tenantId,
        name: event.name,
        version: event.version ?? 1,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        actorCode: ctx.user.code,
        correlationId: ctx.correlationId,
        occurredAt,
        nextAttemptAt: occurredAt,
      })),
    });
  }
}
