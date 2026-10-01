import { Injectable } from '@nestjs/common';
import type { OutboxHandler, OutboxHandlerFn } from './outbox.types';

/**
 * Who listens to which event. A module subscribes at start-up (onModuleInit).
 * Events with no subscriber are not touched by the dispatcher: they wait in sys_outbox until the receiving
 * module is connected. hasSubscribers() lets a screen show "Inventory is not connected yet…".
 */
@Injectable()
export class OutboxConsumers {
  private readonly byEvent = new Map<string, OutboxHandler[]>();

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
}
