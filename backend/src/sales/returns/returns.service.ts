import { Injectable } from '@nestjs/common';
import type { Prisma, SalInvoiceLine } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { SalesDocumentLines } from '../shared/document-lines.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT, SAL_LINK } from '../shared/sales.constants';
import { saleLineTotals } from '../shared/totals.rules';
import type { CreateReturnDto, ReturnLineDto, UpdateReturnDto } from './dto/return.dto';
import { returnProblems, returnSummary, SR_LOCKED_MESSAGE, type ReturnAction } from './return.rules';
import { ReturnsQuery, type ReturnWithLines } from './returns.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const qtyText = (v: Prisma.Decimal) => toQty(v).replace(/\.0+$/, '');

/**
 * Sales return commands (FlowS6 steps 5–8). A return always comes from one released invoice. Releasing lowers the
 * invoice balance, saves a stock-in event for Inventory and queues a credit note for Finance and LHDN.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: ReturnsQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly docs: SalesDocumentLines,
    private readonly clock: ClockService,
  ) {}

  async create(ctx: RequestContext, dto: CreateReturnDto) {
    const inv = await this.prisma.salInvoice.findFirst({ where: { id: dto.invoiceId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!inv) throw ValidationFailedError.field('invoiceId', 'Pick the invoice the goods were billed on.');
    if (inv.status !== 'RELEASED') throw new BusinessRuleError('INVOICE_NOT_RELEASED', `${inv.docNo} is not released. Goods can only come back against a released invoice.`);
    const customer = await this.docs.activeCustomer(ctx, inv.customerCode, 'a return');
    const built = await this.buildLines(ctx, inv.lines, dto.lines);
    const where = await this.resolveLocation(ctx, inv.branchCode, dto.location);
    const docDate = dto.docDate ?? this.clock.today();

    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.RETURN, { date: docDate, branchCode: inv.branchCode });
      const row = await tx.salReturn.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode: inv.branchCode,
          customerId: customer.id, customerCode: customer.code, customerName: customer.name, invoiceId: inv.id, invoiceNo: inv.docNo, salesOrderNo: inv.salesOrderNo,
          reason: dto.reason?.trim() || '', goodsTo: where?.goodsTo ?? 'DAMAGED', warehouseCode: where?.warehouseCode ?? '', locationCode: where?.locationCode ?? null,
          creditMethod: dto.creditMethod ?? 'CREDIT_NOTE', customerRef: dto.customerRef?.trim() || null, note: dto.note?.trim() || null,
          summary: built.summary, subtotal: built.subtotal, taxTotal: built.taxTotal, total: built.total,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.INVOICE, fromId: inv.id, fromNo: inv.docNo, toType: SAL_ENTITY.RETURN, toId: row.id, toNo: docNo, linkType: SAL_LINK.RETURNED } });
      await this.log(tx, ctx, row.id, docNo, 'created', `Created from ${inv.docNo} by ${ctx.user.name}`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateReturnDto) {
    const r = await this.query.load(ctx.tenantId, id);
    this.require(ctx, r, 'edit');
    const inv = await this.prisma.salInvoice.findFirstOrThrow({ where: { id: r.invoiceId ?? '' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const built = dto.lines ? await this.buildLines(ctx, inv.lines, dto.lines, r.id) : null;
    const where = dto.location !== undefined ? await this.resolveLocation(ctx, inv.branchCode, dto.location) : undefined;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, r.id, dto.version, {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() }),
        ...(where && { goodsTo: where.goodsTo, warehouseCode: where.warehouseCode, locationCode: where.locationCode }),
        ...(dto.creditMethod && { creditMethod: dto.creditMethod }),
        ...(dto.customerRef !== undefined && { customerRef: dto.customerRef.trim() || null }),
        ...(dto.note !== undefined && { note: dto.note.trim() || null }),
        ...(built && { summary: built.summary, subtotal: built.subtotal, taxTotal: built.taxTotal, total: built.total }),
      });
      if (built) {
        await tx.salReturnLine.deleteMany({ where: { returnId: r.id } });
        await tx.salReturnLine.createMany({ data: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, returnId: r.id, lineNo: i + 1 })) });
      }
      await this.log(tx, ctx, r.id, r.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const r = await this.query.load(ctx.tenantId, id);
    this.require(ctx, r, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salReturn.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.RETURN, toId: id } });
      await this.log(tx, ctx, id, r.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${r.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: r.docNo };
  }

  /**
   * Release (FlowS6 steps 7–8): the invoice row is locked and the quantities re-checked against invoiced minus
   * earlier returns. The invoice is credited, the order lines' returned quantity rises, the events are saved.
   */
  async release(ctx: RequestContext, id: string, version: number) {
    const r = await this.query.load(ctx.tenantId, id);
    this.require(ctx, r, 'release', 'Only the store team confirms that returned goods came back (sales.return.receive).');
    if (!r.reason.trim()) throw ValidationFailedError.field('reason', 'Give a reason for the return.');
    if (!r.locationCode) throw ValidationFailedError.field('location', 'Pick where the goods go back to.');
    await this.docs.activeCustomer(ctx, r.customerCode, 'a return');
    const locations = await this.query.locations(ctx.tenantId, r.branchCode);
    const where = locations.find((l) => l.warehouseCode === r.warehouseCode && l.locationCode === r.locationCode);
    if (!where) throw ValidationFailedError.field('location', 'That return location is no longer active in Master Data. Pick another one.');
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sal_invoice WHERE id = ${r.invoiceId} FOR UPDATE`;
      const inv = await tx.salInvoice.findUniqueOrThrow({ where: { id: r.invoiceId! }, include: { lines: true } });
      const counted = r.lines.map((l) => ({ line: l, inv: inv.lines.find((x) => x.id === l.invoiceLineId)! }));
      const problems = returnProblems(counted.map((x) => ({ qty: x.line.qty, max: x.inv.qty.sub(x.inv.returnedQty) })));
      if (problems.length) throw new ValidationFailedError(problems, 'Something was returned meanwhile. Check the quantities.');

      for (const x of counted) {
        await tx.salReturnLine.update({ where: { id: x.line.id }, data: { invoicedQty: x.inv.qty, returnedBeforeQty: x.inv.returnedQty } });
        await tx.salInvoiceLine.update({ where: { id: x.inv.id }, data: { returnedQty: { increment: x.line.qty } } });
        if (x.inv.soLineId) await tx.salSalesOrderLine.update({ where: { id: x.inv.soLineId }, data: { returnedQty: { increment: x.line.qty } } });
      }
      await tx.salInvoice.update({ where: { id: inv.id }, data: { creditedAmount: { increment: r.total }, version: { increment: 1 }, updatedBy: ctx.user.code } });
      await this.bump(tx, ctx, r.id, version, { status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code });

      const qty = qtyText(r.lines.reduce((s, l) => s.add(l.qty), dec(0)));
      await this.log(tx, ctx, r.id, r.docNo, 'released', `Released by ${ctx.user.name} · ${qty} back to ${where.label} · credit note queued`);
      await this.activity.log(tx, ctx, { entityType: SAL_ENTITY.INVOICE, entityId: inv.id, docNo: inv.docNo, action: 'credited', message: `${r.docNo} released: credit ${toRmText(r.total)}`, comment: null });
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.RETURN_RELEASED, aggregateType: SAL_ENTITY.RETURN, aggregateId: r.id,
        payload: {
          returnNo: r.docNo, invoiceNo: inv.docNo, customerCode: r.customerCode, branchCode: r.branchCode, reason: r.reason,
          stockIn: { goodsTo: r.goodsTo, warehouseCode: r.warehouseCode, locationCode: r.locationCode },
          creditNote: { method: r.creditMethod, subtotal: toMoney(r.subtotal), taxTotal: toMoney(r.taxTotal), total: toMoney(r.total), originalInvoiceNo: inv.docNo },
          lines: r.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), unitPrice: l.unitPrice.toString(), taxCode: l.taxCode, amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Return lines at the invoice line's net price and tax; at most invoiced minus earlier returns (other drafts held). */
  private async buildLines(ctx: RequestContext, invLines: SalInvoiceLine[], input: ReturnLineDto[], excludeId?: string) {
    const held = await this.query.heldByDrafts(ctx.tenantId, invLines.map((l) => l.id), excludeId);
    const picked = input.map((w, index) => {
      const l = invLines.find((x) => x.id === w.invoiceLineId);
      if (!l) throw ValidationFailedError.field(`lines[${index}].invoiceLineId`, 'This line is not on the invoice.');
      const max = l.qty.sub(l.returnedQty).sub(held.get(l.id) ?? dec(0));
      return { l, qty: dec(w.qty), max: max.gt(0) ? max : dec(0) };
    });
    const problems = returnProblems(picked.map((p) => ({ qty: p.qty, max: p.max })));
    if (problems.length) throw new ValidationFailedError(problems, 'Check the quantities to return.');
    const lines = picked.filter((p) => p.qty.gt(0)).map(({ l, qty }) => {
      const t = saleLineTotals({ qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate });
      return {
        invoiceLineId: l.id, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxRate: l.taxRate,
        invoicedQty: l.qty, returnedBeforeQty: l.returnedQty, qty, unitPrice: l.unitPrice.mul(dec(100).sub(l.discountPct)).div(100).toDecimalPlaces(4),
        amount: t.amount, taxAmount: t.taxAmount,
      };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.amount), dec(0));
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), dec(0));
    return { lines, subtotal, taxTotal, total: subtotal.add(taxTotal), summary: returnSummary(lines) };
  }

  private async resolveLocation(ctx: RequestContext, branchCode: string, key: string | undefined) {
    if (!key) return null;
    const found = (await this.query.locations(ctx.tenantId, branchCode)).find((l) => l.key === key);
    if (!found) throw ValidationFailedError.field('location', 'Pick a return location from the list.');
    return found;
  }

  private require(ctx: RequestContext, r: ReturnWithLines, action: ReturnAction, message?: string) {
    if (!this.query.actions(ctx, r).includes(action)) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', r.status === 'DRAFT' && !r.isMigrated ? (message ?? 'You cannot change sales returns.') : SR_LOCKED_MESSAGE);
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalReturnUpdateManyMutationInput) {
    const result = await tx.salReturn.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.RETURN, entityId: id, docNo, action, message, comment: null });
  }
}
