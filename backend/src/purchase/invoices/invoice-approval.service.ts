import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import type { DecisionResult } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { toMoney, toRmText } from '../../platform/http/decimal';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import type { Tx } from '../../platform/prisma/prisma.service';
import { PUR_ENTITY } from '../shared/purchase.constants';

/**
 * What an approval decision does to a supplier invoice (FlowP5 step 6). The invoice screens themselves
 * come in step 8; this keeps the approvals inbox working for invoices outside tolerance.
 *   Approve → accepted as billed: APPROVED, billed quantities updated, payable queued for Finance.
 *   Reject  → REJECTED with the approver's comment ("ask for a new bill").
 */
@Injectable()
export class InvoiceApprovalService {
  constructor(
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
  ) {}

  async onApprovalDecision(tx: Tx, ctx: RequestContext, result: DecisionResult, comment: string | null) {
    const invoice = await tx.purInvoice.findFirstOrThrow({ where: { id: result.entityId, tenantId: ctx.tenantId } });
    const log = (action: string, message: string) =>
      this.activity.log(tx, ctx, { entityType: PUR_ENTITY.INVOICE, entityId: invoice.id, docNo: invoice.docNo, action, message, comment });

    if (result.outcome === 'NEXT_STEP') {
      await log('approved_step', `Approved by ${ctx.user.name} · waiting for the next approver`);
      return;
    }

    if (result.outcome === 'REJECTED') {
      await tx.purInvoice.update({
        where: { id: invoice.id },
        data: { status: 'REJECTED', rejectReason: comment, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      await log('rejected', `Rejected by ${ctx.user.name} · ask the supplier for a new bill`);
      return;
    }

    await this.postApproved(tx, ctx, invoice.id, { status: 'APPROVED' });
    await log('approved', `Approved by ${ctx.user.name} · recorded as billed (${toRmText(invoice.total)})`);
  }

  /**
   * An invoice becomes a payable: APPROVED, billed quantities move on the PO line and the goods receipt line
   * in the same transaction, and the payable is queued for Finance. Used by the approvals inbox and by
   * recording an invoice inside tolerance (or for what was received).
   */
  async postApproved(tx: Tx, ctx: RequestContext, invoiceId: string, data: Prisma.PurInvoiceUpdateInput) {
    const now = this.clock.now();
    const invoice = await tx.purInvoice.update({
      where: { id: invoiceId },
      data: { ...data, approvedAt: now, approvedByCode: ctx.user.code, version: { increment: 1 }, updatedBy: ctx.user.code },
      include: { lines: true },
    });
    for (const line of invoice.lines) {
      await tx.purPurchaseOrderLine.update({ where: { id: line.poLineId }, data: { billedQty: { increment: line.qty } } });
      if (line.grnLineId) {
        await tx.purGoodsReceiptLine.update({ where: { id: line.grnLineId }, data: { billedQty: { increment: line.qty } } });
      }
    }
    await this.outbox.publish(tx, ctx, [{
      name: 'purchase.invoice.approved',
      aggregateType: PUR_ENTITY.INVOICE,
      aggregateId: invoice.id,
      payload: {
        piNo: invoice.docNo,
        supplierCode: invoice.supplierCode,
        supplierInvoiceNo: invoice.supplierInvoiceNo,
        poNo: invoice.poNo,
        subtotal: toMoney(invoice.subtotal),
        taxTotal: toMoney(invoice.taxTotal),
        total: toMoney(invoice.total),
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      },
    }]);
  }
}
