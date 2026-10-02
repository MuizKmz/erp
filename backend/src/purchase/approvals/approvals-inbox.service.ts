import { Inject, Injectable } from '@nestjs/common';
import { SALES_DEMAND_PORT, type SalesDemandPort } from '../../integration/integration.ports';
import { checkDecision, type ApprovalDecision } from '../../platform/approvals/approval.rules';
import { ApprovalsService, type ApprovalRequestView } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { DebitNotesQuery } from '../debit-notes/debit-notes.query';
import { DebitNotesService } from '../debit-notes/debit-notes.service';
import { InvoiceApprovalService } from '../invoices/invoice-approval.service';
import { OrdersService } from '../orders/orders.service';
import { PUR_ENTITY, SYSTEM_USER } from '../shared/purchase.constants';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';

export type InboxTab = 'waiting' | 'approved' | 'rejected';

const PURCHASE_TYPES: string[] = Object.values(PUR_ENTITY);

/** Midnight in Kuala Lumpur, `days` before a YYYY-MM-DD date. */
function klDaysBefore(isoDate: string, days: number): Date {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000+08:00`);
}

/**
 * Purchase approvals inbox (P02): what waits for me, what I decided, and the decision itself.
 * The decision is recorded by the platform approval engine; the owning document reacts in the same
 * transaction (PO → ready to release or back to draft; invoice → approved or rejected).
 */
@Injectable()
export class ApprovalsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly orders: OrdersService,
    private readonly invoices: InvoiceApprovalService,
    private readonly debitNotes: DebitNotesService,
    private readonly debitNotesQuery: DebitNotesQuery,
    private readonly settings: PurchaseSettingsService,
    private readonly clock: ClockService,
    @Inject(SALES_DEMAND_PORT) private readonly sales: SalesDemandPort,
  ) {}

  async waitingCount(ctx: RequestContext): Promise<number> {
    return (await this.waiting(ctx)).length;
  }

  async list(ctx: RequestContext, tab: InboxTab) {
    const [waiting, decidedSteps] = await Promise.all([
      this.waiting(ctx),
      this.prisma.sysApprovalStep.findMany({
        where: { tenantId: ctx.tenantId, decidedByCode: ctx.user.code, status: { in: ['APPROVED', 'REJECTED'] }, request: { entityType: { in: PURCHASE_TYPES } } },
        include: { request: { include: { steps: true } } },
        orderBy: { decidedAt: 'desc' },
      }),
    ]);

    const approved = decidedSteps.filter((s) => s.status === 'APPROVED');
    const rejected = decidedSteps.filter((s) => s.status === 'REJECTED');
    const since = klDaysBefore(this.clock.today(), 7);

    const decidedItems = async (steps: typeof decidedSteps) =>
      this.describe(ctx, steps.map((s) => ({ ...this.toView(s.request), myDecision: s.status, myComment: s.comment, myDecidedAt: s.decidedAt })));

    const items = tab === 'waiting' ? await this.describe(ctx, waiting) : await decidedItems(tab === 'approved' ? approved : rejected);

    return {
      tab,
      counts: { waiting: waiting.length, approved: approved.length, rejected: rejected.length },
      items,
      recentDecisions: decidedSteps
        .filter((s) => s.decidedAt && s.decidedAt >= since)
        .map((s) => ({
          requestId: s.requestId,
          entityType: s.request.entityType,
          entityId: s.request.entityId,
          docNo: s.request.docNo,
          reason: s.request.reason,
          decision: s.status,
          decidedAt: s.decidedAt!.toISOString(),
        })),
    };
  }

  async detail(ctx: RequestContext, id: string) {
    const request = await this.approvals.get(ctx.tenantId, id);
    if (!PURCHASE_TYPES.includes(request.entityType)) throw new NotFoundError('Approval');
    const [item] = await this.describe(ctx, [request]);
    const check = checkDecision(
      { status: request.status as never, currentStep: request.currentStep, requestedByCode: request.requestedByCode, steps: request.steps as never },
      ctx.user,
      'APPROVE',
      'x',
    );
    let cannotDecide = check.ok ? null : check.message;
    if (!cannotDecide && request.entityType === PUR_ENTITY.ORDER) cannotDecide = await this.buyerOwnPo(ctx, request.entityId);

    return {
      ...item!,
      requesterNote: request.requesterNote,
      steps: request.steps,
      canDecide: cannotDecide === null,
      cannotDecideReason: cannotDecide,
      document: await this.documentPanel(ctx, request),
    };
  }

  async decide(ctx: RequestContext, id: string, decision: ApprovalDecision, comment: string | null) {
    const request = await this.approvals.get(ctx.tenantId, id);
    if (!PURCHASE_TYPES.includes(request.entityType)) throw new NotFoundError('Approval');
    if (request.entityType === PUR_ENTITY.ORDER) {
      const own = await this.buyerOwnPo(ctx, request.entityId);
      if (own) throw new BusinessRuleError('APPROVAL_SELF', own);
    }
    const text = comment?.trim() || null;
    const result = await this.prisma.$transaction(async (tx) => {
      const decided = await this.approvals.decide(tx, ctx, id, decision, text);
      if (decided.entityType === PUR_ENTITY.ORDER) await this.orders.onApprovalDecision(tx, ctx, decided, text);
      else if (decided.entityType === PUR_ENTITY.INVOICE) await this.invoices.onApprovalDecision(tx, ctx, decided, text);
      else if (decided.entityType === PUR_ENTITY.DEBIT_NOTE) await this.debitNotes.onApprovalDecision(tx, ctx, decided, text);
      else throw new BusinessRuleError('APPROVAL_UNSUPPORTED', `${decided.docNo} cannot be decided here yet.`);
      return decided;
    });
    return { outcome: result.outcome, docNo: result.docNo, entityType: result.entityType, entityId: result.entityId };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async waiting(ctx: RequestContext) {
    return (await this.approvals.listWaitingFor(ctx.tenantId, ctx.user)).filter((r) => PURCHASE_TYPES.includes(r.entityType));
  }

  /** "The buyer can never approve their own PO" (Approval Rules switch). */
  private async buyerOwnPo(ctx: RequestContext, orderId: string): Promise<string | null> {
    const settings = await this.settings.settings(ctx.tenantId);
    if (!settings.buyerCannotApproveOwnPo) return null;
    const order = await this.prisma.purPurchaseOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId }, select: { buyerCode: true } });
    return order?.buyerCode === ctx.user.code ? 'You are the buyer on this PO. The buyer can never approve their own PO.' : null;
  }

  /** A request row with its steps, shaped like ApprovalsService views. */
  private toView(r: {
    id: string; entityType: string; entityId: string; docNo: string; branchCode: string; amount: { toString(): string } | null;
    title: string; reason: string; requesterNote: string | null; requestedByCode: string; requestedByName: string; status: string;
    currentStep: number; createdAt: Date; decidedAt: Date | null;
    steps: { stepNo: number; approverRole: string; approverCode: string | null; approverName: string | null; status: string; decidedByCode: string | null; decidedByName: string | null; comment: string | null; decidedAt: Date | null }[];
  }): ApprovalRequestView {
    return {
      id: r.id, entityType: r.entityType, entityId: r.entityId, docNo: r.docNo, branchCode: r.branchCode,
      amount: r.amount === null ? null : toMoney(r.amount.toString()), title: r.title, reason: r.reason, requesterNote: r.requesterNote,
      requestedByCode: r.requestedByCode, requestedByName: r.requestedByName, status: r.status, currentStep: r.currentStep,
      createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
      steps: [...r.steps].sort((a, b) => a.stepNo - b.stepNo).map((s) => ({
        stepNo: s.stepNo, approverRole: s.approverRole, approverCode: s.approverCode, approverName: s.approverName, status: s.status,
        decidedByCode: s.decidedByCode, decidedByName: s.decidedByName, comment: s.comment, decidedAt: s.decidedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Card data for the inbox: kind chip ("Over limit", "Price difference"), who sent it and when. */
  private async describe(
    ctx: RequestContext,
    requests: (ApprovalRequestView & { myDecision?: string; myComment?: string | null; myDecidedAt?: Date | null })[],
  ) {
    const orderIds = requests.filter((r) => r.entityType === PUR_ENTITY.ORDER).map((r) => r.entityId);
    const invoiceIds = requests.filter((r) => r.entityType === PUR_ENTITY.INVOICE).map((r) => r.entityId);
    const [orders, invoices] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({ where: { tenantId: ctx.tenantId, id: { in: orderIds } }, select: { id: true, createdBy: true, createdAt: true, salesOrderNo: true } }),
      this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, id: { in: invoiceIds } }, select: { id: true, matchSummary: true } }),
    ]);
    return requests.map((r) => {
      const order = orders.find((o) => o.id === r.entityId);
      const invoice = invoices.find((i) => i.id === r.entityId);
      const summary = invoice?.matchSummary?.toLowerCase() ?? '';
      const kind =
        r.entityType === PUR_ENTITY.ORDER ? 'Over limit'
          : r.entityType === PUR_ENTITY.INVOICE ? (summary.includes('price') ? 'Price difference' : summary.includes('qty') || summary.includes('billed') ? 'Quantity difference' : 'Outside tolerance')
            : r.entityType === PUR_ENTITY.DEBIT_NOTE ? 'Extra charge' : 'Approval';
      return {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        docNo: r.docNo,
        title: r.title,
        kind,
        reason: r.reason,
        amount: r.amount,
        status: r.status,
        requestedByName: r.requestedByName,
        requestedAt: r.createdAt,
        draftedFrom: order && order.createdBy === SYSTEM_USER.code && order.salesOrderNo
          ? { salesOrderNo: order.salesOrderNo, at: order.createdAt.toISOString() }
          : null,
        myDecision: r.myDecision ?? null,
        myComment: r.myComment ?? null,
        myDecidedAt: r.myDecidedAt?.toISOString() ?? null,
      };
    });
  }

  /** The right-hand panel: the order summary, or the invoice's three-way match. */
  private async documentPanel(ctx: RequestContext, request: ApprovalRequestView) {
    if (request.entityType === PUR_ENTITY.ORDER) {
      const order = await this.prisma.purPurchaseOrder.findFirst({
        where: { id: request.entityId, tenantId: ctx.tenantId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!order) return null;
      const so = order.salesOrderNo ? await this.sales.findSalesOrder(ctx.tenantId, order.salesOrderNo) : null;
      // Rule 5: the reason saved with the RFQ award (needed when it is not the cheapest) is shown to the approver.
      const rfq = order.rfqId
        ? await this.prisma.purRfq.findFirst({ where: { id: order.rfqId, tenantId: ctx.tenantId }, select: { docNo: true, awardReason: true } })
        : null;
      return {
        kind: 'ORDER' as const,
        award: rfq?.awardReason ? { rfqNo: rfq.docNo, reason: rfq.awardReason } : null,
        docNo: order.docNo,
        supplierName: order.supplierName,
        warehouseName: order.warehouseName,
        expectedDate: order.expectedDate?.toISOString().slice(0, 10) ?? null,
        buyerName: order.buyerName,
        lines: order.lines.map((l) => ({
          itemCode: l.itemCode, itemName: l.itemName, qty: toQty(l.orderedQty), uomCode: l.uomCode, unitPrice: toPrice(l.unitPrice), amount: toMoney(l.amount),
        })),
        subtotal: toMoney(order.subtotal),
        taxTotal: toMoney(order.taxTotal),
        total: toMoney(order.total),
        salesOrder: so
          ? {
              no: so.soNo,
              customerName: so.customerName,
              total: so.soTotal,
              marginPct: dec(so.soTotal).gt(0) ? dec(so.soTotal).sub(order.total).div(so.soTotal).mul(100).toDecimalPlaces(0).toString() : null,
            }
          : null,
      };
    }

    if (request.entityType === PUR_ENTITY.DEBIT_NOTE) {
      // The charges, the check against the PO and what the invoice becomes (PurDebitNote.html right panel).
      const note = await this.debitNotesQuery.detail(ctx, request.entityId);
      return {
        kind: 'DEBIT_NOTE' as const,
        docNo: note.docNo,
        supplierName: note.supplier.name,
        theirNoteNo: note.theirNoteNo,
        invoiceNo: note.invoice.docNo,
        lines: note.lines.map((l) => ({ itemCode: l.itemCode, itemName: l.itemName, qty: l.qty, uomCode: l.uomCode, unitPrice: l.unitPrice, amount: l.amount })),
        subtotal: note.subtotal,
        taxLines: note.taxLines,
        total: note.total,
        check: note.check?.message ?? null,
        invoiceTotal: note.check?.invoice.total ?? null,
        afterTotal: note.check?.invoice.afterTotal ?? null,
      };
    }

    if (request.entityType === PUR_ENTITY.INVOICE) {
      const invoice = await this.prisma.purInvoice.findFirst({ where: { id: request.entityId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!invoice) return null;
      const settings = await this.settings.settings(ctx.tenantId);
      const lines = invoice.lines;
      const sum = (pick: (l: (typeof lines)[number]) => { toString(): string }) => lines.reduce((s, l) => s.add(pick(l).toString()), dec(0));
      const single = lines.length === 1 ? lines[0]! : null;
      const orderedQty = sum((l) => l.orderedQty);
      const receivedQty = sum((l) => l.receivedQty);
      const billedQty = sum((l) => l.billedQty);
      // What accepting as billed pays on top, before tax: billed minus what was received at the PO price.
      const priceDiff = lines.reduce(
        (s, l) => s.add(l.billedAmount).sub(roundMoney((l.billedQty.lt(l.receivedQty) ? l.billedQty : l.receivedQty).mul(l.orderedPrice))),
        dec(0),
      );
      const pct = single && single.orderedPrice.gt(0) ? single.billedUnitPrice.sub(single.orderedPrice).div(single.orderedPrice).mul(100).toDecimalPlaces(1).toString() : null;
      return {
        kind: 'INVOICE' as const,
        docNo: invoice.docNo,
        supplierName: invoice.supplierName,
        supplierInvoiceNo: invoice.supplierInvoiceNo,
        poNo: invoice.poNo,
        quantity: { order: toQty(orderedQty), received: toQty(receivedQty), billed: toQty(billedQty), ok: billedQty.lte(receivedQty) },
        unitPrice: single
          ? { order: toPrice(single.orderedPrice), billed: toPrice(single.billedUnitPrice), ok: single.billedUnitPrice.eq(single.orderedPrice) }
          : null,
        difference: { amount: toMoney(priceDiff), pct },
        tolerance: `± ${dec(settings.priceTolerancePct).toDecimalPlaces(2).toString()}% price`,
        supplierNote: invoice.supplierNote,
        billedTotal: toMoney(invoice.billedTotal),
        total: toMoney(invoice.total),
      };
    }
    return null;
  }
}
