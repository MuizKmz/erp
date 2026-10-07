import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService, type DecisionResult } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CreateOrderDto, OrderLineDto, SubmitOrderDto, UpdateOrderDto } from './dto/order.dto';
import { RELEASED_EDITABLE, type OrderAction } from './order.rules';
import { OrdersQuery, type OrderWithLines } from './orders.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dateText = (d: Date | null) => {
  if (!d) return '';
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
};

/** Where a new draft PO comes from (shown as "Source" on the list and in the subtitle). */
export interface DraftSource {
  sourceType: 'BUYER' | 'REQUEST' | 'RFQ' | 'SALES_ORDER';
  sourceNo?: string;
  requestId?: string;
  rfqId?: string;
  /** Buy-to-order: the sales order and customer, kept on the header and on every line. */
  salesOrderNo?: string;
  customerName?: string;
  /** Who the PO belongs to when the system drafts it (defaults to the acting user). */
  buyer?: { code: string; name: string };
  /** First activity line, e.g. "Created from PRQ-0006 by Lim Mei Ying" */
  message?: string;
}

const LOCKED_MESSAGE =
  'Released orders are locked. Fix them with a Cancel order, a Purchase return or a Supplier debit note.';

/**
 * Purchase order commands (FlowP3). Every change runs in one transaction: the document, its activity,
 * emails (logged) and outbox events.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: OrdersQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly outbox: OutboxWriter,
    private readonly mail: PurchaseMailService,
    private readonly settings: PurchaseSettingsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Create and save ───────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateOrderDto) {
    const prepared = await this.prepareDraft(ctx, dto);
    const { id } = await this.prisma.$transaction((tx) => this.insertDraft(tx, ctx, prepared, { sourceType: 'BUYER' }));
    return this.query.detail(ctx, id);
  }

  /**
   * Validates a new draft against Master Data (supplier active, items purchasable, warehouse in the
   * user's branches) and builds the line snapshots. Done before the transaction so it stays short.
   */
  async prepareDraft(ctx: RequestContext, dto: CreateOrderDto) {
    const docDate = dto.docDate ?? this.clock.today();
    this.checkDates(docDate, dto.expectedDate ?? null);
    const header = await this.resolveHeader(ctx, dto.supplierCode, dto.warehouseCode);
    const lines = await this.buildLines(ctx, dto.lines);
    return { dto, docDate, header, lines, totals: documentTotals(lines) };
  }

  /** Writes a prepared draft PO in the caller's transaction: number, lines, activity. */
  async insertDraft(
    tx: Tx,
    ctx: RequestContext,
    prepared: Awaited<ReturnType<OrdersService['prepareDraft']>>,
    source: DraftSource,
  ): Promise<{ id: string; docNo: string }> {
    const { dto, docDate, header, lines, totals } = prepared;
    const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.ORDER);
    const order = await tx.purPurchaseOrder.create({
      data: {
        tenantId: ctx.tenantId,
        docNo,
        docDate: day(docDate),
        status: 'DRAFT',
        branchCode: header.warehouse.branchCode,
        poTypeCode: dto.poTypeCode ?? 'STD',
        supplierId: header.supplier.id,
        supplierCode: header.supplier.code,
        supplierName: header.supplier.name,
        buyerCode: source.buyer?.code ?? ctx.user.code,
        buyerName: source.buyer?.name ?? ctx.user.name,
        warehouseCode: header.warehouse.code,
        warehouseName: header.warehouse.name,
        expectedDate: dto.expectedDate ? day(dto.expectedDate) : null,
        paymentTermDays: header.supplier.paymentTermDays,
        currency: header.supplier.currency,
        supplierQuoteRef: dto.supplierQuoteRef?.trim() || null,
        noteToSupplier: dto.noteToSupplier?.trim() || null,
        remarks: dto.remarks?.trim() || null,
        sourceType: source.sourceType,
        sourceNo: source.sourceNo ?? null,
        requestId: source.requestId ?? null,
        rfqId: source.rfqId ?? null,
        salesOrderNo: source.salesOrderNo ?? null,
        customerName: source.customerName ?? null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdBy: ctx.user.code,
        updatedBy: ctx.user.code,
        lines: { create: lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1, salesOrderNo: source.salesOrderNo ?? null })) },
      },
    });
    await this.activity.log(tx, ctx, {
      entityType: PUR_ENTITY.ORDER,
      entityId: order.id,
      docNo,
      action: 'created',
      message: source.message ?? `Created by ${ctx.user.name}`,
    });
    return { id: order.id, docNo };
  }

  async update(ctx: RequestContext, id: string, dto: UpdateOrderDto) {
    const order = await this.query.load(ctx.tenantId, id);
    const actions = await this.actionsFor(ctx, order);

    if (order.status !== 'DRAFT') {
      return this.updateDelivery(ctx, order, actions, dto);
    }
    this.require(actions, 'edit', order.status === 'DRAFT' && order.isMigrated ? 'Migrated orders cannot be changed.' : LOCKED_MESSAGE);

    const header =
      dto.supplierCode || dto.warehouseCode
        ? await this.resolveHeader(ctx, dto.supplierCode ?? order.supplierCode, dto.warehouseCode ?? order.warehouseCode)
        : null;
    const lines = dto.lines ? await this.buildLines(ctx, dto.lines) : null;
    const totals = lines ? documentTotals(lines) : null;
    const docDate = dto.docDate ?? order.docDate.toISOString().slice(0, 10);
    const expected = dto.expectedDate === undefined ? (order.expectedDate?.toISOString().slice(0, 10) ?? null) : dto.expectedDate;
    this.checkDates(docDate, expected);

    // Changing what was approved removes the approval: the new order must be approved again.
    const totalChanged = totals !== null && !totals.total.eq(order.total);
    const supplierChanged = header !== null && header.supplier.code !== order.supplierCode;
    const clearApproval = Boolean(order.approvedAt) && (totalChanged || supplierChanged);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurPurchaseOrderUpdateManyMutationInput = {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.expectedDate !== undefined && { expectedDate: dto.expectedDate ? day(dto.expectedDate) : null }),
        ...(dto.poTypeCode && { poTypeCode: dto.poTypeCode }),
        ...(dto.supplierQuoteRef !== undefined && { supplierQuoteRef: dto.supplierQuoteRef.trim() || null }),
        ...(dto.noteToSupplier !== undefined && { noteToSupplier: dto.noteToSupplier.trim() || null }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(header && {
          branchCode: header.warehouse.branchCode,
          supplierId: header.supplier.id,
          supplierCode: header.supplier.code,
          supplierName: header.supplier.name,
          paymentTermDays: header.supplier.paymentTermDays,
          currency: header.supplier.currency,
          warehouseCode: header.warehouse.code,
          warehouseName: header.warehouse.name,
        }),
        ...(totals && { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total }),
        ...(clearApproval && { approvedAt: null, approvalRequired: false }),
      };
      await this.bump(tx, ctx, order.id, dto.version, data);
      if (lines) {
        await tx.purPurchaseOrderLine.deleteMany({ where: { poId: order.id } });
        await tx.purPurchaseOrderLine.createMany({
          data: lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, poId: order.id, lineNo: i + 1 })),
        });
      }
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'saved', message: `Saved by ${ctx.user.name}`,
      });
      if (clearApproval) {
        await this.activity.log(tx, ctx, {
          entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'approval_cleared',
          message: 'Approval cleared: the order changed after it was approved',
        });
      }
    });
    return this.query.detail(ctx, id);
  }

  /** After release only the delivery promise may change (FlowP3 step 7). */
  private async updateDelivery(ctx: RequestContext, order: OrderWithLines, actions: OrderAction[], dto: UpdateOrderDto) {
    this.require(actions, 'updateDelivery', LOCKED_MESSAGE);
    const lockedFields = Object.keys(dto).filter(
      (k) => k !== 'version' && !(RELEASED_EDITABLE as readonly string[]).includes(k) && dto[k as keyof UpdateOrderDto] !== undefined,
    );
    if (lockedFields.length) throw new BusinessRuleError('ORDER_LOCKED', LOCKED_MESSAGE);

    const changes: string[] = [];
    if (dto.expectedDate !== undefined) changes.push(`expected delivery ${dateText(dto.expectedDate ? day(dto.expectedDate) : null) || 'cleared'}`);
    if (dto.promisedDate !== undefined) changes.push(`supplier promised ${dateText(dto.promisedDate ? day(dto.promisedDate) : null) || 'nothing'}`);
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, order.id, dto.version, {
        ...(dto.expectedDate !== undefined && { expectedDate: dto.expectedDate ? day(dto.expectedDate) : null }),
        ...(dto.promisedDate !== undefined && { promisedDate: dto.promisedDate ? day(dto.promisedDate) : null }),
        ...(dto.supplierSays !== undefined && { supplierSays: dto.supplierSays?.trim() || null }),
      });
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'delivery_updated',
        message: changes.length ? `Delivery updated: ${changes.join(', ')}` : 'Delivery note updated',
        comment: dto.supplierSays ?? null,
      });
    });
    return this.query.detail(ctx, order.id);
  }

  /** Deletes a draft. Its number is not reused: the gap shows in the sequence. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const order = await this.query.load(ctx.tenantId, id);
    this.require(await this.actionsFor(ctx, order), 'delete', 'Only draft orders can be deleted.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purPurchaseOrder.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: id, docNo: order.docNo, action: 'deleted',
        message: `Draft deleted by ${ctx.user.name}. ${order.docNo} will not be used again.`,
      });
    });
    return { deleted: true, docNo: order.docNo };
  }

  // ── Approval (P11) ────────────────────────────────────────────────────────

  async submitForApproval(ctx: RequestContext, id: string, dto: SubmitOrderDto) {
    const order = await this.query.load(ctx.tenantId, id);
    const need = await this.query.approvalNeed(ctx.tenantId, order);
    const actions = this.query.actions(ctx, order, need);
    if (!need.required) {
      throw new BusinessRuleError('APPROVAL_NOT_NEEDED', `${need.reason} Release it directly.`);
    }
    this.require(actions, 'submit', order.status === 'PENDING_APPROVAL' ? `${order.docNo} is already waiting for approval.` : LOCKED_MESSAGE);
    await this.assertRfq(ctx, order);

    // The user may pick another approver with the same role (never the buyer).
    const steps = need.steps.map((s) => ({ ...s }));
    const first = steps[0]!;
    if (dto.approverCode && dto.approverCode !== first.approverCode) {
      const chosen = (await this.masterData.listUsers(ctx.tenantId)).find((u) => u.code === dto.approverCode);
      if (!chosen || !chosen.isActive || !chosen.roles.includes(first.approverRole) || !chosen.branchCodes.includes(order.branchCode)) {
        throw ValidationFailedError.field('approverCode', 'Pick an approver who holds the required role in this branch.');
      }
      first.approverCode = chosen.code;
      first.approverName = chosen.name;
    }
    const settings = await this.settings.settings(ctx.tenantId);
    if (settings.buyerCannotApproveOwnPo && steps.some((s) => s.approverCode === order.buyerCode)) {
      throw new BusinessRuleError('APPROVAL_SELF', 'The buyer cannot approve their own PO. Pick another approver.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, order.id, dto.version, { status: 'PENDING_APPROVAL', approvalRequired: true, approvedAt: null }, 'DRAFT');
      await this.approvals.create(tx, ctx, {
        entityType: PUR_ENTITY.ORDER,
        entityId: order.id,
        docNo: order.docNo,
        amount: order.total,
        title: `${order.docNo} · ${order.supplierName}`,
        reason: order.salesOrderNo ? `${need.reason.replace(/\.$/, '')} · buy to order for ${order.salesOrderNo}` : need.reason,
        requesterNote: dto.note ?? null,
        steps,
      });
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'submitted',
        message: `Sent for approval to ${first.approverName ?? first.approverRole}`, comment: dto.note?.trim() || null,
      });
      await this.notifyApprover(tx, ctx, order, first, need.reason, dto.note ?? null);
    });
    return this.query.detail(ctx, id);
  }

  /** Called by the approvals inbox after a decision on a PO, inside its transaction. */
  async onApprovalDecision(tx: Tx, ctx: RequestContext, result: DecisionResult, comment: string | null) {
    const order = await tx.purPurchaseOrder.findFirstOrThrow({ where: { id: result.entityId, tenantId: ctx.tenantId }, include: { lines: true } });
    const log = (action: string, message: string) =>
      this.activity.log(tx, ctx, { entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action, message, comment });

    if (result.outcome === 'NEXT_STEP') {
      const request = await tx.sysApprovalRequest.findUniqueOrThrow({ where: { id: result.requestId }, include: { steps: true } });
      const next = request.steps.find((s) => s.status === 'WAITING');
      await log('approved_step', `Approved by ${ctx.user.name} · now waiting for ${next?.approverName ?? next?.approverRole ?? 'the next approver'}`);
      if (next) {
        const need = await this.query.approvalNeed(ctx.tenantId, order);
        await this.notifyApprover(tx, ctx, order, next, need.reason, request.requesterNote);
      }
      return;
    }
    if (result.outcome === 'APPROVED') {
      await tx.purPurchaseOrder.update({
        where: { id: order.id },
        data: { status: 'DRAFT', approvedAt: this.clock.now(), version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      await log('approved', `Approved by ${ctx.user.name} · ready to release`);
      return;
    }
    await tx.purPurchaseOrder.update({
      where: { id: order.id },
      data: { status: 'DRAFT', approvedAt: null, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    await log('rejected', `Rejected by ${ctx.user.name} · back to draft`);
  }

  // ── Release and email ─────────────────────────────────────────────────────

  async release(ctx: RequestContext, id: string, version: number) {
    const order = await this.query.load(ctx.tenantId, id);
    const need = await this.query.approvalNeed(ctx.tenantId, order);
    const actions = this.query.actions(ctx, order, need);
    if (order.status === 'DRAFT' && need.required && !order.approvedAt) {
      throw new BusinessRuleError('APPROVAL_REQUIRED', `${need.reason} Send it for approval first.`);
    }
    this.require(actions, 'release', order.status === 'PENDING_APPROVAL' ? `${order.docNo} is waiting for approval.` : `${order.docNo} is already released.`);
    await this.assertRfq(ctx, order);
    const supplier = await this.masterData.findSupplier(ctx.tenantId, order.supplierCode);
    if (!supplier || supplier.status !== 'ACTIVE') {
      throw new BusinessRuleError('SUPPLIER_BLOCKED', `${order.supplierName} is blocked in Master Data. Only active suppliers can be used.`);
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, order.id, version, {
        status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code, releasedByName: ctx.user.name,
      }, 'DRAFT');

      // "Send automatically on release" (Email Templates P26)
      let emailedTo: string | null = null;
      if (supplier.email && (await this.mail.isAutoSend(tx, ctx, 'PO_TO_SUPPLIER'))) {
        const sent = await this.mail.send(tx, ctx, this.poMail(order, supplier.email, supplier.shortName ?? supplier.name, ctx));
        if (sent) {
          emailedTo = sent.to;
          await tx.purPurchaseOrder.update({ where: { id: order.id }, data: { emailedAt: now } });
        }
      }

      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'released',
        message: emailedTo ? `Released · emailed to ${emailedTo}` : supplier.email ? 'Released' : 'Released · the supplier has no email address in Master Data',
      });
      await this.outbox.publish(tx, ctx, [{
        name: 'purchase.order.released',
        aggregateType: PUR_ENTITY.ORDER,
        aggregateId: order.id,
        payload: {
          poNo: order.docNo,
          branchCode: order.branchCode,
          supplierCode: order.supplierCode,
          expectedDate: order.expectedDate?.toISOString().slice(0, 10) ?? null,
          warehouseCode: order.warehouseCode,
          total: toMoney(order.total),
          lines: order.lines.map((l) => ({
            itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.orderedQty), unitPrice: l.unitPrice.toFixed(4), amount: toMoney(l.amount),
          })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  /** "Email to supplier": sends (logs) the PO email again. */
  async email(ctx: RequestContext, id: string) {
    const order = await this.query.load(ctx.tenantId, id);
    this.require(await this.actionsFor(ctx, order), 'email', 'Only released orders can be emailed to the supplier.');
    const supplier = await this.masterData.findSupplier(ctx.tenantId, order.supplierCode);
    if (!supplier?.email) {
      throw new BusinessRuleError('NO_SUPPLIER_EMAIL', `${order.supplierName} has no email address in Master Data.`);
    }
    const to = await this.prisma.$transaction(async (tx) => {
      const sent = await this.mail.send(tx, ctx, this.poMail(order, supplier.email!, supplier.shortName ?? supplier.name, ctx));
      if (!sent) throw new BusinessRuleError('TEMPLATE_OFF', 'The "Purchase order to supplier" email template is switched off.');
      await tx.purPurchaseOrder.update({ where: { id: order.id }, data: { emailedAt: this.clock.now() } });
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, action: 'emailed', message: `Emailed to ${sent.to}`,
      });
      return sent.to;
    });
    return { sentTo: to };
  }

  /** Links a PO to the document it came from (used when RFQs and requests create POs in later steps). */
  async link(tx: Tx, ctx: RequestContext, from: { type: string; id: string | null; no: string }, order: { id: string; docNo: string }, linkType: string = DOC_LINK.CONVERTED) {
    await tx.sysDocLink.create({
      data: { tenantId: ctx.tenantId, fromType: from.type, fromId: from.id, fromNo: from.no, toType: PUR_ENTITY.ORDER, toId: order.id, toNo: order.docNo, linkType },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async actionsFor(ctx: RequestContext, order: OrderWithLines) {
    return this.query.actions(ctx, order, await this.query.approvalNeed(ctx.tenantId, order));
  }

  private require(actions: OrderAction[], action: OrderAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  /** Optimistic lock + optional status guard: refuses if someone else changed the order meanwhile. */
  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurPurchaseOrderUpdateManyMutationInput, status?: 'DRAFT') {
    const result = await tx.purPurchaseOrder.updateMany({
      where: { id, tenantId: ctx.tenantId, version, ...(status && { status }) },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private async assertRfq(ctx: RequestContext, order: OrderWithLines) {
    const rfq = await this.query.rfqCheck(ctx.tenantId, order, this.clock.today());
    if (!rfq.satisfied) throw new BusinessRuleError('RFQ_REQUIRED', rfq.message);
  }

  private checkDates(docDate: string, expected: string | null) {
    if (expected && expected < docDate) {
      throw ValidationFailedError.field('expectedDate', 'Expected delivery cannot be before the PO date.');
    }
  }

  /** Supplier must be active (rule 6); the warehouse must be in a branch the user works in. */
  private async resolveHeader(ctx: RequestContext, supplierCode: string, warehouseCode: string) {
    const [supplier, warehouses, settings] = await Promise.all([
      this.masterData.findSupplier(ctx.tenantId, supplierCode),
      this.masterData.listWarehouses(ctx.tenantId),
      this.settings.settings(ctx.tenantId),
    ]);
    const errors: FieldError[] = [];
    if (!supplier) errors.push({ field: 'supplierCode', message: `Supplier ${supplierCode} is not in Master Data.` });
    else if (settings.onlyActiveSuppliers && supplier.status !== 'ACTIVE') {
      errors.push({ field: 'supplierCode', message: `${supplier.name} is blocked in Master Data. Only active suppliers can be used.` });
    }
    const warehouse = warehouses.find((w) => w.code === warehouseCode);
    if (!warehouse || !warehouse.isActive) errors.push({ field: 'warehouseCode', message: `Warehouse ${warehouseCode} is not available.` });
    else if (!ctx.user.branchCodes.includes(warehouse.branchCode)) {
      errors.push({ field: 'warehouseCode', message: `You do not work in branch ${warehouse.branchCode}.` });
    }
    if (errors.length) throw new ValidationFailedError(errors);
    return { supplier: supplier!, warehouse: warehouse! };
  }

  /** Validates lines against Master Data and builds the stored snapshot with rounded amounts. */
  private async buildLines(ctx: RequestContext, input: OrderLineDto[]) {
    const [items, taxes] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, [...new Set(input.map((l) => l.itemCode))]),
      this.masterData.listTaxCodes(ctx.tenantId),
    ]);
    const errors: FieldError[] = [];
    const lines = input.map((line, i) => {
      const item = items.find((it) => it.code === line.itemCode);
      const taxCode = line.taxCode ?? item?.purchaseTaxCode ?? '';
      const tax = taxes.find((t) => t.code === taxCode);
      if (!item) errors.push({ field: `lines[${i}].itemCode`, message: `Item ${line.itemCode} is not in Master Data.` });
      else if (!item.isPurchasable || item.status !== 'ACTIVE') {
        errors.push({ field: `lines[${i}].itemCode`, message: `${item.code} cannot be bought: it is not an active purchasable item in Master Data.` });
      }
      if (!tax) errors.push({ field: `lines[${i}].taxCode`, message: `Tax code ${taxCode} is not in Master Data.` });
      if (!dec(line.qty).gt(0)) errors.push({ field: `lines[${i}].qty`, message: 'Quantity must be more than 0.' });
      const rate = tax?.rate ?? '0';
      const totals = lineTotals({ qty: line.qty, unitPrice: line.unitPrice, taxRate: rate });
      return {
        itemId: item?.id ?? '',
        itemCode: line.itemCode,
        itemName: item?.name ?? line.itemCode,
        uomCode: item?.uomCode ?? '',
        taxCode,
        taxRate: dec(rate),
        unitPrice: dec(line.unitPrice),
        orderedQty: dec(line.qty),
        ...totals,
      };
    });
    if (errors.length) throw new ValidationFailedError(errors);
    return lines;
  }

  private poMail(order: OrderWithLines, email: string, contact: string, ctx: RequestContext) {
    return {
      templateKey: 'PO_TO_SUPPLIER',
      entityType: PUR_ENTITY.ORDER,
      entityId: order.id,
      docNo: order.docNo,
      vars: {
        'supplier.contact': contact,
        'supplier.email': email,
        'po.number': order.docNo,
        'po.date': dateText(order.docDate),
        'po.deliver_to': order.warehouseName,
        'po.expected_date': dateText(order.expectedDate) || 'to be confirmed',
        'po.currency': order.currency,
        'po.total': toRmText(order.total).replace(/^RM /, ''),
        'buyer.name': order.buyerName,
        'buyer.email': ctx.user.code === order.buyerCode ? ctx.user.email : '',
      },
    };
  }

  private async notifyApprover(
    tx: Tx,
    ctx: RequestContext,
    order: OrderWithLines,
    step: { approverCode: string | null; approverName: string | null; approverRole: string },
    reason: string,
    note: string | null,
  ) {
    const users = await this.masterData.listUsers(ctx.tenantId);
    const approver = users.find((u) => u.code === step.approverCode) ?? users.find((u) => u.roles.includes(step.approverRole));
    if (!approver) return;
    await this.mail.send(tx, ctx, {
      templateKey: 'APPROVAL_REQUEST',
      entityType: PUR_ENTITY.ORDER,
      entityId: order.id,
      docNo: order.docNo,
      vars: {
        'approver.name': approver.name,
        'approver.email': approver.email,
        'requester.name': ctx.user.name,
        'doc.number': order.docNo,
        'doc.title': `${order.docNo} · ${order.supplierName}`,
        'approval.reason': reason,
        'doc.currency': 'RM',
        'doc.total': toRmText(order.total).replace(/^RM /, ''),
        'approval.note': note?.trim() || '—',
      },
    });
  }
}
