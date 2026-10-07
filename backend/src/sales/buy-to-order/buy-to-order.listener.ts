import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { OutboxConsumers } from '../../platform/outbox/outbox.consumers';
import type { OutboxEnvelope } from '../../platform/outbox/outbox.types';
import type { Tx } from '../../platform/prisma/prisma.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { allocateToLines, qtyText, readBuyToOrderHandled, readPurchaseQtyEvent } from './buy-to-order.rules';

/** Purchase events Sales listens to (EVENTS.md). Names are Purchase's; Sales never imports Purchase code. */
export const PURCHASE_EVENT = {
  BUY_TO_ORDER_HANDLED: 'purchase.buy_to_order.handled',
  GOODS_RECEIVED: 'purchase.goods.received',
  BALANCE_CANCELLED: 'purchase.order.balance_cancelled',
} as const;

/** Listener names, stored in sys_event_handled. The seed marks its own history as handled under these names. */
export const SALES_LISTENER = {
  PO_DRAFTED: 'sales.buy-to-order-po',
  RECEIVED: 'sales.buy-to-order-received',
  CANCELLED: 'sales.buy-to-order-cancelled',
} as const;

const SYSTEM = { code: 'SYSTEM', name: 'System' } as const;

/**
 * Buy-to-order status on sales order lines (S10). Purchase says which PO a line is on, what arrived and what it
 * cancelled; Sales keeps those numbers on the line (purchaseOrderNo, purchaseReceivedQty, purchaseCancelledQty) and
 * writes a line in the order's activity. The order's version is not bumped: these are Purchase's facts, not edits.
 */
@Injectable()
export class SalesBuyToOrderListener implements OnModuleInit {
  private readonly logger = new Logger(SalesBuyToOrderListener.name);

  constructor(
    private readonly consumers: OutboxConsumers,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    this.consumers.listen(PURCHASE_EVENT.BUY_TO_ORDER_HANDLED, SALES_LISTENER.PO_DRAFTED, (e, tx) => this.onPoDrafted(e, tx));
    this.consumers.listen(PURCHASE_EVENT.GOODS_RECEIVED, SALES_LISTENER.RECEIVED, (e, tx) => this.onPurchaseQty(e, tx, 'received'));
    this.consumers.listen(PURCHASE_EVENT.BALANCE_CANCELLED, SALES_LISTENER.CANCELLED, (e, tx) => this.onPurchaseQty(e, tx, 'cancelled'));
  }

  /** `purchase.buy_to_order.handled`: puts the PO number (or the reason there is none) on each order line. */
  async onPoDrafted(event: OutboxEnvelope, tx: Tx): Promise<void> {
    const answer = readBuyToOrderHandled(event.payload);
    if (!answer) return this.ignore(event);
    const order = await tx.salSalesOrder.findFirst({
      where: { tenantId: event.tenantId, docNo: answer.soNo },
      orderBy: { revision: 'desc' },
      include: { lines: true },
    });
    if (!order) return this.ignore(event);

    for (const a of answer.lines) {
      const line = order.lines.find((l) => l.lineNo === a.soLineNo && l.itemCode === a.itemCode);
      if (!line) continue;
      await tx.salSalesOrderLine.update({ where: { id: line.id }, data: { purchaseOrderNo: a.poNo, purchaseProblem: a.poNo ? null : a.problem } });
    }
    const byPo = new Map<string, string[]>();
    for (const a of answer.lines.filter((x) => x.poNo)) byPo.set(a.poNo!, [...(byPo.get(a.poNo!) ?? []), a.itemCode]);
    const messages = [
      ...[...byPo].map(([poNo, items]) => `Purchase drafted ${poNo} for the buy-to-order line${items.length > 1 ? 's' : ''} (${items.join(', ')})`),
      ...answer.lines.filter((x) => !x.poNo).map((x) => `Purchase did not draft a PO for ${x.itemCode}: ${x.problem ?? 'no reason given'}`),
    ];
    for (const message of messages) {
      await this.activity.log(tx, this.ctx(event), { entityType: SAL_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'purchase_drafted', message });
    }
  }

  /** `purchase.goods.received` / `purchase.order.balance_cancelled`: adds the quantities to the lines on that PO. */
  async onPurchaseQty(event: OutboxEnvelope, tx: Tx, kind: 'received' | 'cancelled'): Promise<void> {
    const e = readPurchaseQtyEvent(event.payload, kind === 'received' ? 'grnNo' : 'pcoNo');
    if (!e) return this.ignore(event);
    const lines = await tx.salSalesOrderLine.findMany({
      where: { tenantId: event.tenantId, isBuyToOrder: true, purchaseOrderNo: e.poNo, itemCode: { in: e.lines.map((l) => l.itemCode) } },
      include: { salesOrder: { select: { id: true, docNo: true } } },
      orderBy: [{ salesOrder: { docNo: 'asc' } }, { lineNo: 'asc' }],
    });
    if (lines.length === 0) return; // a PO no sales order waits for: nothing to show

    const adds = allocateToLines(
      // A line has room for what is neither received nor cancelled yet, whichever event this is.
      lines.map((l) => ({ id: l.id, itemCode: l.itemCode, orderedQty: l.orderedQty, current: l.purchaseReceivedQty.add(l.purchaseCancelledQty) })),
      e.lines,
    );
    for (const a of adds) {
      await tx.salSalesOrderLine.update({
        where: { id: a.id },
        data: kind === 'received' ? { purchaseReceivedQty: { increment: a.add } } : { purchaseCancelledQty: { increment: a.add } },
      });
    }
    const orders = new Map(lines.map((l) => [l.salesOrder.id, l.salesOrder.docNo]));
    for (const [orderId, docNo] of orders) {
      const mine = adds.filter((a) => lines.find((l) => l.id === a.id)?.salesOrder.id === orderId);
      if (mine.length === 0) continue;
      const perItem = new Map<string, { qty: Prisma.Decimal; uomCode: string }>();
      for (const a of mine) {
        const was = perItem.get(a.itemCode);
        perItem.set(a.itemCode, { qty: (was?.qty ?? dec(0)).add(a.add), uomCode: lines.find((l) => l.id === a.id)!.uomCode });
      }
      const what = [...perItem].map(([itemCode, x]) => `${qtyText(x.qty)} ${x.uomCode} ${itemCode}`).join(', ');
      const message = kind === 'received'
        ? `${e.poNo} received ${what} (${e.docNo}). The goods can be delivered.`
        : `Purchase cancelled ${what} on ${e.poNo} (${e.docNo}). Find another supplier or cancel the order balance.`;
      await this.activity.log(tx, this.ctx(event), { entityType: SAL_ENTITY.ORDER, entityId: orderId, docNo, action: `purchase_${kind}`, message });
    }
  }

  private ignore(event: OutboxEnvelope): void {
    this.logger.warn(`${event.name} ${event.id}: nothing in Sales matches it; ignored`);
  }

  private ctx(event: OutboxEnvelope): RequestContext {
    return {
      tenantId: event.tenantId,
      branchCode: '',
      correlationId: event.correlationId,
      user: { id: SYSTEM.code, tenantId: event.tenantId, code: SYSTEM.code, name: SYSTEM.name, email: '', roles: [], branchCodes: [], department: null, jobTitle: null },
    };
  }
}
