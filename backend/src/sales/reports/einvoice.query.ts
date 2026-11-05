import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SAL_EVENT } from '../shared/sales.constants';
import { daysBetween } from './conversion.rules';
import {
  consolidatedByMonth,
  consolidatedState,
  EINVOICE_LABELS,
  EINVOICE_TYPES,
  eInvoiceProblem,
  eInvoiceState,
  type EInvoiceDocType,
  type EInvoiceState,
} from './einvoice.rules';
import { day, iso, periodsOf, ReportFilters } from './report-filters';
import { monthRange } from './report.rules';

/** The release events that carry an e-Invoice, by document type. */
export const EINVOICE_EVENTS: Record<EInvoiceDocType, string> = {
  INVOICE: SAL_EVENT.INVOICE_RELEASED,
  DEBIT_NOTE: SAL_EVENT.DEBIT_NOTE_RELEASED,
  CREDIT_NOTE: SAL_EVENT.RETURN_RELEASED,
  CASH_SALE: SAL_EVENT.CASH_SALE_RELEASED,
};

/** The state of each document's release event (sys_outbox), by document id. */
export async function releaseEventStatus(prisma: PrismaService, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const events = await prisma.sysOutbox.findMany({
    where: { tenantId, aggregateId: { in: ids }, name: { in: Object.values(EINVOICE_EVENTS) } },
    select: { aggregateId: true, status: true },
  });
  return new Map(events.map((e) => [e.aggregateId, e.status]));
}

const LINK: Record<EInvoiceDocType, string> = { INVOICE: '/sales/invoices', DEBIT_NOTE: '/sales/debit-notes', CREDIT_NOTE: '/sales/returns', CASH_SALE: '/sales/cash-sales' };
const TYPE_KEYS: Record<string, EInvoiceDocType> = { invoice: 'INVOICE', 'debit-note': 'DEBIT_NOTE', 'credit-note': 'CREDIT_NOTE', 'cash-sale': 'CASH_SALE' };

/**
 * S05 · e-Invoice status (SRS FR-EIV-010): every document released in Zora that needs its own LHDN e-Invoice
 * (invoices, debit notes, credit notes and cash sales with their own e-Invoice), and each month's consolidated
 * e-Invoice for the other cash sales, counted as the Cash Sales list counts it. Nothing is submitted in this phase.
 */
@Injectable()
export class EInvoiceStatusQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
  ) {}

  async report(ctx: RequestContext, filter: { period?: string; branch?: string; type?: string; show?: string }) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const period = filter.period && filter.period !== 'all' ? filter.period : null;
    const range = period ? monthRange(period) : null;
    const docDate = range ? { gte: day(range.from), lte: day(range.to) } : undefined;
    const where = { tenantId, status: 'RELEASED' as const, isMigrated: false, ...(docDate && { docDate }), ...(filter.branch && { branchCode: filter.branch }) };
    const { options, customers } = await this.filters.load(tenantId);

    const [invoices, debitNotes, returns, cashSales, allCash, dates] = await Promise.all([
      this.prisma.salInvoice.findMany({ where, orderBy: { docNo: 'asc' } }),
      this.prisma.salDebitNote.findMany({ where, orderBy: { docNo: 'asc' } }),
      this.prisma.salReturn.findMany({ where, orderBy: { docNo: 'asc' } }),
      this.prisma.salCashSale.findMany({ where: { ...where, ownEInvoice: true }, orderBy: { docNo: 'asc' } }),
      // The consolidated e-Invoice counts every cash sale of the month without its own, as S23 does.
      this.prisma.salCashSale.findMany({
        where: { tenantId, ...(docDate && { docDate }), ...(filter.branch && { branchCode: filter.branch }) },
        select: { docDate: true, total: true, ownEInvoice: true },
      }),
      this.prisma.salInvoice.findMany({ where: { tenantId, status: 'RELEASED', isMigrated: false }, select: { docDate: true }, distinct: ['docDate'] }),
    ]);
    const docs: { id: string; type: EInvoiceDocType; docNo: string; docDate: Date; customerCode: string; customerName: string; total: Prisma.Decimal; releasedAt: Date | null; buyerTin?: string | null }[] = [
      ...invoices.map((d) => ({ ...d, type: 'INVOICE' as const })),
      ...debitNotes.map((d) => ({ ...d, type: 'DEBIT_NOTE' as const })),
      ...returns.map((d) => ({ ...d, type: 'CREDIT_NOTE' as const })),
      ...cashSales.map((d) => ({ ...d, customerName: d.buyerName ?? d.customerName, type: 'CASH_SALE' as const })),
    ];
    const events = await releaseEventStatus(this.prisma, tenantId, docs.map((d) => d.id));

    const all = docs
      .map((d) => {
        const state = eInvoiceState({ isMigrated: false, eventStatus: events.get(d.id) ?? null }) ?? 'WAITING';
        const since = iso(d.releasedAt ?? d.docDate)!;
        const customer = customers.find((c) => c.code === d.customerCode) ?? null;
        return {
          id: d.id, type: d.type, typeLabel: EINVOICE_TYPES[d.type], docNo: d.docNo, docDate: iso(d.docDate), customerName: d.customerName,
          tin: d.type === 'CASH_SALE' ? (d.buyerTin ?? null) : (customer?.tin ?? null), total: toMoney(d.total),
          state, stateLabel: EINVOICE_LABELS[state], since, days: Math.max(0, daysBetween(since, today)),
          problem: eInvoiceProblem({ type: d.type, customerTin: customer?.tin ?? null, buyerTin: d.buyerTin ?? null }),
          to: `${LINK[d.type]}/${d.id}`, _total: d.total,
        };
      })
      .sort((a, b) => b.days - a.days || a.docNo.localeCompare(b.docNo));
    const waitingStates: EInvoiceState[] = ['WAITING', 'FAILED'];
    const type = filter.type ? TYPE_KEYS[filter.type] : undefined;
    const rows = all.filter((r) => (!type || r.type === type) && (filter.show === 'all' || waitingStates.includes(r.state)));
    const waiting = all.filter((r) => waitingStates.includes(r.state));
    const consolidated = consolidatedByMonth(allCash.map((c) => ({ docDate: iso(c.docDate)!, total: c.total, ownEInvoice: c.ownEInvoice }))).map((m) => {
      const s = consolidatedState(m.month, today);
      return { month: m.month, count: m.count, amount: toMoney(m.amount), due: s.due, late: s.late };
    });
    const current = consolidated.find((c) => c.month === (period ?? today.slice(0, 7))) ?? null;

    return {
      today,
      period: period ?? 'all',
      periods: periodsOf([...dates.map((d) => d.docDate), ...allCash.map((c) => c.docDate)], today.slice(0, 7)),
      connected: false,
      kpis: {
        waiting: { count: waiting.length, amount: toMoney(waiting.reduce((s, r) => s.add(r._total), dec(0))), oldestDays: waiting[0]?.days ?? 0 },
        submitted: { count: all.filter((r) => r.state === 'SUBMITTED').length },
        problems: { count: all.filter((r) => r.problem || r.state === 'FAILED').length },
        consolidated: current,
      },
      rows: rows.map(({ _total, ...r }) => r),
      consolidated,
      footnote: 'Documents brought over from the old system are not listed. Cash sales without their own e-Invoice go into one consolidated e-Invoice a month, due the 7th of the next month.',
      filters: { branches: options.branches },
    };
  }
}
