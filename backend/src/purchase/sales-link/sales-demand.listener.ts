import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dec } from '../../platform/http/decimal';
import { OutboxConsumers } from '../../platform/outbox/outbox.consumers';
import type { OutboxEnvelope } from '../../platform/outbox/outbox.types';
import type { Tx } from '../../platform/prisma/prisma.service';
import { readReleasedSalesOrder } from './buy-to-order.rules';
import { demandRowsFromRelease, matchLines, readLineQtyEvent } from './sales-demand.rules';

/** Sales events that change what Purchase sees as open sales-order demand. */
export const SALES_DEMAND_EVENT = {
  RELEASED: 'sales.order.released',
  SHIPPED: 'sales.shipment.requested',
  BALANCE_CANCELLED: 'sales.order.balance_cancelled',
} as const;

/** Listener names, stored in sys_event_handled. The seed marks its own history as handled under these names. */
export const SALES_DEMAND_LISTENER = {
  RELEASED: 'purchase.sales-demand-order',
  SHIPPED: 'purchase.sales-demand-shipped',
  BALANCE_CANCELLED: 'purchase.sales-demand-cancelled',
} as const;

/**
 * Keeps pur_sales_demand, Purchase's copy of open sales-order needs, from Sales events: a released order adds its
 * lines; a confirmed delivery and a released cancel order lower what is still open. P04 reads only this table.
 */
@Injectable()
export class SalesDemandListener implements OnModuleInit {
  private readonly logger = new Logger(SalesDemandListener.name);

  constructor(private readonly consumers: OutboxConsumers) {}

  onModuleInit(): void {
    this.consumers.listen(SALES_DEMAND_EVENT.RELEASED, SALES_DEMAND_LISTENER.RELEASED, (e, tx) => this.onReleased(e, tx));
    this.consumers.listen(SALES_DEMAND_EVENT.SHIPPED, SALES_DEMAND_LISTENER.SHIPPED, (e, tx) => this.onLineQty(e, tx, 'deliveredQty'));
    this.consumers.listen(SALES_DEMAND_EVENT.BALANCE_CANCELLED, SALES_DEMAND_LISTENER.BALANCE_CANCELLED, (e, tx) => this.onLineQty(e, tx, 'cancelledQty'));
  }

  /** `sales.order.released`: one row per order line. Running it again only refreshes the order's details. */
  async onReleased(event: OutboxEnvelope, tx: Tx): Promise<void> {
    const order = readReleasedSalesOrder(event.payload);
    if (!order) {
      this.logger.warn(`${event.name} ${event.id} has no usable sales order in its payload; ignored`);
      return;
    }
    for (const r of demandRowsFromRelease(order, event.occurredAt)) {
      const details = {
        salesOrderId: event.aggregateId,
        soDate: new Date(`${r.soDate}T00:00:00.000Z`),
        customerName: r.customerName,
        soTotal: dec(r.soTotal),
        branchCode: r.branchCode,
        itemCode: r.itemCode,
        uomCode: r.uomCode,
        orderedQty: dec(r.orderedQty),
        isBuyToOrder: r.isBuyToOrder,
        neededBy: r.neededBy ? new Date(`${r.neededBy}T00:00:00.000Z`) : null,
      };
      await tx.purSalesDemand.upsert({
        where: { tenantId_soNo_soLineNo: { tenantId: event.tenantId, soNo: r.soNo, soLineNo: r.soLineNo } },
        create: { tenantId: event.tenantId, soNo: r.soNo, soLineNo: r.soLineNo, ...details },
        update: details,
      });
    }
  }

  /**
   * `sales.shipment.requested` / `sales.order.balance_cancelled`: adds to delivered or cancelled. A line Purchase
   * has no row for is refused, so the event is retried once the order's release has been handled.
   */
  async onLineQty(event: OutboxEnvelope, tx: Tx, field: 'deliveredQty' | 'cancelledQty'): Promise<void> {
    const e = readLineQtyEvent(event.payload);
    if (!e) {
      this.logger.warn(`${event.name} ${event.id} has no usable order lines in its payload; ignored`);
      return;
    }
    const rows = await tx.purSalesDemand.findMany({ where: { tenantId: event.tenantId, soNo: e.soNo }, select: { id: true, soLineNo: true, itemCode: true } });
    const { updates, missing } = matchLines(rows, e.lines);
    if (missing.length) throw new Error(`${e.soNo}: ${missing.join(', ')} not in Purchase's sales demand yet`);
    for (const u of updates) {
      await tx.purSalesDemand.update({ where: { id: u.id }, data: field === 'deliveredQty' ? { deliveredQty: { increment: u.add } } : { cancelledQty: { increment: u.add } } });
    }
  }
}
