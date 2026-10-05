import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalInvoice, SalInvoiceLine, SalSalesOrderLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { dateRange, parseSort } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreditService, type CreditOutcome } from '../shared/credit.service';
import { DepositsService } from '../shared/deposits.service';
import { depositToUse } from '../proformas/proforma.rules';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { CREDIT_DOC, SAL_ENTITY, SAL_EVENT, SAL_ROLE } from '../shared/sales.constants';
import { invoiceBalance } from '../shared/totals.rules';
import type { InvoiceListQueryDto } from './dto/invoice.dto';
import { allowedInvoiceActions, amountInWords, belowPriceList, paymentState, type InvStatus, type PaymentKey } from './invoice.rules';

export type InvoiceWithLines = SalInvoice & { lines: SalInvoiceLine[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
/** Events that Finance posts and LHDN turns into an e-Invoice (S17 KPI cards). */
const POSTING_EVENTS: string[] = [SAL_EVENT.INVOICE_RELEASED, SAL_EVENT.RETURN_RELEASED, SAL_EVENT.DEBIT_NOTE_RELEASED];
const TAB_KEYS: Record<string, PaymentKey[]> = { draft: ['DRAFT', 'PENDING'], unpaid: ['UNPAID', 'OVERDUE'], overdue: ['OVERDUE'], paid: ['PAID'] };

/** Reading invoices: the list (S17), what can be invoiced (S18), one invoice (S19) and its print (S20). */
@Injectable()
export class InvoicesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly permissions: PermissionRegistry,
    private readonly credit: CreditService,
    private readonly linked: SalesLinkedDocsService,
    private readonly deposits: DepositsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<InvoiceWithLines> {
    const row = await this.prisma.salInvoice.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Invoice');
    return row;
  }

  /**
   * What each order line can still be invoiced: delivered − invoiced − what other unreleased invoices already hold
   * (policy "Invoice from delivered quantity only").
   */
  async canInvoice(tenantId: string, soLines: SalSalesOrderLine[], excludeInvoiceId?: string): Promise<Map<string, Prisma.Decimal>> {
    const held = await this.prisma.salInvoiceLine.groupBy({
      by: ['soLineId'],
      where: { tenantId, soLineId: { in: soLines.map((l) => l.id) }, invoice: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, ...(excludeInvoiceId && { id: { not: excludeInvoiceId } }) } },
      _sum: { qty: true },
    });
    return new Map(
      soLines.map((l) => {
        const open = l.deliveredQty.sub(l.invoicedQty).sub(held.find((h) => h.soLineId === l.id)?._sum.qty ?? dec(0));
        return [l.id, open.gt(0) ? open : dec(0)];
      }),
    );
  }

  /** The credit check for a draft invoice (policy "Invoice": over either limit → Finance Manager). */
  async liveCredit(ctx: RequestContext, inv: InvoiceWithLines): Promise<CreditOutcome | null> {
    if (inv.status !== 'DRAFT' || inv.isMigrated) return null;
    const customer = await this.masterData.findCustomer(ctx.tenantId, inv.customerCode);
    if (!customer) return null;
    return this.credit.check(ctx.tenantId, {
      customer, docType: CREDIT_DOC.INVOICE, thisDocument: toMoney(inv.total), branchCode: inv.branchCode, ...(inv.salesOrderId && { excludeOrderId: inv.salesOrderId }),
    });
  }

  /**
   * Which approvals the invoice already has: an approved request covers the price when the Sales Manager decided a
   * step, and the credit when the Finance Manager (or the credit rule's approver) did. Cleared when the invoice changes.
   */
  async approvedRoles(tenantId: string, inv: InvoiceWithLines): Promise<Set<string>> {
    if (!inv.approvedAt) return new Set();
    const requests = await this.approvals.listForEntity(tenantId, SAL_ENTITY.INVOICE, inv.id);
    return new Set(requests.filter((r) => r.status === 'APPROVED').flatMap((r) => r.steps.map((s) => s.approverRole)));
  }

  /**
   * Approval still needed before release: a price below the list (Sales Manager) and/or a credit breach (Finance
   * Manager), each unless already approved.
   */
  approvalNeeds(inv: InvoiceWithLines, credit: CreditOutcome | null, approved: Set<string>) {
    const below = belowPriceList(inv.lines);
    const creditRole = credit?.approverRole ?? SAL_ROLE.FINANCE_MANAGER;
    return {
      below,
      price: below.count > 0 && !approved.has(SAL_ROLE.MANAGER),
      credit: credit ? credit.check.action === 'APPROVAL' && !approved.has(creditRole) : false,
      blocked: credit ? credit.check.action === 'BLOCK' : false,
    };
  }

  actions(ctx: RequestContext, inv: InvoiceWithLines, credit: CreditOutcome | null, balance: Prisma.Decimal, approved: Set<string>) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    const needs = this.approvalNeeds(inv, credit, approved);
    return allowedInvoiceActions({
      status: inv.status as InvStatus,
      isMigrated: inv.isMigrated,
      needsApproval: needs.price || needs.credit,
      creditBlocked: needs.blocked,
      approved: false,
      canEdit: has(P.INVOICE_EDIT),
      canRelease: has(P.INVOICE_RELEASE),
      hasBalance: balance.gt(0),
    });
  }

  private async paidByInvoice(tenantId: string, docNos: string[]) {
    const receipts = await this.prisma.finReceiptStub.groupBy({ by: ['appliesToNo'], where: { tenantId, appliesToType: 'INVOICE', appliesToNo: { in: docNos } }, _sum: { amount: true } });
    return new Map(receipts.map((r) => [r.appliesToNo, r._sum.amount ?? dec(0)]));
  }

  private balanceOf(inv: SalInvoice, paid: Prisma.Decimal) {
    return invoiceBalance({ total: inv.total, debited: inv.debitedAmount, credited: inv.creditedAmount, deposit: inv.depositApplied, paid });
  }

  // ── List and KPIs (S17) ───────────────────────────────────────────────────

  /**
   * Unpaid, Overdue and Paid depend on payments recorded in Finance, so the tabs are worked out in memory after
   * the database filters. Fine for the volumes of phase 1; a stored balance can replace it when Finance posts back.
   */
  async list(ctx: RequestContext, query: InvoiceListQueryDto) {
    const today = this.clock.today();
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total', customer: 'customerName' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const where: Prisma.SalInvoiceWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.agent && { agentCode: query.agent }),
      ...(query.branch && { branchCode: query.branch }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { salesOrderNo: { contains: q } }] }),
    };
    const rows = await this.prisma.salInvoice.findMany({ where, orderBy: [{ [sort.field]: sort.direction }, { docNo: sort.direction }] });
    const [paid, events] = await Promise.all([
      this.paidByInvoice(ctx.tenantId, rows.map((r) => r.docNo)),
      this.prisma.sysOutbox.findMany({ where: { tenantId: ctx.tenantId, name: SAL_EVENT.INVOICE_RELEASED, aggregateId: { in: rows.map((r) => r.id) } }, select: { aggregateId: true, status: true } }),
    ]);
    const all = rows.map((r) => {
      const balance = r.status === 'RELEASED' ? this.balanceOf(r, paid.get(r.docNo) ?? dec(0)) : r.total;
      const payment = paymentState({ status: r.status as InvStatus, balance, credited: r.creditedAmount, dueDate: iso(r.dueDate), today });
      const event = events.find((e) => e.aggregateId === r.id);
      return {
        id: r.id,
        docNo: r.docNo,
        docDate: iso(r.docDate),
        kind: r.kind,
        salesOrderId: r.salesOrderId,
        salesOrderNo: r.salesOrderNo,
        customerName: r.customerName,
        total: toMoney(r.total),
        balance: toMoney(balance),
        dueDate: iso(r.dueDate),
        payment,
        accounts: r.isMigrated ? 'OLD_SYSTEM' : event?.status === 'PENDING' ? 'QUEUED' : event ? 'POSTED' : null,
        eInvoice: r.isMigrated ? null : event?.status === 'PENDING' ? 'PENDING' : event ? 'SUBMITTED' : null,
        isMigrated: r.isMigrated,
        version: r.version,
      };
    });
    const count = (keys: PaymentKey[]) => all.filter((r) => keys.includes(r.payment.key)).length;
    const keys = query.status ? TAB_KEYS[query.status] : undefined;
    const filtered = keys ? all.filter((r) => keys.includes(r.payment.key)) : all;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      statusCounts: { all: all.length, draft: count(TAB_KEYS.draft!), unpaid: count(TAB_KEYS.unpaid!), overdue: count(TAB_KEYS.overdue!), paid: count(TAB_KEYS.paid!) },
      kpis: await this.kpis(ctx, today),
    };
  }

  private async kpis(ctx: RequestContext, today: string) {
    const released = await this.prisma.salInvoice.findMany({ where: { tenantId: ctx.tenantId, status: 'RELEASED' } });
    const paid = await this.paidByInvoice(ctx.tenantId, released.map((r) => r.docNo));
    const open = released.map((r) => ({ r, balance: this.balanceOf(r, paid.get(r.docNo) ?? dec(0)) })).filter((x) => x.balance.gt(0));
    const overdue = open.filter((x) => x.r.dueDate && iso(x.r.dueDate)! < today);
    const pending = await this.prisma.sysOutbox.count({ where: { tenantId: ctx.tenantId, status: 'PENDING', name: { in: POSTING_EVENTS } } });
    return {
      balanceDue: { amount: toMoney(sum(open.map((x) => x.balance))), invoices: open.length },
      overdue: { amount: toMoney(sum(overdue.map((x) => x.balance))), customers: new Set(overdue.map((x) => x.r.customerCode)).size },
      financeWaiting: pending,
      eInvoicePending: pending,
    };
  }

  // ── What can be invoiced (S18) ────────────────────────────────────────────

  async candidates(ctx: RequestContext, customerCode: string) {
    const customer = await this.masterData.findCustomer(ctx.tenantId, customerCode);
    if (!customer) throw new NotFoundError('Customer');
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, customerCode, isMigrated: false, status: { in: ['RELEASED', 'PARTIAL', 'DONE'] } },
      include: { lines: { orderBy: { lineNo: 'asc' } }, deliveries: { where: { status: 'CONFIRMED' }, select: { id: true, docNo: true }, orderBy: { docNo: 'asc' } } },
      orderBy: { docDate: 'asc' },
    });
    const can = await this.canInvoice(ctx.tenantId, orders.flatMap((o) => o.lines));
    const taxes = await this.masterData.listTaxCodes(ctx.tenantId);
    const earlier = await this.prisma.salInvoice.findMany({ where: { tenantId: ctx.tenantId, customerCode, status: 'RELEASED' }, orderBy: { docDate: 'desc' }, take: 20 });
    const paid = await this.paidByInvoice(ctx.tenantId, earlier.map((e) => e.docNo));

    const list = orders
      .map((o) => {
        const canQty = sum(o.lines.map((l) => can.get(l.id) ?? dec(0)));
        const delivered = sum(o.lines.map((l) => l.deliveredQty));
        const uom = o.lines[0]?.uomCode ?? '';
        return {
          id: o.id,
          docNo: o.docNo,
          docDate: iso(o.docDate),
          status: o.status,
          canInvoiceQty: toQty(canQty),
          summary: canQty.gt(0) ? `${toQty(canQty).replace(/\.0+$/, '')} delivered, not yet invoiced` : delivered.gt(0) ? 'Everything delivered is invoiced' : 'Nothing delivered yet',
          detail: canQty.gt(0)
            ? `Ordered ${iso(o.docDate)}`
            : `${toQty(sum(o.lines.map((l) => l.orderedQty))).replace(/\.0+$/, '')} ${uom}${o.lines.some((l) => l.isBuyToOrder) ? ' · buy to order' : ''}`,
          customerPoRef: o.customerPoRef,
          agentName: o.agentName,
          creditTermDays: o.creditTermDays,
          deliveries: o.deliveries.map((d) => ({ id: d.id, no: d.docNo })),
          lines: o.lines.map((l) => ({
            soLineId: l.id,
            lineNo: l.lineNo,
            itemCode: l.itemCode,
            itemName: l.itemName,
            uomCode: l.uomCode,
            orderedQty: toQty(l.orderedQty),
            deliveredQty: toQty(l.deliveredQty),
            invoicedQty: toQty(l.invoicedQty),
            canInvoiceQty: toQty(can.get(l.id) ?? dec(0)),
            unitPrice: toPrice(l.unitPrice),
            discountPct: l.discountPct.toFixed(2),
            taxCode: l.taxCode,
            taxName: taxes.find((t) => t.code === l.taxCode)?.name ?? l.taxCode,
            taxRate: toRate(l.taxRate),
          })),
        };
      })
      // Done orders with nothing left are history; released orders with nothing delivered are shown greyed.
      .filter((o) => Number(o.canInvoiceQty) > 0 || o.status !== 'DONE');

    return {
      customer: { code: customer.code, name: customer.name, creditTermDays: customer.creditTermDays, status: customer.status },
      orders: list,
      earlierInvoices: earlier.slice(0, 2).map((e) => {
        const balance = this.balanceOf(e, paid.get(e.docNo) ?? dec(0));
        return { docNo: e.docNo, docDate: iso(e.docDate), total: toMoney(e.total), state: balance.lte(0) ? 'Paid' : 'Unpaid', isMigrated: e.isMigrated };
      }),
    };
  }

  // ── One invoice (S19, S20) ────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const inv = await this.load(ctx.tenantId, id);
    const today = this.clock.today();
    const [credit, activity, links, approvals, customer, taxes, branches, receipts, event, order, tenant] = await Promise.all([
      this.liveCredit(ctx, inv),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.INVOICE, inv.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.INVOICE, inv.id),
      this.approvals.listForEntity(ctx.tenantId, SAL_ENTITY.INVOICE, inv.id),
      this.masterData.findCustomer(ctx.tenantId, inv.customerCode),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listBranches(ctx.tenantId),
      this.prisma.finReceiptStub.findMany({ where: { tenantId: ctx.tenantId, appliesToType: 'INVOICE', appliesToNo: inv.docNo }, orderBy: { receiptDate: 'asc' } }),
      this.prisma.sysOutbox.findFirst({ where: { tenantId: ctx.tenantId, name: SAL_EVENT.INVOICE_RELEASED, aggregateId: inv.id }, select: { status: true } }),
      inv.salesOrderId ? this.prisma.salSalesOrder.findFirst({ where: { id: inv.salesOrderId }, include: { lines: true } }) : null,
      this.prisma.sysTenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }),
    ]);
    const paid = sum(receipts.map((r) => r.amount));
    const balance = inv.status === 'RELEASED' ? this.balanceOf(inv, paid) : inv.total;
    const approvedRoles = await this.approvedRoles(ctx.tenantId, inv);
    const needs = this.approvalNeeds(inv, credit, approvedRoles);
    const can = order && inv.status !== 'RELEASED' ? await this.canInvoice(ctx.tenantId, order.lines, inv.id) : null;
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const latest = approvals[0] ?? null;
    const decidedStep = latest?.steps.filter((s) => s.decidedAt).at(-1);
    const waitingStep = latest?.status === 'PENDING' ? latest.steps.find((s) => s.status === 'WAITING') : null;
    // A paid deposit not used yet is taken off this invoice when it is released (rule 9).
    const pending = inv.status !== 'RELEASED' && inv.salesOrderId ? await this.deposits.paidUnusedForOrder(ctx.tenantId, inv.salesOrderId) : null;
    const pendingDeposit = pending ? { proformaNo: pending.proforma.docNo, amount: toMoney(depositToUse(inv.total, { amount: pending.proforma.amount, received: pending.received })) } : null;
    const deliveryNos = (inv.deliveryNos ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const deliveries = deliveryNos.length ? await this.prisma.salDelivery.findMany({ where: { tenantId: ctx.tenantId, docNo: { in: deliveryNos } }, select: { id: true, docNo: true, isMigrated: true } }) : [];
    const returns = inv.creditedAmount.gt(0) ? await this.prisma.salReturn.findMany({ where: { tenantId: ctx.tenantId, invoiceId: inv.id, status: 'RELEASED' }, select: { id: true, docNo: true } }) : [];

    return {
      id: inv.id,
      docNo: inv.docNo,
      docDate: iso(inv.docDate),
      kind: inv.kind,
      status: inv.status,
      isMigrated: inv.isMigrated,
      version: inv.version,
      payment: paymentState({ status: inv.status as InvStatus, balance, credited: inv.creditedAmount, dueDate: iso(inv.dueDate), today }),
      customer: { code: inv.customerCode, name: inv.customerName, tin: customer?.tin ?? null, email: customer?.email ?? null, deliveryAddress: customer?.deliveryAddress ?? null },
      billTo: inv.billTo,
      contactName: inv.contactName,
      branch: { code: inv.branchCode, name: branches.find((b) => b.code === inv.branchCode)?.name ?? inv.branchCode },
      agent: { code: inv.agentCode, name: inv.agentName },
      creditTermDays: inv.creditTermDays,
      dueDate: iso(inv.dueDate),
      currency: inv.currency,
      taxMode: inv.taxMode,
      customerPoRef: inv.customerPoRef,
      note: inv.note,
      order: order ? { id: order.id, no: order.docNo, ordered: toQty(sum(order.lines.map((l) => l.orderedQty))) } : inv.salesOrderNo ? { id: null, no: inv.salesOrderNo, ordered: null } : null,
      deliveries: deliveryNos.map((no) => {
        const d = deliveries.find((x) => x.docNo === no);
        return { id: d && !d.isMigrated ? d.id : null, no };
      }),
      lines: inv.lines.map((l) => {
        const soLine = order?.lines.find((x) => x.id === l.soLineId) ?? null;
        return {
          id: l.id,
          lineNo: l.lineNo,
          soLineId: l.soLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          qty: toQty(l.qty),
          listPrice: l.listPrice ? toPrice(l.listPrice) : null,
          unitPrice: toPrice(l.unitPrice),
          discountPct: l.discountPct.toFixed(2),
          taxCode: l.taxCode,
          taxName: taxName(l.taxCode),
          taxRate: toRate(l.taxRate),
          grossAmount: toMoney(l.grossAmount),
          discountAmount: toMoney(l.discountAmount),
          amount: toMoney(l.amount),
          taxAmount: toMoney(l.taxAmount),
          belowListPct: l.listPrice && l.listPrice.gt(0) && l.unitPrice.lt(l.listPrice) ? l.listPrice.sub(l.unitPrice).div(l.listPrice).mul(100).toFixed(0) : null,
          // From an order: what this line may hold (other drafts excluded), and the order's numbers for print.
          canInvoiceQty: soLine && can ? toQty(can.get(soLine.id) ?? dec(0)) : null,
          orderLine: soLine ? { orderedQty: toQty(soLine.orderedQty), deliveredQty: toQty(soLine.deliveredQty), invoicedQty: toQty(soLine.invoicedQty) } : null,
        };
      }),
      totals: {
        subtotal: toMoney(inv.subtotal),
        discountTotal: toMoney(inv.discountTotal),
        taxLines: [...new Set(inv.lines.map((l) => l.taxCode))].map((code) => ({ code, name: taxName(code), amount: toMoney(sum(inv.lines.filter((l) => l.taxCode === code).map((l) => l.taxAmount))) })),
        rounding: toMoney(inv.rounding),
        total: toMoney(inv.total),
      },
      amounts: {
        total: toMoney(inv.total),
        credited: toMoney(inv.creditedAmount),
        creditedBy: returns.map((r) => ({ id: r.id, no: r.docNo })),
        debited: toMoney(inv.debitedAmount),
        deposit: toMoney(inv.depositApplied),
        proformaNo: inv.proformaNo,
        pendingDeposit,
        paid: toMoney(paid),
        balance: toMoney(balance),
      },
      payments: receipts.map((r) => ({ receiptNo: r.receiptNo, date: iso(r.receiptDate), amount: toMoney(r.amount), method: r.method, note: r.note })),
      posting: { accounts: inv.isMigrated ? 'OLD_SYSTEM' : event?.status === 'PENDING' ? 'QUEUED' : event ? 'POSTED' : null, eInvoice: inv.isMigrated ? null : event?.status === 'PENDING' ? 'PENDING' : event ? 'SUBMITTED' : null },
      checks: {
        priceBelowList: needs.price ? needs.below : null,
        credit: credit ? { action: credit.check.action, snapshot: credit.snapshot } : null,
        creditBlocked: needs.blocked,
        needsApproval: needs.price || needs.credit,
        needsPrice: needs.price,
        needsCredit: needs.credit,
      },
      approval: {
        state: !latest ? 'NONE' : latest.status === 'PENDING' ? 'PENDING' : latest.status === 'APPROVED' ? 'APPROVED' : latest.status === 'REJECTED' ? 'REJECTED' : 'NONE',
        reason: latest?.reason ?? null,
        note: latest?.requesterNote ?? null,
        requestedBy: latest?.requestedByName ?? null,
        waitingFor: waitingStep ? (waitingStep.approverName ?? waitingStep.approverRole) : null,
        decidedBy: decidedStep?.decidedByName ?? null,
        comment: decidedStep?.comment ?? null,
      },
      print: { companyName: tenant?.name ?? '[Company name]', amountInWords: amountInWords(inv.total) },
      releasedAt: inv.releasedAt?.toISOString() ?? null,
      emailedAt: inv.emailedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, inv, credit, balance, approvedRoles),
    };
  }
}
