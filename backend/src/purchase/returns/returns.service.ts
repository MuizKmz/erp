import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurGoodsReceiptLine } from '@prisma/client';
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
import { GOODS_RECEIVED_EVENT } from '../receipts/receipts.query';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CreateReturnDto, CreditNoteDto, ReplacementDto, ReturnLineDto, UpdateReturnDto } from './dto/return.dto';
import { returnableQty, returnQtyProblems, type ReturnAction } from './return.rules';
import { RETURN_RELEASED_EVENT, ReturnsQuery, type ReturnWithLines } from './returns.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Purchase return commands (FlowP6 steps 5–8): goods that arrived wrong go back to the supplier from a goods
 * receipt. Releasing it takes the goods out of stock (event for Inventory) and waits for a credit note or a
 * replacement.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: ReturnsQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly outbox: OutboxWriter,
    private readonly mail: PurchaseMailService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Draft ─────────────────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateReturnDto) {
    const grn = await this.query.loadReturnableReceipt(ctx, dto.grnId);
    const lines = this.checkLines(grn.lines, dto.lines);
    const docDate = dto.docDate ?? this.clock.today();
    this.checkDate(docDate, isoDate(grn.docDate));
    const priced = this.price(lines);
    const supplier = await this.masterData.findSupplier(ctx.tenantId, grn.supplierCode);

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.RETURN);
      const row = await tx.purReturn.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(docDate),
          status: 'DRAFT',
          branchCode: grn.branchCode,
          grnId: grn.id,
          grnNo: grn.docNo,
          poId: grn.poId,
          poNo: grn.poNo,
          supplierId: supplier?.id ?? '',
          supplierCode: grn.supplierCode,
          supplierName: grn.supplierName,
          reason: dto.reason.trim(),
          settleBy: dto.settleBy ?? 'CREDIT_NOTE',
          rmaNo: dto.rmaNo?.trim() || null,
          collection: dto.collection?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          summary: priced.summary,
          subtotal: priced.totals.subtotal,
          taxTotal: priced.totals.taxTotal,
          total: priced.totals.total,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: { create: priced.lines.map((l) => ({ ...l, tenantId: ctx.tenantId })) },
        },
      });
      await tx.sysDocLink.create({
        data: {
          tenantId: ctx.tenantId, fromType: PUR_ENTITY.RECEIPT, fromId: grn.id, fromNo: grn.docNo,
          toType: PUR_ENTITY.RETURN, toId: row.id, toNo: docNo, linkType: DOC_LINK.RETURNED,
        },
      });
      await this.log(tx, ctx, row.id, docNo, 'created', `Return drafted by ${ctx.user.name}`);
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, row.id, docNo, dto.attachmentIds);
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateReturnDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'edit', this.lockedMessage(row));
    const grn = await this.query.loadReturnableReceipt(ctx, row.grnId!);
    const lines = dto.lines ? this.checkLines(grn.lines, dto.lines) : null;
    const docDate = dto.docDate ?? isoDate(row.docDate);
    this.checkDate(docDate, isoDate(grn.docDate));
    const priced = lines ? this.price(lines) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'DRAFT', {
        docDate: day(docDate),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() }),
        ...(dto.settleBy && { settleBy: dto.settleBy }),
        ...(dto.rmaNo !== undefined && { rmaNo: dto.rmaNo.trim() || null }),
        ...(dto.collection !== undefined && { collection: dto.collection.trim() || null }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(priced && { summary: priced.summary, subtotal: priced.totals.subtotal, taxTotal: priced.totals.taxTotal, total: priced.totals.total }),
      });
      if (priced) {
        await tx.purReturnLine.deleteMany({ where: { returnId: id } });
        await tx.purReturnLine.createMany({ data: priced.lines.map((l) => ({ ...l, tenantId: ctx.tenantId, returnId: id })) });
      }
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, id, row.docNo, dto.attachmentIds);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'delete', this.lockedMessage(row));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purReturn.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: PUR_ENTITY.RETURN, toId: id } });
      await this.log(tx, ctx, id, row.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${row.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: row.docNo };
  }

  // ── Release ───────────────────────────────────────────────────────────────

  /** FlowP6 steps 6–7. The goods receipt row is locked so two returns can never send back more than came in. */
  async release(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'release', this.lockedMessage(row));
    const supplier = await this.masterData.findSupplier(ctx.tenantId, row.supplierCode);
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pur_goods_receipt WHERE id = ${row.grnId} FOR UPDATE`;
      const grn = await tx.purGoodsReceipt.findUniqueOrThrow({ where: { id: row.grnId! }, include: { lines: true } });
      const counted = row.lines.map((l, index) => ({ index, line: l, grnLine: grn.lines.find((g) => g.id === l.grnLineId)! }));
      const problems = returnQtyProblems(counted.map((c) => ({ index: c.index, returnable: returnableQty(c.grnLine), qty: c.line.qty })));
      if (problems.length) throw new BusinessRuleError('RETURN_TOO_MUCH', `${problems[0]!.message} Another return went out since this draft was made.`);

      await this.bump(tx, ctx, id, version, 'DRAFT', { status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code });
      for (const c of counted) {
        await tx.purReturnLine.update({ where: { id: c.line.id }, data: { receivedQty: c.grnLine.receivedQty, returnedBeforeQty: c.grnLine.returnedQty } });
        if (!c.line.qty.gt(0)) continue;
        await tx.purGoodsReceiptLine.update({ where: { id: c.grnLine.id }, data: { returnedQty: { increment: c.line.qty } } });
        await tx.purPurchaseOrderLine.update({ where: { id: c.grnLine.poLineId }, data: { returnedQty: { increment: c.line.qty } } });
      }
      const what = this.qtyText(row.lines);
      const settle = row.settleBy === 'CREDIT_NOTE' ? 'credit note expected' : 'replacement expected';
      await this.log(tx, ctx, id, row.docNo, 'released', `Released by ${ctx.user.name} · ${what} back to the supplier · ${settle}`);
      if (row.poId) {
        await this.activity.log(tx, ctx, { entityType: PUR_ENTITY.ORDER, entityId: row.poId, docNo: row.poNo!, action: 'returned', message: `${row.docNo}: ${what} returned from ${row.grnNo} · ${settle}` });
      }
      await this.activity.log(tx, ctx, { entityType: PUR_ENTITY.RECEIPT, entityId: grn.id, docNo: grn.docNo, action: 'returned', message: `${row.docNo}: ${what} returned · ${row.reason}` });
      if (supplier?.email) await this.sendNotice(tx, ctx, row, supplier.email, supplier.shortName ?? supplier.name);

      // Stock-out for Inventory / WMS. It waits in the outbox until Inventory is connected.
      await this.outbox.publish(tx, ctx, [{
        name: RETURN_RELEASED_EVENT,
        aggregateType: PUR_ENTITY.RETURN,
        aggregateId: row.id,
        payload: {
          prtNo: row.docNo,
          grnNo: row.grnNo,
          poNo: row.poNo,
          supplierCode: row.supplierCode,
          settleBy: row.settleBy,
          rmaNo: row.rmaNo,
          creditExpected: row.settleBy === 'CREDIT_NOTE' ? toMoney(row.total) : null,
          lines: counted
            .filter((c) => c.line.qty.gt(0))
            .map((c) => ({ itemCode: c.line.itemCode, uomCode: c.line.uomCode, qty: toQty(c.line.qty), warehouseCode: grn.warehouseCode, locationCode: c.grnLine.locationCode })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  /** "Remind" on credit notes to chase: the return notice goes again. */
  async remind(ctx: RequestContext, id: string) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'remind', this.lockedMessage(row));
    const supplier = await this.masterData.findSupplier(ctx.tenantId, row.supplierCode);
    if (!supplier?.email) throw new BusinessRuleError('NO_EMAIL', `${row.supplierName} has no email address in Master Data.`);
    await this.prisma.$transaction(async (tx) => {
      await this.sendNotice(tx, ctx, row, supplier.email!, supplier.shortName ?? supplier.name);
      await this.log(tx, ctx, id, row.docNo, 'reminded', `Reminder sent to ${supplier.shortName ?? supplier.name} by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  // ── Settle ────────────────────────────────────────────────────────────────

  /** FlowP6 step 8: the supplier's credit note settles the return; what we owe on their invoice drops. */
  async creditNote(ctx: RequestContext, id: string, dto: CreditNoteDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'settle', this.lockedMessage(row));
    if (row.settleBy !== 'CREDIT_NOTE') throw new BusinessRuleError('WRONG_SETTLEMENT', `${row.docNo} is settled by a replacement delivery, not a credit note.`);
    const invoices = row.grnId
      ? await this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['APPROVED', 'PAID'] }, lines: { some: { grnLine: { grnId: row.grnId } } } } })
      : [];
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'RELEASED', { status: 'SETTLED', creditNoteNo: dto.creditNoteNo.trim(), settledAt: this.clock.now() });
      await this.log(tx, ctx, id, row.docNo, 'settled', `Settled by credit note ${dto.creditNoteNo.trim()} · ${toRmText(row.total)} credited · recorded by ${ctx.user.name}`);
      for (const inv of invoices) {
        await this.activity.log(tx, ctx, {
          entityType: PUR_ENTITY.INVOICE, entityId: inv.id, docNo: inv.docNo, action: 'credited',
          message: `${row.docNo}: credit note ${dto.creditNoteNo.trim()} for ${toRmText(row.total)} · we owe ${toRmText(inv.total.sub(row.total))}`,
        });
      }
    });
    return this.query.detail(ctx, id);
  }

  /** The supplier replaced the goods instead: they come back into stock (event for Inventory). */
  async replacement(ctx: RequestContext, id: string, dto: ReplacementDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'settle', this.lockedMessage(row));
    if (row.settleBy !== 'REPLACEMENT') throw new BusinessRuleError('WRONG_SETTLEMENT', `${row.docNo} is settled by a credit note, not a replacement.`);
    const grn = row.grnId ? await this.prisma.purGoodsReceipt.findFirst({ where: { id: row.grnId }, include: { lines: true } }) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'RELEASED', { status: 'SETTLED', replacementGrnNo: dto.supplierDoNo.trim(), settledAt: this.clock.now() });
      await this.log(tx, ctx, id, row.docNo, 'settled', `Settled by replacement · ${this.qtyText(row.lines)} received again on their DO ${dto.supplierDoNo.trim()} by ${ctx.user.name}`);
      await this.outbox.publish(tx, ctx, [{
        name: GOODS_RECEIVED_EVENT,
        aggregateType: PUR_ENTITY.RETURN,
        aggregateId: row.id,
        payload: {
          grnNo: null,
          returnNo: row.docNo,
          poNo: row.poNo,
          supplierCode: row.supplierCode,
          supplierDo: dto.supplierDoNo.trim(),
          branchCode: row.branchCode,
          receivedDate: this.clock.today(),
          lines: row.lines
            .filter((l) => l.qty.gt(0))
            .map((l) => ({
              itemCode: l.itemCode,
              uomCode: l.uomCode,
              qty: toQty(l.qty),
              condition: 'GOOD',
              warehouseCode: grn?.warehouseCode ?? null,
              locationCode: grn?.lines.find((g) => g.id === l.grnLineId)?.locationCode ?? null,
            })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Rule 9: each line is a line of the receipt, once, with no more than what can still go back. */
  private checkLines(grnLines: PurGoodsReceiptLine[], input: ReturnLineDto[]) {
    const seen = new Set<string>();
    const lines = input.map((l, index) => {
      const grnLine = grnLines.find((g) => g.id === l.grnLineId);
      if (!grnLine) throw ValidationFailedError.field(`lines[${index}].grnLineId`, 'This line is not on the goods receipt.');
      if (seen.has(l.grnLineId)) throw ValidationFailedError.field(`lines[${index}].grnLineId`, `${grnLine.itemCode} is on the return twice.`);
      seen.add(l.grnLineId);
      return { index, grnLine, qty: dec(l.qty) };
    });
    const problems = returnQtyProblems(lines.map((l) => ({ index: l.index, returnable: returnableQty(l.grnLine), qty: l.qty })));
    if (problems.length) throw new ValidationFailedError(problems);
    return lines;
  }

  /** Line values at the received price, the credit expected and "10 rolls FB-OAK-01". */
  private price(lines: { grnLine: PurGoodsReceiptLine; qty: Prisma.Decimal }[]) {
    const priced = lines.map(({ grnLine, qty }, i) => {
      const t = lineTotals({ qty, unitPrice: grnLine.unitPrice, taxRate: grnLine.taxRate });
      return {
        grnLineId: grnLine.id,
        poLineId: grnLine.poLineId,
        lineNo: i + 1,
        itemId: grnLine.itemId,
        itemCode: grnLine.itemCode,
        itemName: grnLine.itemName,
        uomCode: grnLine.uomCode,
        taxCode: grnLine.taxCode,
        taxRate: grnLine.taxRate,
        unitPrice: grnLine.unitPrice,
        receivedQty: grnLine.receivedQty,
        returnedBeforeQty: grnLine.returnedQty,
        qty,
        amount: t.amount,
        taxAmount: t.taxAmount,
      };
    });
    const going = priced.filter((l) => l.qty.gt(0));
    return {
      lines: priced,
      totals: documentTotals(priced),
      summary: going.length === 1 ? `${qtyWithUnit(going[0]!.qty, going[0]!.uomCode)} ${going[0]!.itemCode}` : `${going.length} items`,
    };
  }

  private qtyText(lines: { qty: Prisma.Decimal; uomCode: string }[]) {
    const going = lines.filter((l) => l.qty.gt(0));
    return new Set(going.map((l) => l.uomCode)).size === 1 && going.length
      ? qtyWithUnit(going.reduce((s, l) => s.add(l.qty), dec(0)), going[0]!.uomCode)
      : `${going.length} items`;
  }

  private sendNotice(tx: Tx, ctx: RequestContext, row: ReturnWithLines, email: string, contact: string) {
    return this.mail.send(tx, ctx, {
      templateKey: 'RETURN_NOTICE',
      entityType: PUR_ENTITY.RETURN,
      entityId: row.id,
      docNo: row.docNo,
      vars: {
        'supplier.contact': contact,
        'supplier.email': email,
        'return.number': row.docNo,
        'return.rma': row.rmaNo ?? '—',
        'return.grn_number': row.grnNo,
        'return.reason': row.reason,
        'return.collection': row.collection ?? 'to be arranged',
        'return.lines': row.lines.filter((l) => l.qty.gt(0)).map((l) => `- ${plainQty(l.qty)} ${l.uomCode} · ${l.itemName} (${l.itemCode})`).join('\n'),
        'return.currency': 'RM',
        'return.total': toRmText(row.total).replace(/^RM /, ''),
        'buyer.name': ctx.user.name,
        'buyer.email': ctx.user.email,
      },
    });
  }

  private checkDate(docDate: string, grnDate: string) {
    if (docDate > this.clock.today()) throw ValidationFailedError.field('docDate', 'The return date cannot be in the future.');
    if (docDate < grnDate) throw ValidationFailedError.field('docDate', 'The return date cannot be before the goods were received.');
  }

  private async attachFiles(tx: Tx, ctx: RequestContext, id: string, docNo: string, ids: string[]) {
    await this.attachments.attach(tx, ctx, ids, PUR_ENTITY.RETURN, id);
    await this.log(tx, ctx, id, docNo, 'files', `${ids.length === 1 ? 'A photo or document' : `${ids.length} photos and documents`} added`);
  }

  private require(actions: ReturnAction[], action: ReturnAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(row: ReturnWithLines): string {
    if (row.isMigrated) return 'Migrated returns cannot be changed.';
    if (row.status === 'SETTLED') return `${row.docNo} is settled and closed.`;
    if (row.status === 'RELEASED') return `${row.docNo} is released. Only the supplier's credit note or replacement can settle it.`;
    return 'You cannot do this on a purchase return.';
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, status: 'DRAFT' | 'RELEASED', data: Prisma.PurReturnUpdateManyMutationInput) {
    const result = await tx.purReturn.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.RETURN, entityId: id, docNo, action, message });
  }
}
