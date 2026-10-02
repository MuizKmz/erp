import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurPurchaseOrderLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { openQty } from '../receipts/receipt.rules';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CancelLineDto, CreateCancelOrderDto, UpdateCancelOrderDto } from './dto/cancel-order.dto';
import { cancelQtyProblems, poAfterCancel, type CancelOrderAction } from './cancel-order.rules';
import { CancelOrdersQuery, type CancelOrderWithLines } from './cancel-orders.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

interface CancelPo {
  id: string;
  docNo: string;
  branchCode: string;
  supplierCode: string;
  supplierName: string;
}

/**
 * Cancel order commands (FlowP6 steps 2–4): buyers draft the cancellation of a PO's unreceived balance;
 * the Purchasing Manager releases it, which closes the balance on the PO and tells the supplier.
 */
@Injectable()
export class CancelOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: CancelOrdersQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly outbox: OutboxWriter,
    private readonly mail: PurchaseMailService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Draft ─────────────────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateCancelOrderDto) {
    const po = await this.query.loadCancellablePo(ctx, dto.poId);
    const lines = this.checkLines(po.lines, dto.lines);
    const docDate = dto.docDate ?? this.clock.today();
    this.checkDate(docDate, isoDate(po.docDate));
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await this.insertDraft(tx, ctx, po, lines, { reason: dto.reason.trim(), docDate, remarks: dto.remarks?.trim() || null });
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, created.id, created.docNo, dto.attachmentIds);
      return created.id;
    });
    return this.query.detail(ctx, id);
  }

  /**
   * Writes a draft cancellation in the caller's transaction. Also used by a goods receipt confirmed with
   * "Cancel the balance".
   */
  async insertDraft(
    tx: Tx,
    ctx: RequestContext,
    po: CancelPo,
    lines: { poLine: PurPurchaseOrderLine; cancelQty: Prisma.Decimal }[],
    opts: { reason: string; docDate: string; remarks: string | null; message?: string },
  ): Promise<{ id: string; docNo: string }> {
    const priced = this.price(lines);
    const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.CANCEL_ORDER);
    const row = await tx.purCancelOrder.create({
      data: {
        tenantId: ctx.tenantId,
        docNo,
        docDate: day(opts.docDate),
        status: 'DRAFT',
        branchCode: po.branchCode,
        poId: po.id,
        poNo: po.docNo,
        supplierCode: po.supplierCode,
        supplierName: po.supplierName,
        reason: opts.reason,
        askedByCode: ctx.user.code,
        askedByName: ctx.user.name,
        summary: priced.summary,
        totalValue: priced.totals.total,
        remarks: opts.remarks,
        createdBy: ctx.user.code,
        updatedBy: ctx.user.code,
        lines: { create: priced.lines.map((l) => ({ ...l, tenantId: ctx.tenantId })) },
      },
    });
    await tx.sysDocLink.create({
      data: {
        tenantId: ctx.tenantId, fromType: PUR_ENTITY.ORDER, fromId: po.id, fromNo: po.docNo,
        toType: PUR_ENTITY.CANCEL_ORDER, toId: row.id, toNo: docNo, linkType: DOC_LINK.CANCELLED,
      },
    });
    await this.log(tx, ctx, row.id, docNo, 'created', opts.message ?? `${docNo} drafted by ${ctx.user.name}`);
    await this.activity.log(tx, ctx, {
      entityType: PUR_ENTITY.ORDER, entityId: po.id, docNo: po.docNo, action: 'cancel_drafted',
      message: `${docNo} drafted for ${priced.openText}`,
    });
    return { id: row.id, docNo };
  }

  async update(ctx: RequestContext, id: string, dto: UpdateCancelOrderDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'edit', this.lockedMessage(row));
    const po = await this.query.loadCancellablePo(ctx, row.poId!, row.id);
    const lines = dto.lines ? this.checkLines(po.lines, dto.lines) : null;
    const docDate = dto.docDate ?? isoDate(row.docDate);
    this.checkDate(docDate, isoDate(po.docDate));
    const priced = lines ? this.price(lines) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, {
        docDate: day(docDate),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(priced && { summary: priced.summary, totalValue: priced.totals.total }),
      });
      if (priced) {
        await tx.purCancelOrderLine.deleteMany({ where: { cancelOrderId: id } });
        await tx.purCancelOrderLine.createMany({ data: priced.lines.map((l) => ({ ...l, tenantId: ctx.tenantId, cancelOrderId: id })) });
      }
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, id, row.docNo, dto.attachmentIds);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'delete', this.lockedMessage(row));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purCancelOrder.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: PUR_ENTITY.CANCEL_ORDER, toId: id } });
      await this.log(tx, ctx, id, row.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${row.docNo} will not be used again.`);
      if (row.poId) {
        await this.activity.log(tx, ctx, { entityType: PUR_ENTITY.ORDER, entityId: row.poId, docNo: row.poNo, action: 'cancel_deleted', message: `${row.docNo} deleted · the balance stays open` });
      }
    });
    return { deleted: true, docNo: row.docNo };
  }

  // ── Release ───────────────────────────────────────────────────────────────

  /**
   * FlowP6 steps 3–4 (rule 8). The PO row is locked so a goods receipt confirmed at the same moment cannot make
   * received + cancelled exceed what was ordered.
   */
  async release(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'release', 'Only the Purchasing Manager can release a cancellation.');
    const supplier = await this.masterData.findSupplier(ctx.tenantId, row.supplierCode);
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pur_purchase_order WHERE id = ${row.poId} FOR UPDATE`;
      const po = await tx.purPurchaseOrder.findUniqueOrThrow({ where: { id: row.poId! }, include: { lines: true } });
      if (po.status !== 'RELEASED' && po.status !== 'PARTIAL') {
        throw new BusinessRuleError('NOT_CANCELLABLE', `${po.docNo} has no open balance any more. Delete this draft.`);
      }
      const problems = cancelQtyProblems(row.lines.map((l, index) => ({ index, open: openQty(po.lines.find((p) => p.id === l.poLineId)!), cancel: l.cancelQty })));
      if (problems.length) {
        throw new BusinessRuleError('BALANCE_CHANGED', `${problems[0]!.message} Goods arrived since the draft was made; correct the quantities first.`);
      }

      await this.bump(tx, ctx, id, version, { status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code });
      for (const l of row.lines) {
        const pl = po.lines.find((p) => p.id === l.poLineId)!;
        await tx.purCancelOrderLine.update({ where: { id: l.id }, data: { receivedQty: pl.receivedQty, openQty: openQty(pl) } });
        if (l.cancelQty.gt(0)) await tx.purPurchaseOrderLine.update({ where: { id: pl.id }, data: { cancelledQty: { increment: l.cancelQty } } });
      }
      const after = po.lines.map((pl) => ({ ...pl, cancelledQty: pl.cancelledQty.add(row.lines.find((l) => l.poLineId === pl.id)?.cancelQty ?? 0) }));
      const next = poAfterCancel(po.status, after);
      await tx.purPurchaseOrder.update({
        where: { id: po.id },
        data: { status: next.status, balanceCancelled: next.balanceCancelled || po.balanceCancelled, version: { increment: 1 }, updatedBy: ctx.user.code },
      });

      const cancelledText = this.price(row.lines.map((l) => ({ poLine: po.lines.find((p) => p.id === l.poLineId)!, cancelQty: l.cancelQty }))).openText;
      const poState = next.status === 'DONE' ? 'closed as Done · balance cancelled' : next.status === 'CANCELLED' ? 'cancelled' : 'still has an open balance';
      await this.log(tx, ctx, id, row.docNo, 'released', `Released by ${ctx.user.name} · ${po.docNo} ${poState}${supplier?.email ? ' · supplier told' : ''}`);
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.ORDER, entityId: po.id, docNo: po.docNo, action: 'balance_cancelled',
        message: `${row.docNo}: ${cancelledText} cancelled (${toRmText(row.totalValue)}) · ${poState}`,
      });

      if (supplier?.email) {
        await this.mail.send(tx, ctx, {
          templateKey: 'CANCELLATION_NOTICE',
          entityType: PUR_ENTITY.CANCEL_ORDER,
          entityId: row.id,
          docNo: row.docNo,
          vars: {
            'supplier.contact': supplier.shortName ?? supplier.name,
            'supplier.email': supplier.email,
            'po.number': po.docNo,
            'cancel.lines': row.lines.filter((l) => l.cancelQty.gt(0)).map((l) => `- ${plainQty(l.cancelQty)} ${l.uomCode} · ${l.itemName} (${l.itemCode})`).join('\n'),
            'cancel.reason': row.reason,
            'buyer.name': ctx.user.name,
            'buyer.email': ctx.user.email,
          },
        });
      }
      await this.outbox.publish(tx, ctx, [{
        name: 'purchase.order.balance_cancelled',
        aggregateType: PUR_ENTITY.CANCEL_ORDER,
        aggregateId: row.id,
        payload: {
          pcoNo: row.docNo,
          poNo: po.docNo,
          supplierCode: po.supplierCode,
          salesOrderNo: po.salesOrderNo,
          poStatus: next.status,
          value: toMoney(row.totalValue),
          lines: row.lines.filter((l) => l.cancelQty.gt(0)).map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.cancelQty) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Rule 8: each line is an open PO line, once, with no more than its open quantity. */
  private checkLines(poLines: PurPurchaseOrderLine[], input: CancelLineDto[]) {
    const seen = new Set<string>();
    const lines = input.map((l, index) => {
      const poLine = poLines.find((p) => p.id === l.poLineId);
      if (!poLine) throw ValidationFailedError.field(`lines[${index}].poLineId`, 'This line is not on the purchase order.');
      if (seen.has(l.poLineId)) throw ValidationFailedError.field(`lines[${index}].poLineId`, `${poLine.itemCode} is on the cancellation twice.`);
      seen.add(l.poLineId);
      return { index, poLine, cancelQty: dec(l.cancelQty) };
    });
    const problems = cancelQtyProblems(lines.map((l) => ({ index: l.index, open: openQty(l.poLine), cancel: l.cancelQty })));
    if (problems.length) throw new ValidationFailedError(problems);
    return lines;
  }

  /** Line values with tax, the header total and "10 of 30 hinge packs". */
  private price(lines: { poLine: PurPurchaseOrderLine; cancelQty: Prisma.Decimal }[]) {
    const priced = lines.map(({ poLine, cancelQty }, i) => {
      const t = lineTotals({ qty: cancelQty, unitPrice: poLine.unitPrice, taxRate: poLine.taxRate });
      return {
        poLineId: poLine.id,
        lineNo: i + 1,
        itemId: poLine.itemId,
        itemCode: poLine.itemCode,
        itemName: poLine.itemName,
        uomCode: poLine.uomCode,
        taxCode: poLine.taxCode,
        taxRate: poLine.taxRate,
        unitPrice: poLine.unitPrice,
        orderedQty: poLine.orderedQty,
        receivedQty: poLine.receivedQty,
        openQty: openQty(poLine),
        cancelQty,
        amount: t.amount,
        taxAmount: t.taxAmount,
      };
    });
    const counted = priced.filter((l) => l.cancelQty.gt(0));
    const oneUnit = new Set(counted.map((l) => l.uomCode)).size === 1;
    const cancelled = counted.reduce((s, l) => s.add(l.cancelQty), dec(0));
    const ordered = counted.reduce((s, l) => s.add(l.orderedQty), dec(0));
    const nothingReceived = counted.every((l) => l.receivedQty.isZero()) && cancelled.eq(ordered);
    const summary = !counted.length
      ? 'Nothing'
      : oneUnit
        ? nothingReceived
          ? `Whole order · ${qtyWithUnit(cancelled, counted[0]!.uomCode)}`
          : `${plainQty(cancelled)} of ${qtyWithUnit(ordered, counted[0]!.uomCode)}`
        : `${counted.length} lines`;
    return {
      lines: priced,
      totals: documentTotals(priced),
      summary,
      openText: oneUnit && counted.length ? `the ${qtyWithUnit(cancelled, counted[0]!.uomCode)} still open` : `${counted.length} open lines`,
    };
  }

  private checkDate(docDate: string, poDate: string) {
    if (docDate > this.clock.today()) throw ValidationFailedError.field('docDate', 'The cancel date cannot be in the future.');
    if (docDate < poDate) throw ValidationFailedError.field('docDate', 'The cancel date cannot be before the PO date.');
  }

  private async attachFiles(tx: Tx, ctx: RequestContext, id: string, docNo: string, ids: string[]) {
    await this.attachments.attach(tx, ctx, ids, PUR_ENTITY.CANCEL_ORDER, id);
    await this.log(tx, ctx, id, docNo, 'files', `${ids.length === 1 ? 'A file' : `${ids.length} files`} added`);
  }

  private require(actions: CancelOrderAction[], action: CancelOrderAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(row: CancelOrderWithLines): string {
    if (row.isMigrated) return 'Migrated cancellations cannot be changed.';
    if (row.status === 'RELEASED') return `${row.docNo} is released and locked.`;
    return 'You cannot change this cancellation.';
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurCancelOrderUpdateManyMutationInput) {
    const result = await tx.purCancelOrder.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.CANCEL_ORDER, entityId: id, docNo, action, message });
  }
}
