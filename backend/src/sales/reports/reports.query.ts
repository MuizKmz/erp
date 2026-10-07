import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toRmText } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { monthRange, salesByAgent, salesByCustomer } from './report.rules';

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** S05 · Sales reports. "Sales by customer" is built; the other report tabs are placeholders until asked for. */
@Injectable()
export class SalesReportsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async byCustomer(ctx: RequestContext, filter: { period?: string; branch?: string; agent?: string; group?: string }) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const period = filter.period ?? today.slice(0, 7);
    const { from, to } = monthRange(period);
    const customers = await this.masterData.listCustomers(tenantId);
    const inGroup = filter.group ? new Set(customers.filter((c) => c.category === filter.group).map((c) => c.code)) : null;

    const orders = (await this.prisma.salSalesOrder.findMany({
      where: {
        tenantId, isMigrated: false, revision: 0, status: { not: 'CANCELLED' }, docDate: { gte: day(from), lte: day(to) },
        ...(filter.branch && { branchCode: filter.branch }), ...(filter.agent && { agentCode: filter.agent }),
      },
      orderBy: { docNo: 'asc' },
    })).filter((o) => !inGroup || inGroup.has(o.customerCode));
    const nos = orders.map((o) => o.docNo);
    const [invoices, cancels, months, agents, branches] = await Promise.all([
      this.prisma.salInvoice.findMany({ where: { tenantId, status: 'RELEASED', salesOrderNo: { in: nos } }, select: { id: true, docNo: true, salesOrderNo: true, total: true } }),
      this.prisma.salCancelOrder.findMany({ where: { tenantId, status: 'RELEASED', salesOrderNo: { in: nos } }, select: { docNo: true, salesOrderNo: true, total: true } }),
      this.prisma.salSalesOrder.findMany({ where: { tenantId, isMigrated: false }, select: { docDate: true }, distinct: ['docDate'] }),
      this.masterData.listUsers(tenantId),
      this.masterData.listBranches(tenantId),
    ]);
    const sumBy = (rows: { salesOrderNo: string | null; total: Prisma.Decimal }[]) => {
      const map = new Map<string, Prisma.Decimal>();
      for (const r of rows) if (r.salesOrderNo) map.set(r.salesOrderNo, (map.get(r.salesOrderNo) ?? dec(0)).add(r.total));
      return map;
    };
    const report = salesByCustomer(orders, sumBy(invoices), sumBy(cancels));
    const returns = invoices.length
      ? await this.prisma.salReturn.findMany({ where: { tenantId, status: 'RELEASED', invoiceId: { in: invoices.map((i) => i.id) } }, select: { docNo: true, invoiceNo: true, total: true } })
      : [];
    const pending = orders.filter((o) => o.status === 'PENDING_APPROVAL');
    const periods = [...new Set(months.map((m) => m.docDate.toISOString().slice(0, 7)))].sort().reverse();

    return {
      period,
      periods: periods.length ? periods : [period],
      kpis: {
        ordered: { amount: toMoney(report.totals.ordered), orders: report.totals.orders },
        invoiced: { amount: toMoney(report.totals.invoiced), pct: report.totals.ordered.gt(0) ? Math.round(report.totals.invoiced.div(report.totals.ordered).mul(100).toNumber()) : 0 },
        cancelled: { amount: toMoney(report.totals.cancelled), docs: cancels.map((c) => `${c.docNo} · ${c.salesOrderNo}`) },
        open: { amount: toMoney(report.totals.open) },
      },
      rows: report.rows.map((r) => ({
        customerCode: r.customerCode, customerName: r.customerName, orders: r.orders, ordered: toMoney(r.ordered), invoiced: toMoney(r.invoiced),
        cancelled: toMoney(r.cancelled), open: toMoney(r.open), sharePct: r.sharePct.toFixed(1),
      })),
      totals: { orders: report.totals.orders, ordered: toMoney(report.totals.ordered), invoiced: toMoney(report.totals.invoiced), cancelled: toMoney(report.totals.cancelled), open: toMoney(report.totals.open) },
      agents: salesByAgent(orders).map((a) => ({ agentCode: a.agentCode, agentName: a.agentName, orders: a.orders, ordered: toMoney(a.ordered) })),
      notes: [
        ...pending.map((o) => `${o.docNo} (${toRmText(o.total)}) is still waiting for credit approval. It counts as ordered.`),
      ],
      footnote: `Amounts include tax. Invoiced is before returns${returns.length ? `: ${returns.map((r) => `${r.docNo} credited ${toRmText(r.total)} on ${r.invoiceNo}`).join(', ')}` : ''}.`,
      filters: {
        branches: branches.map((b) => ({ code: b.code, name: b.name })),
        agents: agents.filter((u) => u.roles.includes('SALES_AGENT')).map((u) => ({ code: u.code, name: u.name })),
        groups: [...new Set(customers.map((c) => c.category).filter((c): c is string => Boolean(c)))].sort(),
      },
    };
  }
}
