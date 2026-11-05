import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney } from '../../platform/http/decimal';
import { ReceivablesService } from '../shared/receivables.service';
import { AGING_STEPS, agingByCustomer, agingColumnOf, agingColumns, agingDays, type AgingBasis, type AgingSteps } from './aging.rules';
import { customersInGroup, iso, ReportFilters } from './report-filters';

/**
 * S05 · Customer aging (SRS RPT-023): what each customer owes today, after returns, debit notes, deposits and the
 * payments Finance recorded, the same balances as the Invoices list (S17).
 */
@Injectable()
export class CustomerAgingQuery {
  constructor(
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
    private readonly receivables: ReceivablesService,
  ) {}

  async report(ctx: RequestContext, filter: { branch?: string; agent?: string; group?: string; steps?: string; basis?: string }) {
    const today = this.clock.today();
    const steps = (AGING_STEPS as readonly number[]).includes(Number(filter.steps)) ? (Number(filter.steps) as AgingSteps) : 4;
    const basis: AgingBasis = filter.basis === 'invoice' ? 'invoice' : 'due';
    const { options, customers } = await this.filters.load(ctx.tenantId);
    const inGroup = customersInGroup(customers, filter.group);

    const open = (await this.receivables.openInvoices(ctx.tenantId, today)).filter(
      (x) => (!filter.branch || x.invoice.branchCode === filter.branch) && (!filter.agent || x.invoice.agentCode === filter.agent) && (!inGroup || inGroup.has(x.invoice.customerCode)),
    );
    const columns = agingColumns(steps, basis);
    const invoices = open.map((x) => ({ x, docDate: iso(x.invoice.docDate)!, dueDate: iso(x.invoice.dueDate) }));
    const report = agingByCustomer(
      invoices.map(({ x, docDate, dueDate }) => ({ customerCode: x.invoice.customerCode, customerName: x.invoice.customerName, docDate, dueDate, balance: x.balance })),
      columns,
      basis,
      today,
    );
    const money = (cells: Record<string, ReturnType<typeof dec>>) => Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, toMoney(v)]));
    const overdue = invoices.filter(({ dueDate }) => dueDate && dueDate < today);
    const over60 = overdue.filter(({ docDate, dueDate }) => agingDays({ docDate, dueDate }, 'due', today) > 60);
    const sum = (xs: typeof invoices) => xs.reduce((s, { x }) => s.add(x.balance), dec(0));

    return {
      today,
      steps,
      basis,
      columns: columns.map(({ key, label }) => ({ key, label })),
      kpis: {
        due: { amount: toMoney(report.totals.balance), invoices: invoices.length },
        overdue: { amount: toMoney(sum(overdue)), customers: new Set(overdue.map(({ x }) => x.invoice.customerCode)).size },
        over60: { amount: toMoney(sum(over60)), customers: [...new Set(over60.map(({ x }) => x.invoice.customerName))] },
        notDue: { amount: toMoney(report.totals.balance.sub(sum(overdue))) },
      },
      rows: report.rows.map((r) => {
        const limit = customers.find((c) => c.code === r.customerCode)?.creditLimit ?? null;
        return {
          customerCode: r.customerCode, customerName: r.customerName, invoices: r.invoices, balance: toMoney(r.balance), overdue: toMoney(r.overdue),
          cells: money(r.cells), oldestDays: r.oldestDays, creditLimit: limit, overLimit: limit !== null && r.balance.gt(dec(limit)),
        };
      }),
      totals: { balance: toMoney(report.totals.balance), overdue: toMoney(report.totals.overdue), cells: money(report.totals.cells) },
      invoices: invoices
        .map(({ x, docDate, dueDate }) => ({
          id: x.invoice.id, docNo: x.invoice.docNo, docDate, dueDate, customerName: x.invoice.customerName, total: toMoney(x.invoice.total), balance: toMoney(x.balance),
          days: agingDays({ docDate, dueDate }, basis, today), column: agingColumnOf(columns, basis, { docDate, dueDate }, today), isMigrated: x.invoice.isMigrated,
        }))
        .sort((a, b) => b.days - a.days || a.docNo.localeCompare(b.docNo)),
      footnote: 'Balances after returns, debit notes, deposits and the payments Finance recorded. Overdue counts from the due date, whichever aging you pick.',
      filters: options,
    };
  }
}
