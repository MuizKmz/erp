import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma, type SysOutbox } from '@prisma/client';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxConsumers } from './outbox.consumers';
import { afterFailure } from './outbox.rules';
import type { OutboxEnvelope } from './outbox.types';

const INTERVAL_NAME = 'outbox-dispatcher';
const BATCH_SIZE = 50;

function toEnvelope(row: SysOutbox): OutboxEnvelope {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    tenantId: row.tenantId,
    occurredAt: row.occurredAt.toISOString(),
    actor: { userCode: row.actorCode },
    correlationId: row.correlationId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload,
  };
}

/**
 * Phase 1 in-process dispatcher: every OUTBOX_INTERVAL_MS it delivers pending events to their subscribers.
 * - At least once; each (event, handler) is recorded in sys_event_handled so redelivery is a no-op.
 * - Each event is claimed with FOR UPDATE SKIP LOCKED, so two API instances never deliver the same one at once.
 * - A failure is retried with backoff; after 10 failures the event is marked FAILED.
 * - Events with no subscriber are left PENDING (the receiving module is not connected yet).
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: OutboxConsumers,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('OUTBOX_DISPATCH', { infer: true })) {
      this.logger.log('Outbox dispatcher is off (OUTBOX_DISPATCH=off)');
      return;
    }
    const every = this.config.get('OUTBOX_INTERVAL_MS', { infer: true });
    this.scheduler.addInterval(INTERVAL_NAME, setInterval(() => void this.tick(), every));
    this.logger.log(`Outbox dispatcher runs every ${every} ms`);
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) this.scheduler.deleteInterval(INTERVAL_NAME);
  }

  /** One polling round. Skipped if the previous round is still busy. Returns how many events were processed. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (processed < BATCH_SIZE && (await this.dispatchOne())) processed++;
    } catch (err) {
      this.logger.error('Outbox round failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
    return processed;
  }

  /** Claims and delivers the oldest due event. Returns false when there is nothing to do. */
  async dispatchOne(): Promise<boolean> {
    const names = this.consumers.eventNames();
    if (names.length === 0) return false;

    let claimed: SysOutbox | null = null;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const due = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM sys_outbox
            WHERE status = 'PENDING' AND nextAttemptAt <= UTC_TIMESTAMP(3) AND name IN (${Prisma.join(names)})
            ORDER BY seq
            LIMIT 1
            FOR UPDATE SKIP LOCKED`;
          const id = due[0]?.id;
          if (!id) return false;

          claimed = await tx.sysOutbox.findUniqueOrThrow({ where: { id } });
          const envelope = toEnvelope(claimed);

          for (const { handler, handle } of this.consumers.handlersFor(claimed.name)) {
            const done = await tx.sysEventHandled.findUnique({ where: { eventId_handler: { eventId: id, handler } } });
            if (done) continue;
            await handle(envelope, tx);
            await tx.sysEventHandled.create({ data: { eventId: id, handler, tenantId: claimed.tenantId } });
          }

          await tx.sysOutbox.update({
            where: { id },
            data: { status: 'DISPATCHED', dispatchedAt: new Date(), attempts: { increment: 1 }, lastError: null },
          });
          return true;
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      const event = claimed as SysOutbox | null;
      if (!event) throw err;
      await this.recordFailure(event, err);
      return true;
    }
  }

  private async recordFailure(event: SysOutbox, err: unknown): Promise<void> {
    const attempts = event.attempts + 1;
    const next = afterFailure(attempts, new Date());
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    await this.prisma.sysOutbox.update({
      where: { id: event.id },
      data: { attempts, status: next.status, nextAttemptAt: next.nextAttemptAt, lastError: message.slice(0, 5000) },
    });
    const level = next.status === 'FAILED' ? 'error' : 'warn';
    this.logger[level](`${event.name} ${event.id} failed (attempt ${attempts}) → ${next.status}: ${String(err)}`);
  }
}
