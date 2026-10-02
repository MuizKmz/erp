import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurPurchaseOrderLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import type { CreateReceiptDto, ReceiptLineDto, UpdateReceiptDto } from './dto/receipt.dto';
import { confirmProblems, openQty, poStatusAfter, quantityProblems, shortQty, type ReceiptAction } from './receipt.rules';
import { GOODS_RECEIVED_EVENT, ReceiptsQuery, type ReceiptWithLines } from './receipts.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** "95 rolls", or "3 items" when the lines use different units. */
function qtyText(lines: { qty: Prisma.Decimal; uomCode: string }[]): string {
  const counted = lines.filter((l) => l.qty.gt(0));
  if (!counted.length) return 'nothing';
  const units = new Set(counted.map((l) => l.uomCode));
  if (units.size === 1) return qtyWithUnit(counted.reduce((s, l) => s.add(l.qty), dec(0)), counted[0]!.uomCode);
  return `${counted.length} items`;
}

/**
 * Goods receipt commands (FlowP4): the store counts what arrived against the PO, saves a draft, and confirms.
 * Confirming updates the PO's received quantities in the same transaction and queues the stock-in event.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: ReceiptsQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Draft ─────────────────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateReceiptDto) {
    const po = await this.query.loadPo(ctx, dto.poId);
    if (po.receipts[0]) throw new BusinessRuleError('DRAFT_EXISTS', `${po.receipts[0].docNo} is already open for ${po.docNo}. Continue that receipt instead.`);
    const problem = this.query.receivableProblem(po, po.cancelOrders[0]?.docNo ?? null);
    if (problem) throw new BusinessRuleError('NOT_RECEIVABLE', problem);

    const docDate = dto.docDate ?? this.clock.today();
    const warehouse = await this.checkWarehouse(ctx, po.branchCode, dto.warehouseCode ?? po.warehouseCode);
    const lines = await this.checkLines(ctx, po.lines, dto.lines, warehouse.code);
    this.checkDate(docDate, isoDate(po.docDate));
    const now = this.clock.now();

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.RECEIPT);
      const receipt = await tx.purGoodsReceipt.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(docDate),
          status: 'DRAFT',
          branchCode: po.branchCode,
          poId: po.id,
          poNo: po.docNo,
          supplierCode: po.supplierCode,
          supplierName: po.supplierName,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          supplierDoNo: dto.supplierDoNo?.trim() || null,
          vehicleNo: dto.vehicleNo?.trim() || null,
          receivedByCode: ctx.user.code,
          receivedByName: ctx.user.name,
          arrivedAt: now,
          shortAction: dto.shortAction ?? null,
          remarks: dto.remarks?.trim() || null,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: {
            create: lines.map(({ poLine, receiving, condition, locationCode }, i) => ({
              tenantId: ctx.tenantId,
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
              openQtyBefore: openQty(poLine),
              receivedQty: receiving,
              condition,
              locationCode,
            })),
          },
        },
      });
      const vehicle = receipt.vehicleNo ? `Lorry ${receipt.vehicleNo} arrived · ` : '';
      await this.log(tx, ctx, receipt.id, docNo, 'created', `${vehicle}${ctx.user.name} started counting`);
      await this.logCounted(tx, ctx, receipt.id, docNo, lines, receipt.supplierDoNo);
      await this.addFiles(tx, ctx, receipt.id, docNo, dto.attachmentIds);
      return receipt.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateReceiptDto) {
    const receipt = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, receipt), 'edit', this.lockedMessage(receipt));
    const po = await this.query.loadPo(ctx, receipt.poId);
    const docDate = dto.docDate ?? isoDate(receipt.docDate);
    this.checkDate(docDate, isoDate(po.docDate));
    const warehouse = dto.warehouseCode
      ? await this.checkWarehouse(ctx, receipt.branchCode, dto.warehouseCode)
      : { code: receipt.warehouseCode, name: receipt.warehouseName };
    const lines = dto.lines
      ? await this.checkLines(ctx, po.lines, dto.lines, warehouse.code, receipt.lines.map((l) => l.poLineId))
      : null;

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, {
        docDate: day(docDate),
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        ...(dto.supplierDoNo !== undefined && { supplierDoNo: dto.supplierDoNo.trim() || null }),
        ...(dto.vehicleNo !== undefined && { vehicleNo: dto.vehicleNo.trim() || null }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(dto.shortAction !== undefined && { shortAction: dto.shortAction }),
      });
      if (lines) {
        for (const l of lines) {
          await tx.purGoodsReceiptLine.updateMany({
            where: { grnId: id, poLineId: l.poLine.id },
            data: { receivedQty: l.receiving, condition: l.condition, locationCode: l.locationCode, openQtyBefore: openQty(l.poLine) },
          });
        }
        const changed = lines.some((l) => !l.receiving.eq(receipt.lines.find((x) => x.poLineId === l.poLine.id)!.receivedQty));
        if (changed) await this.logCounted(tx, ctx, id, receipt.docNo, lines, dto.supplierDoNo?.trim() || receipt.supplierDoNo);
      }
      await this.addFiles(tx, ctx, id, receipt.docNo, dto.attachmentIds);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const receipt = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, receipt), 'delete', this.lockedMessage(receipt));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purGoodsReceipt.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, receipt.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${receipt.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: receipt.docNo };
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  /**
   * FlowP4 step 5–6. The PO row is locked first, so two receipts for the same PO can never together receive
   * more than was ordered (rule 1).
   */
  async confirm(ctx: RequestContext, id: string, version: number) {
    const receipt = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, receipt), 'confirm', this.lockedMessage(receipt));
    const locations = (await this.masterData.listLocations(ctx.tenantId, receipt.warehouseCode)).filter((l) => l.isActive).map((l) => l.code);
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pur_purchase_order WHERE id = ${receipt.poId} FOR UPDATE`;
      const po = await tx.purPurchaseOrder.findUniqueOrThrow({
        where: { id: receipt.poId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, cancelOrders: { where: { status: 'DRAFT' }, select: { docNo: true } } },
      });
      const problem = this.query.receivableProblem(po, po.cancelOrders[0]?.docNo ?? null);
      if (problem) throw new BusinessRuleError('NOT_RECEIVABLE', problem);

      const counted = receipt.lines.map((l, index) => {
        const poLine = po.lines.find((x) => x.id === l.poLineId)!;
        return { index, line: l, poLine, open: openQty(poLine), receiving: dec(l.receivedQty) };
      });
      const problems = confirmProblems({
        lines: counted.map((c) => ({ index: c.index, open: c.open, receiving: c.receiving, locationCode: c.line.locationCode })),
        supplierDoNo: receipt.supplierDoNo,
        validLocations: locations,
        docDate: isoDate(receipt.docDate),
        today: this.clock.today(),
        poDate: isoDate(po.docDate),
      });
      if (problems.length) throw new ValidationFailedError(problems, 'Check the receipt before you confirm it.');

      const short = shortQty(counted.map((c) => ({ open: c.open, receiving: c.receiving })));
      const shortAction = short.gt(0) ? (receipt.shortAction ?? 'KEEP_OPEN') : null;
      await this.bump(tx, ctx, id, version, { status: 'CONFIRMED', confirmedAt: now, confirmedByCode: ctx.user.code, shortAction });
      for (const c of counted) {
        await tx.purGoodsReceiptLine.update({ where: { id: c.line.id }, data: { openQtyBefore: c.open } });
        if (c.receiving.gt(0)) await tx.purPurchaseOrderLine.update({ where: { id: c.poLine.id }, data: { receivedQty: { increment: c.receiving } } });
      }
      const after = po.lines.map((l) => {
        const c = counted.find((x) => x.poLine.id === l.id);
        return { ...l, receivedQty: c ? l.receivedQty.add(c.receiving) : l.receivedQty };
      });
      const poStatus = poStatusAfter(after);
      await tx.purPurchaseOrder.update({ where: { id: po.id }, data: { status: poStatus, version: { increment: 1 }, updatedBy: ctx.user.code } });
      await tx.sysDocLink.create({
        data: {
          tenantId: ctx.tenantId, fromType: PUR_ENTITY.ORDER, fromId: po.id, fromNo: po.docNo,
          toType: PUR_ENTITY.RECEIPT, toId: receipt.id, toNo: receipt.docNo, linkType: DOC_LINK.RECEIVED,
        },
      });

      const receivedText = qtyText(counted.map((c) => ({ qty: c.receiving, uomCode: c.line.uomCode })));
      const shortText = short.gt(0) ? qtyText(counted.map((c) => ({ qty: c.open.sub(c.receiving), uomCode: c.line.uomCode }))) : null;
      await this.log(tx, ctx, receipt.id, receipt.docNo, 'confirmed', `Confirmed by ${ctx.user.name} · ${receivedText} received${shortText ? ` · ${shortText} short` : ''}`);

      let cancelNo: string | null = null;
      if (shortAction === 'CANCEL_BALANCE') cancelNo = await this.draftCancelOrder(tx, ctx, po, after, receipt.docNo);
      const poMessage = shortText
        ? `${receipt.docNo}: ${receivedText} received · ${shortText} short, ${cancelNo ? `${cancelNo} drafted to cancel the balance` : 'kept open'}`
        : `${receipt.docNo}: ${receivedText} received · nothing left open`;
      await this.activity.log(tx, ctx, { entityType: PUR_ENTITY.ORDER, entityId: po.id, docNo: po.docNo, action: 'received', message: poMessage });

      // Stock-in for Inventory / WMS. It waits in the outbox until Inventory is connected.
      await this.outbox.publish(tx, ctx, [{
        name: GOODS_RECEIVED_EVENT,
        aggregateType: PUR_ENTITY.RECEIPT,
        aggregateId: receipt.id,
        payload: {
          grnNo: receipt.docNo,
          poNo: po.docNo,
          supplierCode: po.supplierCode,
          supplierDo: receipt.supplierDoNo,
          branchCode: receipt.branchCode,
          receivedDate: isoDate(receipt.docDate),
          salesOrderNo: po.salesOrderNo,
          lines: counted
            .filter((c) => c.receiving.gt(0))
            .map((c) => ({
              itemCode: c.line.itemCode,
              uomCode: c.line.uomCode,
              qty: toQty(c.receiving),
              condition: c.line.condition,
              warehouseCode: receipt.warehouseCode,
              locationCode: c.line.locationCode,
            })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  /**
   * "Cancel the balance" (FlowP4 step 4): a draft cancel order for what is still open. Only the Purchasing
   * Manager releases it (rule 8); until then the PO stays Partially received.
   */
  private async draftCancelOrder(
    tx: Tx,
    ctx: RequestContext,
    po: { id: string; docNo: string; branchCode: string; supplierCode: string; supplierName: string },
    lines: PurPurchaseOrderLine[],
    grnNo: string,
  ): Promise<string> {
    const open = lines.map((l) => ({ l, qty: openQty(l) })).filter((x) => x.qty.gt(0));
    const priced = open.map(({ l, qty }) => ({ l, qty, ...lineTotals({ qty, unitPrice: l.unitPrice, taxRate: l.taxRate }) }));
    const totals = documentTotals(priced);
    const ordered = open.reduce((s, x) => s.add(x.l.orderedQty), dec(0));
    const cancelled = open.reduce((s, x) => s.add(x.qty), dec(0));
    const summary = new Set(open.map((x) => x.l.uomCode)).size === 1
      ? `${plainQty(cancelled)} of ${qtyWithUnit(ordered, open[0]!.l.uomCode)}`
      : `${open.length} lines`;
    const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.CANCEL_ORDER);
    const cancel = await tx.purCancelOrder.create({
      data: {
        tenantId: ctx.tenantId,
        docNo,
        docDate: day(this.clock.today()),
        status: 'DRAFT',
        branchCode: po.branchCode,
        poId: po.id,
        poNo: po.docNo,
        supplierCode: po.supplierCode,
        supplierName: po.supplierName,
        reason: `Short delivery on ${grnNo}`,
        askedByCode: ctx.user.code,
        askedByName: ctx.user.name,
        summary,
        totalValue: totals.total,
        createdBy: ctx.user.code,
        updatedBy: ctx.user.code,
        lines: {
          create: priced.map(({ l, qty, amount, taxAmount }, i) => ({
            tenantId: ctx.tenantId,
            poLineId: l.id,
            lineNo: i + 1,
            itemId: l.itemId,
            itemCode: l.itemCode,
            itemName: l.itemName,
            uomCode: l.uomCode,
            taxCode: l.taxCode,
            taxRate: l.taxRate,
            unitPrice: l.unitPrice,
            orderedQty: l.orderedQty,
            receivedQty: l.receivedQty,
            openQty: qty,
            cancelQty: qty,
            amount,
            taxAmount,
          })),
        },
      },
    });
    await tx.sysDocLink.create({
      data: {
        tenantId: ctx.tenantId, fromType: PUR_ENTITY.ORDER, fromId: po.id, fromNo: po.docNo,
        toType: PUR_ENTITY.CANCEL_ORDER, toId: cancel.id, toNo: docNo, linkType: DOC_LINK.CANCELLED,
      },
    });
    await this.activity.log(tx, ctx, {
      entityType: PUR_ENTITY.CANCEL_ORDER, entityId: cancel.id, docNo, action: 'created',
      message: `${docNo} drafted from ${grnNo} by ${ctx.user.name} · waiting for the Purchasing Manager`,
    });
    return docNo;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private require(actions: ReceiptAction[], action: ReceiptAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(receipt: ReceiptWithLines): string {
    if (receipt.isMigrated) return 'Migrated receipts cannot be changed.';
    if (receipt.status === 'CONFIRMED') return `${receipt.docNo} is confirmed and locked. Fix mistakes with a purchase return.`;
    return 'You cannot do this on a goods receipt.';
  }

  private checkDate(docDate: string, poDate: string) {
    if (docDate > this.clock.today()) throw ValidationFailedError.field('docDate', 'The received date cannot be in the future.');
    if (docDate < poDate) throw ValidationFailedError.field('docDate', 'The received date cannot be before the PO date.');
  }

  private async checkWarehouse(ctx: RequestContext, branchCode: string, code: string) {
    const warehouse = (await this.masterData.listWarehouses(ctx.tenantId, branchCode)).find((w) => w.code === code && w.isActive);
    if (!warehouse) throw ValidationFailedError.field('warehouseCode', `${code} is not an active warehouse of this branch.`);
    return warehouse;
  }

  /** Lines must be open PO lines, each once; quantities within the open quantity (rule 1); locations real. */
  private async checkLines(ctx: RequestContext, poLines: PurPurchaseOrderLine[], input: ReceiptLineDto[], warehouseCode: string, allowed?: string[]) {
    const locations = (await this.masterData.listLocations(ctx.tenantId, warehouseCode)).filter((l) => l.isActive).map((l) => l.code);
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    const lines = input.map((l, index) => {
      const poLine = poLines.find((p) => p.id === l.poLineId);
      if (!poLine || (allowed && !allowed.includes(l.poLineId))) errors.push({ field: `lines[${index}].poLineId`, message: 'This line is not on the purchase order.' });
      else if (seen.has(l.poLineId)) errors.push({ field: `lines[${index}].poLineId`, message: `${poLine.itemCode} is on the receipt twice.` });
      seen.add(l.poLineId);
      const locationCode = l.locationCode?.trim() || null;
      if (locationCode && !locations.includes(locationCode)) errors.push({ field: `lines[${index}].locationCode`, message: `${locationCode} is not a location in this warehouse.` });
      return { index, poLine: poLine!, receiving: dec(l.receivedQty), condition: l.condition ?? 'GOOD', locationCode };
    });
    if (!errors.length) {
      errors.push(...quantityProblems(lines.map((l) => ({ index: l.index, open: openQty(l.poLine), receiving: l.receiving, locationCode: l.locationCode }))));
    }
    if (errors.length) throw new ValidationFailedError(errors);
    return lines;
  }

  /** "95 rolls counted · 5 short against KKJ-DO-7781" */
  private async logCounted(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    docNo: string,
    lines: { poLine: PurPurchaseOrderLine; receiving: Prisma.Decimal }[],
    doNo: string | null,
  ) {
    if (!lines.some((l) => l.receiving.gt(0))) return;
    const counted = qtyText(lines.map((l) => ({ qty: l.receiving, uomCode: l.poLine.uomCode })));
    const short = shortQty(lines.map((l) => ({ open: openQty(l.poLine), receiving: l.receiving })));
    const shortText = short.gt(0) ? ` · ${plainQty(short)} short` : ' · nothing short';
    await this.log(tx, ctx, id, docNo, 'counted', `${counted} counted${shortText}${doNo ? ` against ${doNo}` : ''}`);
  }

  private async addFiles(tx: Tx, ctx: RequestContext, id: string, docNo: string, ids: string[] | undefined) {
    if (!ids?.length) return;
    await this.attachments.attach(tx, ctx, ids, PUR_ENTITY.RECEIPT, id);
    await this.log(tx, ctx, id, docNo, 'files', `${ids.length === 1 ? 'A photo or document' : `${ids.length} photos and documents`} added`);
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurGoodsReceiptUpdateManyMutationInput) {
    const result = await tx.purGoodsReceipt.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.RECEIPT, entityId: id, docNo, action, message });
  }
}
