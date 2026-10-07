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
 * - Module listeners (OutboxConsumers.listen) get every event of their name once, whatever its status, and never
 *   change that status. A failing listener is retried with the same backoff; after 10 failures it skips that
 *   event and logs an error (kept in memory only in phase 1, so a restart tries again).
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;
  /** "eventId|handler" → failures so far and when to try again. */
  private readonly listenerFailures = new Map<string, { attempts: number; nextAttemptAt: Date }>();

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
      while (processed < BATCH_SIZE && (await this.listenOnce())) processed++;
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

  /** Delivers the oldest event a module listener has not handled yet. Returns false when there is nothing to do. */
  async listenOnce(): Promise<boolean> {
    for (const { eventName, handler, handle } of this.consumers.listenerPairs()) {
      const now = Date.now();
      const parked = [...this.listenerFailures.entries()]
        .filter(([key, f]) => key.endsWith(`|${handler}`) && f.nextAttemptAt.getTime() > now)
        .map(([key]) => key.slice(0, key.indexOf('|')));
      let claimed: SysOutbox | null = null;
      try {
        const done = await this.prisma.$transaction(
          async (tx) => {
            const due = await tx.$queryRaw<{ id: string }[]>`
              SELECT o.id FROM sys_outbox o
              WHERE o.name = ${eventName}
                AND NOT EXISTS (SELECT 1 FROM sys_event_handled h WHERE h.eventId = o.id AND h.handler = ${handler})
                ${parked.length ? Prisma.sql`AND o.id NOT IN (${Prisma.join(parked)})` : Prisma.empty}
              ORDER BY o.seq
              LIMIT 1
              FOR UPDATE SKIP LOCKED`;
            const id = due[0]?.id;
            if (!id) return false;
            claimed = await tx.sysOutbox.findUniqueOrThrow({ where: { id } });
            await handle(toEnvelope(claimed), tx);
            await tx.sysEventHandled.create({ data: { eventId: id, handler, tenantId: claimed.tenantId } });
            return true;
          },
          { timeout: 30_000 },
        );
        if (done) {
          this.listenerFailures.delete(`${(claimed as SysOutbox | null)?.id}|${handler}`);
          return true;
        }
      } catch (err) {
        const event = claimed as SysOutbox | null;
        if (!event) throw err;
        this.recordListenerFailure(event, handler, err);
        return true;
      }
    }
    return false;
  }

  private recordListenerFailure(event: SysOutbox, handler: string, err: unknown): void {
    const key = `${event.id}|${handler}`;
    const attempts = (this.listenerFailures.get(key)?.attempts ?? 0) + 1;
    const next = afterFailure(attempts, new Date());
    const nextAttemptAt = next.status === 'FAILED' ? new Date(8.64e15) : next.nextAttemptAt;
    this.listenerFailures.set(key, { attempts, nextAttemptAt });
    const level = next.status === 'FAILED' ? 'error' : 'warn';
    const outcome = next.status === 'FAILED' ? 'gave up until restart' : 'will retry';
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    this.logger[level](`${handler} failed on ${event.name} ${event.id} (attempt ${attempts}, ${outcome}): ${detail}`);
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
