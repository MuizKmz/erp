/**
 * The seeded events describe what already happened before 29 Sep: PO-0003 was drafted for SO-0003, orders were
 * released and delivered, goods were received. The module listeners must not act on that history again, or every
 * seed would draft a second PO for SO-0003. So each seeded event a listener cares about is marked handled by that
 * listener, and what those listeners would have built is seeded directly (pur_sales_demand).
 *
 * Events and their marks are written in one transaction, so an API that is running while you seed never sees a
 * seeded event it has not been told about.
 * Listener names must match purchase/sales-link/*.listener.ts and sales/buy-to-order/buy-to-order.listener.ts.
 */
import type { Prisma } from '@prisma/client';
import type { SeedCtx } from './util';

export const SEEDED_LISTENERS: { event: string; handler: string }[] = [
  { event: 'sales.order.released', handler: 'purchase.draft-po-for-buy-to-order' },
  { event: 'sales.order.released', handler: 'purchase.sales-demand-order' },
  { event: 'sales.shipment.requested', handler: 'purchase.sales-demand-shipped' },
  { event: 'sales.order.balance_cancelled', handler: 'purchase.sales-demand-cancelled' },
  { event: 'purchase.buy_to_order.handled', handler: 'sales.buy-to-order-po' },
  { event: 'purchase.goods.received', handler: 'sales.buy-to-order-received' },
  { event: 'purchase.order.balance_cancelled', handler: 'sales.buy-to-order-cancelled' },
];

/**
 * Purchase's copy of sales-order demand, as its listener would have kept it from the seeded history: every released
 * (not migrated) sales order, one row per line, with what is delivered and cancelled so far. SO-0006's 10 chairs
 * were delivered in the old system, so they are counted here even though no event says so.
 */
export async function seedPurchaseSalesDemand(ctx: SeedCtx): Promise<void> {
  const orders = await ctx.prisma.salSalesOrder.findMany({
    where: { tenantId: ctx.tenantId, isMigrated: false, releasedAt: { not: null } },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { docNo: 'asc' },
  });
  await ctx.prisma.purSalesDemand.createMany({
    data: orders.flatMap((o) =>
      o.lines.map((l) => ({
        tenantId: ctx.tenantId, salesOrderId: o.id, soNo: o.docNo, soLineNo: l.lineNo, soDate: o.docDate, customerName: o.customerName,
        soTotal: o.total, branchCode: o.branchCode, itemCode: l.itemCode, uomCode: l.uomCode, orderedQty: l.orderedQty,
        deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty, isBuyToOrder: l.isBuyToOrder, neededBy: o.deliveryWantedBy,
      })),
    ),
  });
}

/** Saves seeded outbox events and, in the same transaction, marks each as handled by the listeners above. */
export async function createSeededEvents(ctx: SeedCtx, events: Prisma.SysOutboxCreateManyInput[]): Promise<void> {
  const handled = events.flatMap((e) => {
    if (!e.id) throw new Error(`Seeded event ${e.name} needs an id to be marked handled`);
    return SEEDED_LISTENERS.filter((l) => l.event === e.name).map((l) => ({ eventId: e.id!, handler: l.handler, tenantId: e.tenantId }));
  });
  await ctx.prisma.$transaction([
    ctx.prisma.sysOutbox.createMany({ data: events }),
    ctx.prisma.sysEventHandled.createMany({ data: handled, skipDuplicates: true }),
  ]);
}
