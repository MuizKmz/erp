import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { breachText, creditActivityText } from '../shared/credit.rules';
import { SalesDocumentLines } from '../shared/document-lines.service';
import { SalesMailService } from '../shared/sales-mail.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT, SAL_LINK, SAL_ROLE } from '../shared/sales.constants';
import { DeliveriesQuery, type DeliveryWithLines } from './deliveries.query';
import { deliverProblems, DO_LOCKED_MESSAGE, openToDeliver, orderStatusAfterDelivery, type DeliveryAction } from './delivery.rules';
import type { DeliveryApprovalDto, UpdateDeliveryDto } from './dto/delivery.dto';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const qtyText = (lines: { qty: Prisma.Decimal; uomCode: string }[]) =>
  lines.filter((l) => l.qty.gt(0)).map((l) => `${toQty(l.qty).replace(/\.0+$/, '')} ${l.uomCode}`).join(', ');

/**
 * Delivery order commands (FlowS2 steps 7–9). Sales confirms deliveries until Inventory takes over: confirming
 * raises the order's delivered quantity in the same transaction and saves `sales.shipment.requested`.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: DeliveriesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly outbox: OutboxWriter,
    private readonly mail: SalesMailService,
    private readonly docs: SalesDocumentLines,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  /** "Create DO" from the waiting list (S15): a draft for everything still open on a released order. */
  async create(ctx: RequestContext, salesOrderId: string) {
    if (!this.permissions.has(ctx.user.roles, P.DELIVERY_EDIT)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', 'Only the store team can create delivery orders.');
    const order = await this.prisma.salSalesOrder.findFirst({ where: { id: salesOrderId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!order) throw ValidationFailedError.field('salesOrderId', 'Pick a released sales order.');
    if (order.isMigrated || !['RELEASED', 'PARTIAL'].includes(order.status)) {
      throw new BusinessRuleError('ORDER_NOT_DELIVERABLE', `${order.docNo} is not waiting for delivery. Only released orders with a balance can be delivered.`);
    }
    const cancelling = await this.prisma.salCancelOrderLine.findMany({
      where: { tenantId: ctx.tenantId, soLineId: { in: order.lines.map((l) => l.id) }, cancelOrder: { status: 'DRAFT' } },
      select: { soLineId: true, cancelQty: true },
    });
    const open = order.lines
      .map((l) => ({ l, balance: openToDeliver(l).sub(cancelling.filter((c) => c.soLineId === l.id).reduce((s, c) => s.add(c.cancelQty), dec(0))) }))
      .filter((x) => x.balance.gt(0));
    if (!open.length) throw new BusinessRuleError('NOTHING_TO_DELIVER', `${order.docNo} has nothing left to deliver.`);

    const docDate = this.clock.today();
    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.DELIVERY, { date: docDate, branchCode: order.branchCode });
      const row = await tx.salDelivery.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode: order.branchCode,
          salesOrderId: order.id, salesOrderNo: order.docNo, customerCode: order.customerCode, customerName: order.customerName,
          warehouseCode: order.warehouseCode, deliverTo: order.deliveryAddress, receiver: order.contactName,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: {
            create: open.map(({ l, balance }, i) => ({
              tenantId: ctx.tenantId, lineNo: i + 1, soLineId: l.id, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
              orderedQty: l.orderedQty, deliveredBeforeQty: l.deliveredQty, qty: balance,
            })),
          },
        },
      });
      await tx.sysDocLink.create({
        data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.ORDER, fromId: order.id, fromNo: order.docNo, toType: SAL_ENTITY.DELIVERY, toId: row.id, toNo: docNo, linkType: SAL_LINK.DELIVERED },
      });
      await this.log(tx, ctx, row.id, docNo, 'created', `Created from ${order.docNo} by ${ctx.user.name}`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateDeliveryDto) {
    const d = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, d, 'edit', this.lockedMessage(d));
    const lines = this.query.linesOf(d);
    const changes = new Map((dto.lines ?? []).map((l) => [l.lineNo, dec(l.qty)]));
    const problems = deliverProblems(lines.map((x) => ({ qty: changes.get(x.line.lineNo) ?? x.line.qty, balance: x.balance }))).filter((p) => p.field !== 'lines');
    if (problems.length) throw new ValidationFailedError(problems, 'Check the quantities before you save.');
    const qtyChanged = lines.some((x) => changes.has(x.line.lineNo) && !changes.get(x.line.lineNo)!.eq(x.line.qty));

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, d.id, dto.version, {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.vehicle !== undefined && { vehicle: dto.vehicle.trim() || null }),
        ...(dto.driver !== undefined && { driver: dto.driver.trim() || null }),
        ...(dto.consignmentNote !== undefined && { consignmentNote: dto.consignmentNote.trim() || null }),
        ...(dto.deliverTo !== undefined && { deliverTo: dto.deliverTo.trim() || null }),
        ...(dto.receiver !== undefined && { receiver: dto.receiver.trim() || null }),
        ...(dto.warehouseNote !== undefined && { warehouseNote: dto.warehouseNote.trim() || null }),
        // Changing what was approved removes the credit approval.
        ...(qtyChanged && d.approvedAt && { approvedAt: null }),
      });
      for (const x of lines) {
        const qty = changes.get(x.line.lineNo);
        if (qty && !qty.eq(x.line.qty)) await tx.salDeliveryLine.update({ where: { id: x.line.id }, data: { qty } });
      }
      await this.log(tx, ctx, d.id, d.docNo, 'saved', `Saved by ${ctx.user.name}`);
      if (qtyChanged && d.approvedAt) await this.log(tx, ctx, d.id, d.docNo, 'approval_cleared', 'Approval cleared: the quantities changed after it was approved', null, 1);
    });
    return this.query.detail(ctx, id);
  }

  /** Deletes a draft DO. Its number is not reused. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const d = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, d, 'delete', this.lockedMessage(d));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salDelivery.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.DELIVERY, toId: id } });
      await this.approvals.cancelPending(tx, ctx, SAL_ENTITY.DELIVERY, id);
      await this.log(tx, ctx, id, d.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${d.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: d.docNo };
  }

  // ── Credit approval (policy "Delivery order": over the overdue limit → Sales Manager) ──

  async requestApproval(ctx: RequestContext, id: string, dto: DeliveryApprovalDto) {
    const d = await this.query.load(ctx.tenantId, id);
    const credit = await this.query.liveCredit(ctx, d);
    if (!credit || credit.check.action !== 'APPROVAL') {
      throw new BusinessRuleError('APPROVAL_NOT_NEEDED', credit?.check.action === 'BLOCK'
        ? `The credit check blocks this delivery: ${breachText(credit.check)}. It cannot be approved.`
        : 'The credit check passed. Confirm the delivery directly.');
    }
    await this.requireAction(ctx, d, 'requestApproval', this.lockedMessage(d));
    const step = await this.docs.approver(ctx, credit.approverRole ?? SAL_ROLE.MANAGER, d.branchCode);
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, d.id, dto.version, { creditResult: 'OVER_LIMIT', creditSnapshot: credit.snapshot });
      await this.approvals.create(tx, ctx, {
        entityType: SAL_ENTITY.DELIVERY, entityId: d.id, docNo: d.docNo, amount: dec(credit.input.thisDocument),
        title: `${d.docNo} · ${d.customerName}`,
        reason: `${breachText(credit.check)} · delivery of ${d.salesOrderNo}`,
        requesterNote: dto.reason, steps: [step],
      });
      await this.log(tx, ctx, d.id, d.docNo, 'approval_requested', `Sent for approval to ${step.approverName ?? step.approverRole}`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  // ── Confirm (FlowS2 step 8) ───────────────────────────────────────────────

  /**
   * The sales order row is locked first, so two delivery orders for the same order can never together deliver
   * more than its balance (rule 1). A released proforma that is not paid holds the delivery (rule 9).
   */
  async confirm(ctx: RequestContext, id: string, version: number) {
    const d = await this.query.load(ctx.tenantId, id);
    if (!d.salesOrder) throw new BusinessRuleError('ORDER_MISSING', `${d.docNo} has no sales order to deliver.`);
    const credit = await this.query.liveCredit(ctx, d);
    if (d.status === 'DRAFT' && credit && !d.approvedAt) {
      if (credit.check.action === 'BLOCK') throw new BusinessRuleError('CREDIT_BLOCKED', `${creditActivityText(credit.input, credit.check)}. The delivery cannot be confirmed.`);
      if (credit.check.action === 'APPROVAL') throw new BusinessRuleError('CREDIT_APPROVAL_REQUIRED', `${creditActivityText(credit.input, credit.check)}. Type a reason and request approval.`);
    }
    await this.requireAction(ctx, d, 'confirm', this.lockedMessage(d));
    const hold = (await this.query.unpaidProformas(ctx.tenantId, [d.salesOrder.id])).get(d.salesOrder.id);
    if (hold) {
      throw new BusinessRuleError('DEPOSIT_UNPAID', `Delivery of ${d.salesOrderNo} is on hold until the deposit on ${hold.docNo} (${toRmText(hold.amount)}) is paid.`);
    }
    const customer = await this.masterData.findCustomer(ctx.tenantId, d.customerCode);
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sal_sales_order WHERE id = ${d.salesOrder!.id} FOR UPDATE`;
      const order = await tx.salSalesOrder.findUniqueOrThrow({ where: { id: d.salesOrder!.id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!['RELEASED', 'PARTIAL'].includes(order.status)) {
        throw new BusinessRuleError('ORDER_NOT_DELIVERABLE', `${order.docNo} is ${order.status === 'DONE' ? 'already fully delivered or closed' : 'not released'}. Nothing more can be delivered.`);
      }
      const counted = d.lines.map((l) => {
        const so = order.lines.find((x) => x.id === l.soLineId)!;
        return { line: l, so, balance: openToDeliver(so) };
      });
      const problems = deliverProblems(counted.map((c) => ({ qty: c.line.qty, balance: c.balance })));
      if (problems.length) throw new ValidationFailedError(problems, 'Check the quantities before you confirm.');

      await this.bump(tx, ctx, d.id, version, {
        status: 'CONFIRMED', confirmedAt: now, confirmedByCode: ctx.user.code, confirmedByName: ctx.user.name,
        ...(credit && !d.approvedAt && { creditResult: credit.check.result, creditSnapshot: credit.snapshot }),
      }, 'DRAFT');
      for (const c of counted) {
        if (c.line.qty.eq(0)) {
          await tx.salDeliveryLine.delete({ where: { id: c.line.id } });
          continue;
        }
        await tx.salDeliveryLine.update({ where: { id: c.line.id }, data: { orderedQty: c.so.orderedQty, deliveredBeforeQty: c.so.deliveredQty } });
        await tx.salSalesOrderLine.update({ where: { id: c.so.id }, data: { deliveredQty: { increment: c.line.qty } } });
      }
      const after = order.lines.map((l) => {
        const c = counted.find((x) => x.so.id === l.id);
        return { ...l, deliveredQty: c ? l.deliveredQty.add(c.line.qty) : l.deliveredQty };
      });
      const status = orderStatusAfterDelivery(after);
      await tx.salSalesOrder.update({ where: { id: order.id }, data: { status, version: { increment: 1 }, updatedBy: ctx.user.code } });

      const delivered = qtyText(counted.map((c) => ({ qty: c.line.qty, uomCode: c.line.uomCode })));
      const balance = after.reduce((s, l) => s.add(openToDeliver(l)), dec(0));
      if (credit?.check.action === 'WARN') await this.log(tx, ctx, d.id, d.docNo, 'credit_check', creditActivityText(credit.input, credit.check));
      await this.log(tx, ctx, d.id, d.docNo, 'confirmed', `Confirmed by ${ctx.user.name} · ${delivered} delivered${d.driver ? `, driver ${d.driver}` : ''} · event saved for Inventory`, null, 1);
      await this.activity.log(tx, ctx, {
        entityType: SAL_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'delivered',
        message: `${d.docNo} confirmed: ${delivered} delivered, balance ${toQty(balance).replace(/\.0+$/, '')}`, comment: null,
      });
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.SHIPMENT_REQUESTED, aggregateType: SAL_ENTITY.DELIVERY, aggregateId: d.id,
        payload: {
          doNo: d.docNo, soNo: order.docNo, branchCode: d.branchCode, warehouseCode: d.warehouseCode, customerCode: d.customerCode,
          deliverTo: d.deliverTo, vehicle: d.vehicle, driver: d.driver, consignmentNote: d.consignmentNote,
          lines: counted.filter((c) => c.line.qty.gt(0)).map((c) => ({ lineNo: c.line.lineNo, itemCode: c.line.itemCode, uomCode: c.line.uomCode, qty: toQty(c.line.qty) })),
        },
      }]);
      if (customer?.email) {
        await this.mail.send(tx, ctx, {
          templateKey: 'DELIVERY_NOTICE', entityType: SAL_ENTITY.DELIVERY, entityId: d.id, docNo: d.docNo, to: customer.email,
          vars: { 'contact.name': order.contactName ?? customer.contactName ?? customer.name, 'document.number': d.docNo, 'document.customer_ref': order.customerPoRef ?? '—', 'document.total': toMoney(0) },
        });
      }
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private lockedMessage(d: DeliveryWithLines): string {
    if (d.isMigrated) return 'Migrated delivery orders cannot be changed.';
    if (d.status === 'CONFIRMED') return DO_LOCKED_MESSAGE;
    return `${d.docNo} is waiting for credit approval and is locked.`;
  }

  private async requireAction(ctx: RequestContext, d: DeliveryWithLines, action: DeliveryAction, message: string) {
    const [credit, approvals] = await Promise.all([this.query.liveCredit(ctx, d), this.approvals.listForEntity(ctx.tenantId, SAL_ENTITY.DELIVERY, d.id)]);
    const actions = this.query.actions(ctx, d, credit, approvals[0]?.status === 'PENDING');
    if (!actions.includes(action)) {
      const canEdit = this.permissions.has(ctx.user.roles, P.DELIVERY_EDIT) || this.permissions.has(ctx.user.roles, P.DELIVERY_CONFIRM);
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', canEdit ? message : 'Only the store team can change delivery orders.');
    }
  }

  /** Optimistic lock + status guard. */
  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalDeliveryUpdateManyMutationInput, status?: 'DRAFT') {
    const result = await tx.salDelivery.updateMany({
      where: { id, tenantId: ctx.tenantId, version, ...(status && { status }) },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment?: string | null, afterMs = 0) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.DELIVERY, entityId: id, docNo, action, message, comment: comment ?? null, afterMs });
  }
}
