import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { monthRange } from '../../platform/clock/clock.rules';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ReceivablesService } from '../shared/receivables.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { approvalKind, daysBetween, shortReason, toInvoice, waitingSummary } from './dashboard.rules';

const SALES_TYPES: string[] = Object.values(SAL_ENTITY);
const OPEN = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL'] as const;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Sales home (S01): the four KPI cards, recent sales orders, approvals waiting and ordered by agent. */
@Injectable()
export class SalesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly approvals: ApprovalsService,
    private readonly receivables: ReceivablesService,
  ) {}

  /** Approvals waiting for the current user, Sales documents only. */
  async waitingForMe(ctx: RequestContext) {
    return (await this.approvals.listWaitingFor(ctx.tenantId, ctx.user)).filter((r) => SALES_TYPES.includes(r.entityType));
  }

  async get(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const month = monthRange(today);

    const [orders, deliveries, waiting, open] = await Promise.all([
      this.prisma.salSalesOrder.findMany({
        where: { tenantId, revision: 0 },
        include: { lines: true },
        orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      }),
      this.prisma.salDelivery.findMany({ where: { tenantId, status: 'CONFIRMED' }, select: { salesOrderId: true, docDate: true } }),
      this.waitingForMe(ctx),
      this.receivables.openInvoices(tenantId, today),
    ]);

    const openOrders = orders.filter((o) => (OPEN as readonly string[]).includes(o.status));

    // Delivered, not yet invoiced: value of the delivered quantity still to bill, including tax.
    const toBill = orders
      .map((o) => ({
        order: o,
        amount: o.lines.reduce((sum, l) => {
          const qty = toInvoice(l);
          if (qty.lte(0)) return sum;
          const net = roundMoney(qty.mul(l.unitPrice).mul(dec(100).sub(l.discountPct)).div(100));
          return sum.add(net).add(roundMoney(net.mul(l.taxRate)));
        }, dec(0)),
      }))
      .filter((x) => x.amount.gt(0));
    const firstDelivery = (orderId: string) =>
      deliveries.filter((d) => d.salesOrderId === orderId).map((d) => iso(d.docDate)!).sort()[0] ?? today;
    const oldest = toBill.length ? Math.max(...toBill.map((x) => daysBetween(firstDelivery(x.order.id), today))) : null;

    // Customers with an overdue balance.
    const overdue = open.filter((x) => x.overdue);

    const kinds = waiting.map((w) => approvalKind(w.entityType, w.steps.find((s) => s.stepNo === w.currentStep)?.approverRole ?? null));
    const thisMonth = orders.filter((o) => !o.isMigrated && o.status !== 'CANCELLED' && o.docDate >= month.from && o.docDate <= month.to);
    const byAgent = new Map<string, { agentCode: string; agentName: string; orders: number; total: ReturnType<typeof dec> }>();
    for (const o of thisMonth) {
      const row = byAgent.get(o.agentCode) ?? { agentCode: o.agentCode, agentName: o.agentName, orders: 0, total: dec(0) };
      row.orders += 1;
      row.total = row.total.add(o.total);
      byAgent.set(o.agentCode, row);
    }

    return {
      today,
      kpis: {
        openOrders: {
          count: openOrders.length,
          total: toMoney(openOrders.reduce((sum, o) => sum.add(o.total), dec(0))),
          released: openOrders.filter((o) => o.status === 'RELEASED').length,
          partial: openOrders.filter((o) => o.status === 'PARTIAL').length,
        },
        toInvoice: { count: toBill.length, amount: toMoney(toBill.reduce((sum, x) => sum.add(x.amount), dec(0))), oldestDays: oldest },
        waitingForMe: { count: waiting.length, summary: waitingSummary(kinds) },
        customersOverdue: { count: new Set(overdue.map((x) => x.invoice.customerCode)).size, amount: toMoney(overdue.reduce((sum, x) => sum.add(x.balance), dec(0))) },
      },
      recentOrders: orders.slice(0, 7).map((o) => ({
        id: o.id,
        docNo: o.docNo,
        customerName: o.customerName,
        isBuyToOrder: o.orderTypeCode === 'BTO',
        isMigrated: o.isMigrated,
        total: toMoney(o.total),
        orderedQty: toQty(o.lines.reduce((sum, l) => sum.add(l.orderedQty), dec(0))),
        deliveredQty: toQty(o.lines.reduce((sum, l) => sum.add(l.deliveredQty), dec(0))),
        status: o.status,
        balanceCancelled: o.balanceCancelled,
      })),
      waiting: waiting.map((w, i) => ({
        id: w.id,
        entityType: w.entityType,
        entityId: w.entityId,
        docNo: w.docNo,
        customerName: w.title.split(' · ')[1] ?? '',
        reason: shortReason(kinds[i]!, w.reason),
        kind: kinds[i],
        amount: w.amount,
      })),
      orderedByAgent: {
        month: month.month,
        rows: [...byAgent.values()].map((r) => ({ ...r, total: toMoney(r.total) })).sort((a, b) => dec(b.total).cmp(dec(a.total))),
      },
    };
  }
}
