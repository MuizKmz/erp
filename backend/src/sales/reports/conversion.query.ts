import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toRmText } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { expiresSoon } from '../quotations/quotation.rules';
import { conversion, daysBetween, outcomeLabel, quoteOutcome, type QuoteOutcome } from './conversion.rules';
import { customersInGroup, day, iso, periodsOf, ReportFilters } from './report-filters';
import { monthRange } from './report.rules';
import type { OrderReportFilter } from './reports.query';

/**
 * S05 · Quotation conversion: the quotations sent in a month and how they ended up. Each quotation counts once, as
 * its latest revision (older revisions are SUPERSEDED), and those brought over from the old system count too, as
 * the Quotation list does.
 */
@Injectable()
export class QuotationConversionQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
  ) {}

  async report(ctx: RequestContext, filter: OrderReportFilter) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const period = filter.period ?? today.slice(0, 7);
    const { from, to } = monthRange(period);
    const { options, customers } = await this.filters.load(tenantId);
    const inGroup = customersInGroup(customers, filter.group);

    const [rows, months] = await Promise.all([
      this.prisma.salQuotation.findMany({
        where: {
          tenantId, status: { not: 'SUPERSEDED' }, docDate: { gte: day(from), lte: day(to) },
          ...(filter.branch && { branchCode: filter.branch }), ...(filter.agent && { agentCode: filter.agent }),
        },
        orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }],
      }),
      this.prisma.salQuotation.findMany({ where: { tenantId }, select: { docDate: true }, distinct: ['docDate'] }),
    ]);
    const quotes = rows.filter((q) => !inGroup || inGroup.has(q.customerCode));
    const orderNos = quotes.map((q) => q.salesOrderNo).filter((n): n is string => Boolean(n));
    const orders = orderNos.length
      ? await this.prisma.salSalesOrder.findMany({ where: { tenantId, revision: 0, docNo: { in: orderNos } }, select: { docNo: true, docDate: true } })
      : [];

    const sent = quotes
      .map((q) => ({ q, outcome: quoteOutcome({ status: q.status, revision: q.revision, validUntil: iso(q.validUntil) }, today) }))
      .filter((x): x is { q: (typeof quotes)[number]; outcome: QuoteOutcome } => x.outcome !== null)
      .map(({ q, outcome }) => {
        const orderDate = iso(orders.find((o) => o.docNo === q.salesOrderNo)?.docDate ?? null);
        return { q, outcome, daysToOrder: outcome === 'WON' && orderDate ? Math.max(0, daysBetween(iso(q.docDate)!, orderDate)) : null };
      });
    const notSent = quotes.filter((q) => !sent.some((s) => s.q.id === q.id));
    const result = conversion(sent.map(({ q, outcome, daysToOrder }) => ({ agentCode: q.agentCode, agentName: q.agentName, total: q.total, outcome, lostReason: q.lostReason, daysToOrder })));
    const of = (key: QuoteOutcome) => result.outcomes.find((o) => o.key === key)!;
    const openSoon = sent.filter((s) => s.outcome === 'OPEN' && expiresSoon(s.q.status, iso(s.q.validUntil), today, 3)).map((s) => s.q.docNo);
    const migrated = sent.filter((s) => s.q.isMigrated).map((s) => s.q.docNo);
    const notSentAmount = notSent.reduce((s, q) => s.add(q.total), dec(0));

    return {
      period,
      periods: periodsOf(months.map((m) => m.docDate), period),
      kpis: {
        sent: { count: result.sent.count, amount: toMoney(result.sent.amount) },
        won: { count: of('WON').count, amount: toMoney(of('WON').amount), pct: result.wonPct, valuePct: result.wonValuePct, avgDays: result.avgDaysToOrder },
        lost: { count: of('LOST').count, amount: toMoney(of('LOST').amount), topReason: result.reasons[0]?.reason ?? null },
        open: { count: of('OPEN').count, amount: toMoney(of('OPEN').amount), expiringSoon: openSoon, expired: of('EXPIRED').count },
      },
      outcomes: result.outcomes.map((o) => ({ ...o, amount: toMoney(o.amount) })),
      agents: result.agents.map((a) => ({ ...a, wonAmount: toMoney(a.wonAmount) })),
      reasons: result.reasons.map((r) => ({ ...r, amount: toMoney(r.amount) })),
      rows: sent.map(({ q, outcome, daysToOrder }) => ({
        id: q.id, docNo: q.docNo, revision: q.revision, docDate: iso(q.docDate), validUntil: iso(q.validUntil),
        customerName: q.customerName, agentName: q.agentName, total: toMoney(q.total),
        outcome, outcomeLabel: outcomeLabel(outcome), salesOrderNo: q.salesOrderNo, daysToOrder, lostReason: q.lostReason,
        expiresSoon: openSoon.includes(q.docNo), isMigrated: q.isMigrated,
      })),
      footnote: [
        'Each quotation counts once, as its latest revision. Rates are turned into an order ÷ sent.',
        notSent.length ? `${notSent.length} not sent yet (${notSent.map((q) => q.docNo).join(', ')}, ${toRmText(notSentAmount)}) count once released.` : '',
        migrated.length ? `${migrated.join(', ')} came from the old system.` : '',
      ].filter(Boolean).join(' '),
      filters: options,
    };
  }
}
