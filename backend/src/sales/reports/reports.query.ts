import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { customersInGroup, day, periodsOf, ReportFilters } from './report-filters';
import { monthRange, salesByAgent, salesByCustomer, salesByItem, salesByItemGroup } from './report.rules';

export interface OrderReportFilter {
  period?: string;
  branch?: string;
  agent?: string;
  group?: string;
}

/** S05 · the two reports on what was ordered in a month: Sales by customer and Sales by item. */
@Injectable()
export class SalesReportsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  /**
   * The orders both reports count: dated in the month, drafts and orders waiting for approval included, cancelled and
   * migrated ones left out, each order once whatever its revisions. Also the released invoices and cancel orders on
   * them, and what the filter row offers.
   */
  private async ordersInPeriod(ctx: RequestContext, filter: OrderReportFilter) {
    const tenantId = ctx.tenantId;
    const period = filter.period ?? this.clock.today().slice(0, 7);
    const { from, to } = monthRange(period);
    const { options, customers } = await this.filters.load(tenantId);
    const inGroup = customersInGroup(customers, filter.group);

    const orders = (await this.prisma.salSalesOrder.findMany({
      where: {
        tenantId, isMigrated: false, revision: 0, status: { not: 'CANCELLED' }, docDate: { gte: day(from), lte: day(to) },
        ...(filter.branch && { branchCode: filter.branch }), ...(filter.agent && { agentCode: filter.agent }),
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: { docNo: 'asc' },
    })).filter((o) => !inGroup || inGroup.has(o.customerCode));
    const nos = orders.map((o) => o.docNo);
    // Through the invoice and cancel-order headers, so the data scopes apply to their lines too.
    const [invoices, cancels, months] = await Promise.all([
      this.prisma.salInvoice.findMany({
        where: { tenantId, status: 'RELEASED', salesOrderNo: { in: nos } },
        select: { id: true, docNo: true, salesOrderNo: true, total: true, lines: { select: { soLineId: true, amount: true, taxAmount: true } } },
      }),
      this.prisma.salCancelOrder.findMany({
        where: { tenantId, status: 'RELEASED', salesOrderNo: { in: nos } },
        select: { docNo: true, salesOrderNo: true, total: true, lines: { select: { soLineId: true, amount: true, taxAmount: true } } },
      }),
      this.prisma.salSalesOrder.findMany({ where: { tenantId, isMigrated: false }, select: { docDate: true }, distinct: ['docDate'] }),
    ]);
    const returns = invoices.length
      ? await this.prisma.salReturn.findMany({ where: { tenantId, status: 'RELEASED', invoiceId: { in: invoices.map((i) => i.id) } }, select: { docNo: true, invoiceNo: true, total: true } })
      : [];
    return { period, periods: periodsOf(months.map((m) => m.docDate), period), orders, invoices, cancels, returns, options };
  }

  /** Notes both reports share: orders still waiting for approval, and the returns invoiced amounts are before. */
  private notes(orders: { docNo: string; status: string; total: Prisma.Decimal }[], returns: { docNo: string; invoiceNo: string; total: Prisma.Decimal }[]) {
    return {
      notes: orders.filter((o) => o.status === 'PENDING_APPROVAL').map((o) => `${o.docNo} (${toRmText(o.total)}) is still waiting for credit approval. It counts as ordered.`),
      footnote: `Amounts include tax. Invoiced is before returns${returns.length ? `: ${returns.map((r) => `${r.docNo} credited ${toRmText(r.total)} on ${r.invoiceNo}`).join(', ')}` : ''}.`,
    };
  }

  async byCustomer(ctx: RequestContext, filter: OrderReportFilter) {
    const { period, periods, orders, invoices, cancels, returns, options } = await this.ordersInPeriod(ctx, filter);
    const sumBy = (rows: { salesOrderNo: string | null; total: Prisma.Decimal }[]) => {
      const map = new Map<string, Prisma.Decimal>();
      for (const r of rows) if (r.salesOrderNo) map.set(r.salesOrderNo, (map.get(r.salesOrderNo) ?? dec(0)).add(r.total));
      return map;
    };
    const report = salesByCustomer(orders, sumBy(invoices), sumBy(cancels));

    return {
      period,
      periods,
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
      ...this.notes(orders, returns),
      filters: options,
    };
  }

  async byItem(ctx: RequestContext, filter: OrderReportFilter & { itemGroup?: string }) {
    const { period, periods, orders, invoices, cancels, returns, options } = await this.ordersInPeriod(ctx, filter);
    const lines = orders.flatMap((o) => o.lines.map((l) => ({ ...l, docNo: o.docNo })));
    const items = await this.masterData.findItems(ctx.tenantId, [...new Set(lines.map((l) => l.itemCode))]);
    const groupOf = (code: string) => items.find((i) => i.code === code)?.itemGroup || null;
    const picked = filter.itemGroup ? lines.filter((l) => (groupOf(l.itemCode) ?? 'No group') === filter.itemGroup) : lines;

    const sumByLine = (docs: { lines: { soLineId: string | null; amount: Prisma.Decimal; taxAmount: Prisma.Decimal }[] }[]) => {
      const map = new Map<string, Prisma.Decimal>();
      for (const l of docs.flatMap((d) => d.lines)) if (l.soLineId) map.set(l.soLineId, (map.get(l.soLineId) ?? dec(0)).add(l.amount).add(l.taxAmount));
      return map;
    };
    const report = salesByItem(
      picked.map((l) => ({
        soLineId: l.id, docNo: l.docNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
        orderedQty: l.orderedQty, deliveredQty: l.deliveredQty, invoicedQty: l.invoicedQty, value: l.amount.add(l.taxAmount),
      })),
      sumByLine(invoices),
      sumByLine(cancels),
    );
    const best = report.rows[0] ?? null;
    const shownOrders = new Set(picked.map((l) => l.docNo));

    return {
      period,
      periods,
      kpis: {
        ordered: { amount: toMoney(report.totals.ordered), items: new Set(report.rows.map((r) => r.itemCode)).size, orders: report.totals.orders },
        invoiced: { amount: toMoney(report.totals.invoiced), pct: report.totals.ordered.gt(0) ? Math.round(report.totals.invoiced.div(report.totals.ordered).mul(100).toNumber()) : 0 },
        best: best && { itemCode: best.itemCode, itemName: best.itemName, amount: toMoney(best.ordered), sharePct: best.sharePct.toFixed(1) },
        open: { amount: toMoney(report.totals.open) },
      },
      rows: report.rows.map((r) => ({
        itemCode: r.itemCode, itemName: r.itemName, itemGroup: groupOf(r.itemCode), uomCode: r.uomCode, orders: r.orders,
        orderedQty: toQty(r.orderedQty), deliveredQty: toQty(r.deliveredQty), invoicedQty: toQty(r.invoicedQty),
        ordered: toMoney(r.ordered), invoiced: toMoney(r.invoiced), open: toMoney(r.open), sharePct: r.sharePct.toFixed(1),
      })),
      totals: { orders: report.totals.orders, ordered: toMoney(report.totals.ordered), invoiced: toMoney(report.totals.invoiced), open: toMoney(report.totals.open) },
      groups: salesByItemGroup(report.rows, groupOf).map((g) => ({ group: g.group, items: g.items, ordered: toMoney(g.ordered), sharePct: g.sharePct.toFixed(1) })),
      ...this.notes(orders.filter((o) => shownOrders.has(o.docNo)), returns),
      filters: { ...options, itemGroups: [...new Set(lines.map((l) => groupOf(l.itemCode) ?? 'No group'))].sort() },
    };
  }
}
