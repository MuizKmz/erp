import type { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

/** An event as stored and delivered. Matches the envelope in docs/integration/EVENTS.md. */
export interface OutboxEnvelope {
  id: string;
  name: string;
  version: number;
  tenantId: string;
  occurredAt: string;
  actor: { userCode: string };
  correlationId: string;
  aggregateType: string;
  aggregateId: string;
  /** Codes and snapshots; money and quantities as strings ("4180.00", "95.0000"). */
  payload: Prisma.JsonValue;
}

export interface NewEvent {
  name: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  version?: number;
}

/**
 * A consumer. Runs inside the dispatcher's transaction: write your own tables with `tx` and the
 * "already handled" record commits together with your changes, so redelivery is a no-op.
 */
export type OutboxHandlerFn = (event: OutboxEnvelope, tx: Tx) => Promise<void>;

export interface OutboxHandler {
  /** Unique, stable name, e.g. "purchase.draft-po-from-sales-order". Stored in sys_event_handled. */
  handler: string;
  handle: OutboxHandlerFn;
}
