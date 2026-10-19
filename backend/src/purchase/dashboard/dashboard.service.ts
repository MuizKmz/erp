import { Inject, Injectable } from '@nestjs/common';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { nextDueDate } from './dashboard.rules';

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const PURCHASE_TYPES: string[] = Object.values(PUR_ENTITY);

/** Purchase home (P01): the four KPI cards. The charts below them are indicators (purchase.indicators.ts). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly approvals: ApprovalsService,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  /** Approvals waiting for the current user, Purchase documents only. */
  async waitingForMe(ctx: RequestContext) {
    return (await this.approvals.listWaitingFor(ctx.tenantId, ctx.user)).filter((r) => PURCHASE_TYPES.includes(r.entityType));
  }

  async get(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();

    const [orders, draftReceipts, invoices, waiting] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({
        where: { tenantId, status: { not: 'CANCELLED' } },
        include: { lines: { select: { orderedQty: true, receivedQty: true, cancelledQty: true } } },
      }),
      this.prisma.purGoodsReceipt.findMany({ where: { tenantId, status: 'DRAFT' }, select: { poId: true } }),
      this.prisma.purInvoice.findMany({
        where: { tenantId, status: { in: ['TO_MATCH', 'PENDING_APPROVAL'] } },
        select: { matchResult: true },
      }),
      this.approvals.listWaitingFor(tenantId, ctx.user),
    ]);

    // Open purchase orders (the mockup counts every order that is not cancelled).
    const committedTotal = orders.reduce((sum, o) => sum.add(o.total), dec(0));

    // Waiting to be received: released or partial with an open quantity.
    const beingReceived = new Set(draftReceipts.map((r) => r.poId));
    const waitingOrders = orders
      .filter((o) => o.status === 'RELEASED' || o.status === 'PARTIAL')
      .map((o) => ({
        order: o,
        open: o.lines.reduce((sum, l) => sum.add(l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty)), dec(0)),
      }))
      .filter((x) => x.open.gt(0));
    const nextDue = nextDueDate(
      waitingOrders.map((x) => ({ docNo: x.order.docNo, expectedDate: isoDate(x.order.expectedDate), beingReceived: beingReceived.has(x.order.id) })),
      today,
    );

    return {
      today,
      kpis: {
        openOrders: { count: orders.length, committed: toMoney(committedTotal) },
        waitingToReceive: {
          count: waitingOrders.length,
          units: toQty(waitingOrders.reduce((sum, x) => sum.add(x.open), dec(0))),
          nextDue,
        },
        invoicesToMatch: {
          count: invoices.length,
          withDifference: invoices.filter((i) => i.matchResult === 'DIFFERENCE').length,
        },
        waitingForMe: {
          count: waiting.length,
          purchaseOrders: waiting.filter((w) => w.entityType === PUR_ENTITY.ORDER).length,
          invoices: waiting.filter((w) => w.entityType === PUR_ENTITY.INVOICE).length,
          debitNotes: waiting.filter((w) => w.entityType === PUR_ENTITY.DEBIT_NOTE).length,
        },
      },
      connections: { inventory: this.stock.connected },
    };
  }
}
