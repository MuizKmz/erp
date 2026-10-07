import { Injectable } from '@nestjs/common';
import type { OutboxHandler, OutboxHandlerFn } from './outbox.types';

/**
 * Who listens to which event. A module subscribes at start-up (onModuleInit).
 * Events with no subscriber are not touched by the dispatcher: they wait in sys_outbox until the receiving
 * module is connected. hasSubscribers() lets a screen show "Inventory is not connected yet…".
 *
 * Two kinds of consumer:
 * - subscribe(): the receiving system (Inventory, Finance, LHDN …). Delivery marks the event DISPATCHED.
 * - listen(): another ERP module that also reacts (Purchase to sales.order.released, Sales to
 *   purchase.goods.received). Listeners never change the event's status, so "waiting for Inventory" stays true
 *   until Inventory itself takes the event. Progress per listener is kept in sys_event_handled.
 */
@Injectable()
export class OutboxConsumers {
  private readonly byEvent = new Map<string, OutboxHandler[]>();
  private readonly listeners = new Map<string, OutboxHandler[]>();

  subscribe(eventName: string, handler: string, handle: OutboxHandlerFn): void {
    const list = this.byEvent.get(eventName) ?? [];
    if (list.some((h) => h.handler === handler)) {
      throw new Error(`Handler "${handler}" is already subscribed to ${eventName}`);
    }
    list.push({ handler, handle });
    this.byEvent.set(eventName, list);
  }

  handlersFor(eventName: string): OutboxHandler[] {
    return this.byEvent.get(eventName) ?? [];
  }

  hasSubscribers(eventName: string): boolean {
    return this.handlersFor(eventName).length > 0;
  }

  eventNames(): string[] {
    return [...this.byEvent.keys()];
  }

  listen(eventName: string, handler: string, handle: OutboxHandlerFn): void {
    const list = this.listeners.get(eventName) ?? [];
    if (list.some((h) => h.handler === handler)) {
      throw new Error(`Listener "${handler}" is already listening to ${eventName}`);
    }
    list.push({ handler, handle });
    this.listeners.set(eventName, list);
  }

  /** Every (event, listener) pair, in the order they were registered. */
  listenerPairs(): (OutboxHandler & { eventName: string })[] {
    return [...this.listeners.entries()].flatMap(([eventName, list]) => list.map((h) => ({ eventName, ...h })));
  }
}
