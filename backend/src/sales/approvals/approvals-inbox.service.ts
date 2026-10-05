import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService, type ApprovalRequestView, type DecisionResult } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { NotFoundError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { approvalKind, daysBetween, type ApprovalKind } from '../dashboard/dashboard.rules';
import { OrdersService } from '../orders/orders.service';
import { CreditService } from '../shared/credit.service';
import { ReceivablesService } from '../shared/receivables.service';
import { SAL_ENTITY } from '../shared/sales.constants';

type Tab = 'waiting' | 'approved' | 'rejected';
const SALES_TYPES: string[] = Object.values(SAL_ENTITY);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const KIND_LABEL: Record<ApprovalKind, string> = { CREDIT: 'Credit', PRICE: 'Price', DISCOUNT: 'Discount' };

/** S02 · Sales approvals: credit on orders, prices on invoices, discounts on quotations (FlowS1–S3). */
@Injectable()
export class SalesApprovalsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly activity: ActivityService,
    private readonly clock: ClockService,
    private readonly orders: OrdersService,
    private readonly credit: CreditService,
    private readonly receivables: ReceivablesService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private kindOf(r: ApprovalRequestView): ApprovalKind {
    return approvalKind(r.entityType, r.steps.find((s) => s.stepNo === r.currentStep)?.approverRole ?? r.steps[0]?.approverRole ?? null);
  }

  private card(r: ApprovalRequestView, myDecision: string | null = null) {
    const kind = this.kindOf(r);
    return {
      id: r.id, entityType: r.entityType, entityId: r.entityId, docNo: r.docNo, title: r.title, customerName: r.title.split(' · ')[1] ?? '',
      reason: r.reason, kind, kindLabel: KIND_LABEL[kind], amount: r.amount, requestedByName: r.requestedByName, requestedAt: r.createdAt, myDecision,
    };
  }

  async waiting(ctx: RequestContext) {
    return (await this.approvals.listWaitingFor(ctx.tenantId, ctx.user)).filter((r) => SALES_TYPES.includes(r.entityType));
  }

  async list(ctx: RequestContext, tab: Tab) {
    const [waiting, decided] = await Promise.all([
      this.waiting(ctx),
      this.prisma.sysApprovalStep.findMany({
        where: { tenantId: ctx.tenantId, decidedByCode: ctx.user.code, status: { in: ['APPROVED', 'REJECTED'] }, request: { entityType: { in: SALES_TYPES } } },
        include: { request: { include: { steps: true } } },
        orderBy: { decidedAt: 'desc' },
      }),
    ]);
    const views = await Promise.all(decided.map((s) => this.approvals.get(ctx.tenantId, s.requestId)));
    const decidedCards = decided.map((s, i) => ({ step: s, view: views[i]! }));
    const weekAgo = new Date(this.clock.now().getTime() - 7 * 86_400_000);
    const items =
      tab === 'waiting'
        ? waiting.map((r) => this.card(r))
        : decidedCards.filter((d) => d.step.status === (tab === 'approved' ? 'APPROVED' : 'REJECTED')).map((d) => this.card(d.view, d.step.status));
    return {
      items,
      counts: {
        waiting: waiting.length,
        approved: decided.filter((s) => s.status === 'APPROVED').length,
        rejected: decided.filter((s) => s.status === 'REJECTED').length,
      },
      recentDecisions: decidedCards
        .filter((d) => d.step.decidedAt && d.step.decidedAt >= weekAgo)
        .map((d) => ({ requestId: d.view.id, docNo: d.view.docNo, reason: d.view.reason, decision: d.step.status, decidedAt: d.step.decidedAt!.toISOString() })),
    };
  }

  async detail(ctx: RequestContext, id: string) {
    const request = await this.approvals.get(ctx.tenantId, id);
    if (!SALES_TYPES.includes(request.entityType)) throw new NotFoundError('Approval');
    const kind = this.kindOf(request);
    const waitingStep = request.status === 'PENDING' ? request.steps.find((s) => s.status === 'WAITING') : null;
    const canDecide = Boolean(
      waitingStep && request.requestedByCode !== ctx.user.code && (waitingStep.approverCode ? waitingStep.approverCode === ctx.user.code : ctx.user.roles.includes(waitingStep.approverRole)),
    );
    const decided = request.steps.find((s) => s.decidedAt);
    return {
      ...this.card(request),
      status: request.status,
      requesterNote: request.requesterNote,
      canDecide,
      decision: decided ? { byName: decided.decidedByName, at: decided.decidedAt, comment: decided.comment, status: decided.status } : null,
      panel: kind === 'CREDIT' && request.entityType === SAL_ENTITY.ORDER ? await this.creditPanel(ctx, request) : kind === 'PRICE' ? await this.pricePanel(ctx, request) : await this.discountPanel(ctx, request),
    };
  }

  /** Exposure, overdue, last payment and payment history of the customer (Approvals.html right panel). */
  private async creditPanel(ctx: RequestContext, request: ApprovalRequestView) {
    const order = await this.prisma.salSalesOrder.findFirst({ where: { id: request.entityId, tenantId: ctx.tenantId } });
    if (!order) throw new NotFoundError('Sales order');
    const today = this.clock.today();
    const customer = await this.masterData.findCustomer(ctx.tenantId, order.customerCode);
    const open = await this.receivables.openInvoices(ctx.tenantId, today, [order.customerCode]);
    const owed = open.reduce((s, x) => s.add(x.balance), dec(0));
    const over60 = open.filter((x) => daysBetween(iso(x.invoice.docDate)!, today) > 60).reduce((s, x) => s.add(x.balance), dec(0));
    const otherOpen = await this.credit.openOrdersValue(ctx.tenantId, order.customerCode, null, order.id);
    const [lastPayment, paidInvoices, lastApproval] = await Promise.all([
      this.prisma.finReceiptStub.findFirst({ where: { tenantId: ctx.tenantId, customerCode: order.customerCode, appliesToType: 'INVOICE' }, orderBy: { receiptDate: 'desc' } }),
      this.prisma.salInvoice.findMany({ where: { tenantId: ctx.tenantId, customerCode: order.customerCode, status: 'RELEASED' }, orderBy: { docDate: 'desc' } }),
      this.prisma.sysApprovalRequest.findFirst({
        where: { tenantId: ctx.tenantId, entityType: SAL_ENTITY.ORDER, status: 'APPROVED', title: { endsWith: order.customerName }, id: { not: request.id }, reason: { contains: 'redit' } },
        orderBy: { decidedAt: 'desc' },
      }),
    ]);
    // Recent history: the two latest invoices paid in full, on time or late.
    const openNos = new Set(open.map((x) => x.invoice.docNo));
    const history = [];
    for (const v of paidInvoices.filter((x) => !openNos.has(x.docNo)).slice(0, 2)) {
      const last = await this.prisma.finReceiptStub.findFirst({ where: { tenantId: ctx.tenantId, appliesToNo: v.docNo }, orderBy: { receiptDate: 'desc' } });
      const late = last && v.dueDate ? daysBetween(iso(v.dueDate)!, iso(last.receiptDate)!) : 0;
      history.push({ docNo: v.docNo, total: toMoney(v.total), paid: late > 0 ? `Paid ${late} ${late === 1 ? 'day' : 'days'} late` : 'Paid on time' });
    }
    return {
      type: 'CREDIT' as const,
      orderId: order.id,
      customerName: order.customerName,
      owedNow: toMoney(owed),
      over60: toMoney(over60),
      otherOpen: toMoney(otherOpen),
      thisOrder: toMoney(order.total),
      exposureAfter: toMoney(owed.add(otherOpen).add(order.total)),
      creditLimit: customer?.creditLimit ? toMoney(customer.creditLimit) : null,
      overdue: toMoney(open.filter((x) => x.overdue).reduce((s, x) => s.add(x.balance), dec(0))),
      overdueLimit: customer?.overdueLimit ? toMoney(customer.overdueLimit) : null,
      lastPayment: lastPayment ? { amount: toMoney(lastPayment.amount), date: iso(lastPayment.receiptDate) } : null,
      history,
      lastCreditApproval: lastApproval?.decidedAt ? iso(lastApproval.decidedAt) : null,
    };
  }

  /** Invoice lines priced below the customer's price list. */
  private async pricePanel(ctx: RequestContext, request: ApprovalRequestView) {
    const invoice = await this.prisma.salInvoice.findFirst({ where: { id: request.entityId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!invoice) throw new NotFoundError('Invoice');
    return {
      type: 'PRICE' as const,
      customerName: invoice.customerName,
      total: toMoney(invoice.total),
      lines: invoice.lines.map((l) => ({
        itemCode: l.itemCode, itemName: l.itemName, qty: toQty(l.qty), uomCode: l.uomCode, unitPrice: toPrice(l.unitPrice),
        listPrice: l.listPrice ? toPrice(l.listPrice) : null,
        belowPct: l.listPrice && l.listPrice.gt(0) && l.unitPrice.lt(l.listPrice) ? l.listPrice.sub(l.unitPrice).div(l.listPrice).mul(100).toFixed(0) : null,
        amount: toMoney(l.amount),
      })),
    };
  }

  /** Quotation lines with their discount and the estimated margin. */
  private async discountPanel(ctx: RequestContext, request: ApprovalRequestView) {
    const q = await this.prisma.salQuotation.findFirst({ where: { id: request.entityId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!q) throw new NotFoundError('Quotation');
    const net = q.subtotal.sub(q.discountTotal);
    return {
      type: 'DISCOUNT' as const,
      customerName: q.customerName,
      total: toMoney(q.total),
      marginPct: q.costTotal && net.gt(0) ? net.sub(q.costTotal).div(net).mul(100).toFixed(1) : null,
      lines: q.lines.map((l) => ({
        itemCode: l.itemCode, itemName: l.itemName, qty: toQty(l.qty), uomCode: l.uomCode, unitPrice: toPrice(l.unitPrice),
        discountPct: l.discountPct.toFixed(2), amount: toMoney(l.amount),
      })),
    };
  }

  async decide(ctx: RequestContext, id: string, decision: 'APPROVE' | 'REJECT', comment: string | null) {
    const request = await this.approvals.get(ctx.tenantId, id);
    if (!SALES_TYPES.includes(request.entityType)) throw new NotFoundError('Approval');
    if (decision === 'REJECT' && !comment?.trim()) throw ValidationFailedError.field('comment', 'Please add a comment so the requester knows why it was rejected.');
    const result = await this.prisma.$transaction(async (tx) => {
      const decided = await this.approvals.decide(tx, ctx, id, decision, comment);
      if (decided.entityType === SAL_ENTITY.ORDER) await this.orders.onApprovalDecision(tx, ctx, decided, comment?.trim() || null);
      else await this.onOtherDecision(tx, ctx, decided, comment?.trim() || null);
      return decided;
    });
    return { outcome: result.outcome, docNo: result.docNo, entityType: result.entityType, entityId: result.entityId };
  }

  /** Invoices (price, credit) and quotations (discount): back to draft, approved or with the comment. */
  private async onOtherDecision(tx: Tx, ctx: RequestContext, result: DecisionResult, comment: string | null) {
    if (result.outcome === 'NEXT_STEP') return;
    const approved = result.outcome === 'APPROVED';
    const data = { status: 'DRAFT' as const, approvedAt: approved ? this.clock.now() : null, version: { increment: 1 }, updatedBy: ctx.user.code };
    if (result.entityType === SAL_ENTITY.INVOICE) await tx.salInvoice.update({ where: { id: result.entityId }, data });
    else if (result.entityType === SAL_ENTITY.QUOTATION) await tx.salQuotation.update({ where: { id: result.entityId }, data });
    await this.activity.log(tx, ctx, {
      entityType: result.entityType, entityId: result.entityId, docNo: result.docNo, action: approved ? 'approved' : 'rejected',
      message: approved ? `Approved by ${ctx.user.name} · ready to release` : `Rejected by ${ctx.user.name} · back to draft`, comment,
    });
  }
}
