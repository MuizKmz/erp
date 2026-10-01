import { Inject, Injectable } from '@nestjs/common';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { monthRange } from '../../platform/clock/clock.rules';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { DemandService } from '../demand/demand.service';
import { nextDueDate, pickBuySoon } from './dashboard.rules';

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Statuses that count as committed spend: released to the supplier. */
const COMMITTED = ['RELEASED', 'PARTIAL', 'DONE'] as const;

/** Purchase home (P01): the four KPI cards, recent orders, buy soon and committed spend. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly approvals: ApprovalsService,
    private readonly demand: DemandService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async get(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const month = monthRange(today);

    const [orders, draftReceipts, invoices, waiting, demand] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({
        where: { tenantId, status: { not: 'CANCELLED' } },
        include: { lines: { select: { orderedQty: true, receivedQty: true, cancelledQty: true } } },
        orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      }),
      this.prisma.purGoodsReceipt.findMany({ where: { tenantId, status: 'DRAFT' }, select: { poId: true } }),
      this.prisma.purInvoice.findMany({
        where: { tenantId, status: { in: ['TO_MATCH', 'PENDING_APPROVAL'] } },
        select: { matchResult: true },
      }),
      this.approvals.listWaitingFor(tenantId, ctx.user),
      this.demand.compute(tenantId),
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

    // Committed spend by supplier this month: released orders only.
    const released = orders.filter((o) => (COMMITTED as readonly string[]).includes(o.status) && o.docDate >= month.from && o.docDate <= month.to);
    const bySupplier = new Map<string, ReturnType<typeof dec>>();
    for (const o of released) bySupplier.set(o.supplierCode, (bySupplier.get(o.supplierCode) ?? dec(0)).add(o.total));
    const suppliers = await this.masterData.listSuppliers(tenantId, [...bySupplier.keys()]);
    const pending = orders.filter((o) => o.status === 'PENDING_APPROVAL');

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
      recentOrders: orders.slice(0, 7).map((o) => ({
        id: o.id,
        docNo: o.docNo,
        supplierName: o.supplierName,
        salesOrderNo: o.salesOrderNo,
        isMigrated: o.isMigrated,
        total: toMoney(o.total),
        orderedQty: toQty(o.lines.reduce((sum, l) => sum.add(l.orderedQty), dec(0))),
        receivedQty: toQty(o.lines.reduce((sum, l) => sum.add(l.receivedQty), dec(0))),
        status: o.status,
      })),
      buySoon: pickBuySoon(demand.filter((d) => d.status === 'NEEDS_BUYING')).map((d) => ({
        itemCode: d.itemCode,
        itemName: d.itemName,
        onHand: d.onHand,
        reorderLevel: d.reorderLevel,
        reason: d.reason,
        salesOrders: d.salesOrders.map((s) => ({ soNo: s.soNo, qty: s.qty })),
      })),
      committedBySupplier: {
        month: month.month,
        rows: [...bySupplier]
          .map(([code, amount]) => {
            const s = suppliers.find((x) => x.code === code);
            return { supplierCode: code, supplierName: s?.shortName ?? s?.name ?? code, amount: toMoney(amount) };
          })
          .sort((a, b) => dec(b.amount).cmp(dec(a.amount))),
        pendingApproval: pending.map((o) => ({ docNo: o.docNo, total: toMoney(o.total) })),
      },
      connections: { inventory: this.stock.connected },
    };
  }
}
