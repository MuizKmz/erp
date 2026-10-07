import { Injectable } from '@nestjs/common';
import type { Prisma, SalSalesOrderLine } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { openToDeliver } from '../deliveries/delivery.rules';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT, SAL_LINK } from '../shared/sales.constants';
import { cancelProblems, cancelSummary, CO_LOCKED_MESSAGE, orderAfterCancel, type CancelAction } from './cancel-order.rules';
import { CancelOrdersQuery, type CancelWithLines } from './cancel-orders.query';
import type { CancelLineDto, CreateCancelDto, UpdateCancelDto } from './dto/cancel-order.dto';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const qtyText = (v: Prisma.Decimal) => toQty(v).replace(/\.0+$/, '');

/**
 * Cancel order commands (FlowS6 steps 2–4). Only the undelivered balance is cancelled. Agents draft; only
 * sales.cancel_order.release releases. Nothing is posted: the cancelled part was never invoiced.
 */
@Injectable()
export class CancelOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: CancelOrdersQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
  ) {}

  async create(ctx: RequestContext, dto: CreateCancelDto) {
    const order = await this.prisma.salSalesOrder.findFirst({ where: { id: dto.salesOrderId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!order) throw ValidationFailedError.field('salesOrderId', 'Pick the sales order to cancel.');
    if (order.isMigrated || !['RELEASED', 'PARTIAL'].includes(order.status)) {
      throw new BusinessRuleError('ORDER_NOT_OPEN', `${order.docNo} has no open balance to cancel. Only released orders that are not fully delivered can be cancelled.`);
    }
    if (!dto.reason) throw ValidationFailedError.field('reason', 'Pick the reason for the cancellation.');
    const built = await this.buildLines(ctx, order.lines, dto.lines);
    const docDate = dto.docDate ?? this.clock.today();

    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.CANCEL_ORDER, { date: docDate, branchCode: order.branchCode });
      const row = await tx.salCancelOrder.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode: order.branchCode,
          salesOrderId: order.id, salesOrderNo: order.docNo, customerCode: order.customerCode, customerName: order.customerName,
          reason: dto.reason!, askedBy: dto.askedBy?.trim() || null, customerRef: dto.customerRef?.trim() || null, note: dto.note?.trim() || null,
          summary: built.summary, subtotal: built.subtotal, taxTotal: built.taxTotal, total: built.total,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.ORDER, fromId: order.id, fromNo: order.docNo, toType: SAL_ENTITY.CANCEL_ORDER, toId: row.id, toNo: docNo, linkType: SAL_LINK.CANCELLED } });
      await this.log(tx, ctx, row.id, docNo, 'created', `Drafted by ${ctx.user.name} · ${built.summary} · waiting for the Sales Manager to release`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateCancelDto) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'edit');
    const order = await this.prisma.salSalesOrder.findFirstOrThrow({ where: { id: c.salesOrderId ?? '' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const built = dto.lines ? await this.buildLines(ctx, order.lines, dto.lines, c.id) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, c.id, dto.version, {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.reason && { reason: dto.reason }),
        ...(dto.askedBy !== undefined && { askedBy: dto.askedBy.trim() || null }),
        ...(dto.customerRef !== undefined && { customerRef: dto.customerRef.trim() || null }),
        ...(dto.note !== undefined && { note: dto.note.trim() || null }),
        ...(built && { summary: built.summary, subtotal: built.subtotal, taxTotal: built.taxTotal, total: built.total }),
      });
      if (built) {
        await tx.salCancelOrderLine.deleteMany({ where: { cancelOrderId: c.id } });
        await tx.salCancelOrderLine.createMany({ data: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, cancelOrderId: c.id, lineNo: i + 1 })) });
      }
      await this.log(tx, ctx, c.id, c.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salCancelOrder.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.CANCEL_ORDER, toId: id } });
      await this.log(tx, ctx, id, c.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${c.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: c.docNo };
  }

  /**
   * Release (FlowS6 step 3): the order row is locked, the balance re-checked, the cancelled quantity added to the
   * order lines. When nothing is left to deliver the order closes as Done with "Balance cancelled".
   */
  async release(ctx: RequestContext, id: string, version: number) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'release', 'Only the Sales Manager can release a cancellation (sales.cancel_order.release).');
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sal_sales_order WHERE id = ${c.salesOrderId} FOR UPDATE`;
      const order = await tx.salSalesOrder.findUniqueOrThrow({ where: { id: c.salesOrderId! }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!['RELEASED', 'PARTIAL'].includes(order.status)) throw new BusinessRuleError('ORDER_NOT_OPEN', `${order.docNo} has no open balance any more.`);
      const counted = c.lines.map((l) => ({ line: l, so: order.lines.find((x) => x.id === l.soLineId)! }));
      const problems = cancelProblems(counted.map((x) => ({ qty: x.line.cancelQty, balance: openToDeliver(x.so) })));
      if (problems.length) throw new ValidationFailedError(problems, 'Something was delivered meanwhile. Check the quantities.');

      for (const x of counted) if (x.line.cancelQty.gt(0)) await tx.salSalesOrderLine.update({ where: { id: x.so.id }, data: { cancelledQty: { increment: x.line.cancelQty } } });
      const after = order.lines.map((l) => {
        const x = counted.find((y) => y.so.id === l.id);
        return { ...l, cancelledQty: x ? l.cancelledQty.add(x.line.cancelQty) : l.cancelledQty };
      });
      const next = orderAfterCancel(order.status as 'RELEASED' | 'PARTIAL', after);
      await tx.salSalesOrder.update({ where: { id: order.id }, data: { status: next.status, balanceCancelled: next.balanceCancelled, version: { increment: 1 }, updatedBy: ctx.user.code } });
      await this.bump(tx, ctx, c.id, version, { status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code });

      const qty = qtyText(c.lines.reduce((s, l) => s.add(l.cancelQty), dec(0)));
      const linkedPo = counted.filter((x) => x.so.isBuyToOrder && x.so.purchaseOrderNo).map((x) => x.so.purchaseOrderNo!);
      await this.log(tx, ctx, c.id, c.docNo, 'released', `Released by ${ctx.user.name} · ${qty} cancelled on ${order.docNo}, ${toRmText(c.total)} · nothing posted`);
      await this.activity.log(tx, ctx, {
        entityType: SAL_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'balance_cancelled',
        message: `${c.docNo} released: ${qty} cancelled${next.balanceCancelled ? ' · order closed, balance cancelled' : ''}${linkedPo.length ? ` · Purchase told about ${linkedPo.join(', ')}` : ''}`, comment: null,
      });
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.ORDER_BALANCE_CANCELLED, aggregateType: SAL_ENTITY.CANCEL_ORDER, aggregateId: c.id,
        payload: {
          cancelNo: c.docNo, soNo: order.docNo, branchCode: order.branchCode, warehouseCode: order.warehouseCode, customerCode: order.customerCode,
          reason: c.reason, orderClosed: next.balanceCancelled,
          lines: counted.filter((x) => x.line.cancelQty.gt(0)).map((x) => ({
            lineNo: x.so.lineNo, itemCode: x.so.itemCode, uomCode: x.so.uomCode, qty: toQty(x.line.cancelQty), isBuyToOrder: x.so.isBuyToOrder, purchaseOrderNo: x.so.purchaseOrderNo,
          })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Lines with the balance free to cancel now (other drafts excluded) and their value at the order's price and tax. */
  private async buildLines(ctx: RequestContext, soLines: SalSalesOrderLine[], input: CancelLineDto[], excludeId?: string) {
    const held = await this.query.heldByDrafts(ctx.tenantId, soLines.map((l) => l.id), excludeId);
    const picked = input.map((w, index) => {
      const so = soLines.find((l) => l.id === w.soLineId);
      if (!so) throw ValidationFailedError.field(`lines[${index}].soLineId`, 'This line is not on the sales order.');
      return { so, qty: dec(w.qty), balance: openToDeliver(so).sub(held.get(so.id) ?? dec(0)) };
    });
    const problems = cancelProblems(picked.map((p) => ({ qty: p.qty, balance: p.balance.gt(0) ? p.balance : dec(0) })));
    if (problems.length) throw new ValidationFailedError(problems, 'Check the quantities to cancel.');
    const lines = picked.filter((p) => p.qty.gt(0)).map(({ so, qty }) => {
      const v = this.query.value(so, qty);
      return {
        soLineId: so.id, itemId: so.itemId, itemCode: so.itemCode, itemName: so.itemName, uomCode: so.uomCode, taxCode: so.taxCode, taxRate: so.taxRate,
        unitPrice: so.unitPrice, orderedQty: so.orderedQty, deliveredQty: so.deliveredQty, invoicedQty: so.invoicedQty, balanceQty: openToDeliver(so), cancelQty: qty,
        amount: v.amount, taxAmount: v.taxAmount,
      };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.amount), dec(0));
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), dec(0));
    return {
      lines,
      subtotal,
      taxTotal,
      total: subtotal.add(taxTotal),
      summary: cancelSummary(soLines.map((so) => ({ itemName: so.itemName, ordered: so.orderedQty, delivered: so.deliveredQty, cancel: lines.find((l) => l.soLineId === so.id)?.cancelQty ?? dec(0) }))),
    };
  }

  private require(ctx: RequestContext, c: CancelWithLines, action: CancelAction, message?: string) {
    if (!this.query.actions(ctx, c).includes(action)) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', c.status === 'DRAFT' && !c.isMigrated ? (message ?? 'You cannot change cancellations.') : CO_LOCKED_MESSAGE);
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalCancelOrderUpdateManyMutationInput) {
    const result = await tx.salCancelOrder.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.CANCEL_ORDER, entityId: id, docNo, action, message, comment: null });
  }
}

