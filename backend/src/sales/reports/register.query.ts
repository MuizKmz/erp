import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { toMoney } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { paymentState, type InvStatus } from '../invoices/invoice.rules';
import { ReceivablesService } from '../shared/receivables.service';
import { EINVOICE_LABELS, eInvoiceState } from './einvoice.rules';
import { releaseEventStatus } from './einvoice.query';
import { REGISTER_TYPE_KEYS, REGISTER_TYPES, registerTotals, signed, type RegisterType } from './register.rules';
import { customersInGroup, day, iso, periodsOf, ReportFilters } from './report-filters';
import { monthRange } from './report.rules';
import type { OrderReportFilter } from './reports.query';

const LINK: Record<RegisterType, string> = { INVOICE: '/sales/invoices', DEBIT_NOTE: '/sales/debit-notes', CREDIT_NOTE: '/sales/returns' };

/**
 * S05 · Invoice register: the invoices, debit notes and credit notes (sales returns) released in a month, with their
 * balance, payment state and e-Invoice state. Those brought over from the old system are listed too, marked.
 */
@Injectable()
export class InvoiceRegisterQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
    private readonly receivables: ReceivablesService,
  ) {}

  async report(ctx: RequestContext, filter: OrderReportFilter & { type?: string }) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const period = filter.period ?? today.slice(0, 7);
    const { from, to } = monthRange(period);
    const docDate = { gte: day(from), lte: day(to) };
    const branch = filter.branch ? { branchCode: filter.branch } : {};
    const { options, customers } = await this.filters.load(tenantId);
    const inGroup = customersInGroup(customers, filter.group);
    const pick = <T extends { customerCode: string; agentCode: string | null }>(rows: T[]) =>
      rows.filter((r) => (!inGroup || inGroup.has(r.customerCode)) && (!filter.agent || r.agentCode === filter.agent));

    const [invoices, debitNotes, returns, unreleased, months] = await Promise.all([
      this.prisma.salInvoice.findMany({ where: { tenantId, status: 'RELEASED', docDate, ...branch } }),
      this.prisma.salDebitNote.findMany({ where: { tenantId, status: 'RELEASED', docDate, ...branch }, include: { invoice: { select: { agentCode: true } } } }),
      this.prisma.salReturn.findMany({ where: { tenantId, status: 'RELEASED', docDate, ...branch }, include: { invoice: { select: { agentCode: true } } } }),
      Promise.all([
        this.prisma.salInvoice.findMany({ where: { tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, docDate, ...branch }, select: { docNo: true, status: true, customerCode: true, agentCode: true } }),
        this.prisma.salDebitNote.findMany({ where: { tenantId, status: 'DRAFT', docDate, ...branch }, select: { docNo: true, customerCode: true, invoice: { select: { agentCode: true } } } }),
        this.prisma.salReturn.findMany({ where: { tenantId, status: 'DRAFT', docDate, ...branch }, select: { docNo: true, customerCode: true, invoice: { select: { agentCode: true } } } }),
      ]),
      this.prisma.salInvoice.findMany({ where: { tenantId, status: 'RELEASED' }, select: { docDate: true }, distinct: ['docDate'] }),
    ]);
    const balances = await this.receivables.withBalances(tenantId, pick(invoices), today);
    const notes = [...debitNotes, ...returns].map((d) => ({ ...d, agentCode: d.invoice?.agentCode ?? null }));
    const docs = [
      ...balances.map(({ invoice: d, balance }) => ({
        type: 'INVOICE' as const, d, reference: d.salesOrderNo ?? (d.kind === 'DIRECT' ? 'Direct' : null), beforeTax: d.subtotal.sub(d.discountTotal), tax: d.taxTotal,
        balance, dueDate: iso(d.dueDate),
        payment: paymentState({ status: d.status as InvStatus, balance, credited: d.creditedAmount, dueDate: iso(d.dueDate), today }),
      })),
      ...pick(notes).map((d) => ({
        type: (debitNotes.some((x) => x.id === d.id) ? 'DEBIT_NOTE' : 'CREDIT_NOTE') as RegisterType, d, reference: d.invoiceNo, beforeTax: d.subtotal, tax: d.taxTotal,
        balance: null, dueDate: null, payment: null,
      })),
    ];
    const type = filter.type ? REGISTER_TYPE_KEYS[filter.type] : undefined;
    const shown = docs.filter((x) => !type || x.type === type).sort((a, b) => a.d.docDate.getTime() - b.d.docDate.getTime() || a.d.docNo.localeCompare(b.d.docNo));
    const events = await releaseEventStatus(this.prisma, tenantId, shown.map((x) => x.d.id));
    const totals = registerTotals(shown.map((x) => ({ type: x.type, beforeTax: x.beforeTax, tax: x.tax, total: x.d.total })));
    const [uInvoices, uDebits, uReturns] = unreleased;
    const waiting = [
      ...pick(uInvoices).map((d) => `${d.docNo} (${d.status === 'PENDING_APPROVAL' ? 'waiting for approval' : 'draft'})`),
      ...pick(uDebits.map((d) => ({ ...d, agentCode: d.invoice?.agentCode ?? null }))).map((d) => `${d.docNo} (draft)`),
      ...pick(uReturns.map((d) => ({ ...d, agentCode: d.invoice?.agentCode ?? null }))).map((d) => `${d.docNo} (draft)`),
    ];

    return {
      period,
      periods: periodsOf(months.map((m) => m.docDate), period),
      kpis: {
        invoiced: { amount: toMoney(totals.invoiced.amount), count: totals.invoiced.count },
        debitNotes: { amount: toMoney(totals.debitNotes.amount), count: totals.debitNotes.count },
        credited: { amount: toMoney(totals.credited.amount), count: totals.credited.count },
        net: { amount: toMoney(totals.net.total) },
      },
      rows: shown.map(({ type: t, d, reference, beforeTax, tax, balance, dueDate, payment }) => {
        const state = eInvoiceState({ isMigrated: d.isMigrated, eventStatus: events.get(d.id) ?? null });
        return {
          id: d.id, type: t, typeLabel: REGISTER_TYPES[t], docNo: d.docNo, docDate: iso(d.docDate), customerName: d.customerName, reference,
          beforeTax: toMoney(signed(t, beforeTax)), tax: toMoney(signed(t, tax)), total: toMoney(signed(t, d.total)),
          balance: balance === null ? null : toMoney(balance), dueDate, payment,
          eInvoice: state && { state, label: EINVOICE_LABELS[state] }, isMigrated: d.isMigrated, to: d.isMigrated ? null : `${LINK[t]}/${d.id}`,
        };
      }),
      totals: { beforeTax: toMoney(totals.net.beforeTax), tax: toMoney(totals.net.tax), total: toMoney(totals.net.total) },
      notes: waiting.length ? [`Not released yet, so not listed: ${waiting.join(', ')}.`] : [],
      footnote: 'Amounts include tax; credit notes (sales returns) are shown as negative amounts. Cash sales are on the Cash Sales list.',
      filters: options,
    };
  }
}
