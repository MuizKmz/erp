/**
 * The seeded events describe what already happened before 29 Sep: PO-0003 was drafted for SO-0003, goods were
 * received, balances cancelled. The module listeners (S10) must not act on that history again, or every seed would
 * draft a second PO for SO-0003. So each seeded event a listener cares about is marked handled by that listener.
 * Listener names must match purchase/sales-link/buy-to-order.listener.ts and sales/buy-to-order/buy-to-order.listener.ts.
 */
import type { SeedCtx } from './util';

export const SEEDED_LISTENERS: { event: string; handler: string }[] = [
  { event: 'sales.order.released', handler: 'purchase.draft-po-for-buy-to-order' },
  { event: 'purchase.buy_to_order.handled', handler: 'sales.buy-to-order-po' },
  { event: 'purchase.goods.received', handler: 'sales.buy-to-order-received' },
  { event: 'purchase.order.balance_cancelled', handler: 'sales.buy-to-order-cancelled' },
];

export async function markSeededEventsHandled(ctx: SeedCtx): Promise<number> {
  let marked = 0;
  for (const { event, handler } of SEEDED_LISTENERS) {
    const events = await ctx.prisma.sysOutbox.findMany({ where: { tenantId: ctx.tenantId, name: event }, select: { id: true } });
    if (events.length === 0) continue;
    const res = await ctx.prisma.sysEventHandled.createMany({
      data: events.map((e) => ({ eventId: e.id, handler, tenantId: ctx.tenantId })),
      skipDuplicates: true,
    });
    marked += res.count;
  }
  return marked;
}
