import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ReceivablesService } from '../shared/receivables.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { approvalKind, daysBetween, lineValue, toInvoice, waitingSummary } from './dashboard.rules';

const SALES_TYPES: string[] = Object.values(SAL_ENTITY);
export const OPEN_ORDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL'] as const;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Sales home (S01): the four KPI cards. The charts below them are indicators (sales.indicators.ts). */
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

    const [orders, deliveries, waiting, open] = await Promise.all([
      this.prisma.salSalesOrder.findMany({ where: { tenantId, revision: 0 }, include: { lines: true } }),
      this.prisma.salDelivery.findMany({ where: { tenantId, status: 'CONFIRMED' }, select: { salesOrderId: true, docDate: true } }),
      this.waitingForMe(ctx),
      this.receivables.openInvoices(tenantId, today),
    ]);

    const openOrders = orders.filter((o) => (OPEN_ORDER_STATUSES as readonly string[]).includes(o.status));

    // Delivered, not yet invoiced: value of the delivered quantity still to bill, including tax.
    const toBill = orders
      .map((o) => ({ order: o, amount: o.lines.reduce((sum, l) => (toInvoice(l).gt(0) ? sum.add(lineValue(l, toInvoice(l))) : sum), dec(0)) }))
      .filter((x) => x.amount.gt(0));
    const firstDelivery = (orderId: string) =>
      deliveries.filter((d) => d.salesOrderId === orderId).map((d) => iso(d.docDate)!).sort()[0] ?? today;
    const oldest = toBill.length ? Math.max(...toBill.map((x) => daysBetween(firstDelivery(x.order.id), today))) : null;

    // Customers with an overdue balance.
    const overdue = open.filter((x) => x.overdue);
    const kinds = waiting.map((w) => approvalKind(w.entityType, w.steps.find((s) => s.stepNo === w.currentStep)?.approverRole ?? null));

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
    };
  }
}
