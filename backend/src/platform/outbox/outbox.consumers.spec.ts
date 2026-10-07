import { OutboxConsumers } from './outbox.consumers';

const noop = async () => undefined;

describe('OutboxConsumers', () => {
  it('keeps module listeners apart from the receiving systems', () => {
    const c = new OutboxConsumers();
    c.listen('sales.order.released', 'purchase.draft-po-for-buy-to-order', noop);
    c.listen('purchase.goods.received', 'sales.buy-to-order-received', noop);
    // A listener does not make the event "delivered": Inventory still counts as not connected.
    expect(c.hasSubscribers('purchase.goods.received')).toBe(false);
    expect(c.eventNames()).toEqual([]);
    expect(c.listenerPairs().map((p) => `${p.eventName} → ${p.handler}`)).toEqual([
      'sales.order.released → purchase.draft-po-for-buy-to-order',
      'purchase.goods.received → sales.buy-to-order-received',
    ]);
  });

  it('refuses the same listener twice', () => {
    const c = new OutboxConsumers();
    c.listen('sales.order.released', 'x', noop);
    expect(() => c.listen('sales.order.released', 'x', noop)).toThrow('already listening');
  });
});
