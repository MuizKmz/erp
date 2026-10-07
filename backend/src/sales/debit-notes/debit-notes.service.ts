import { Injectable } from '@nestjs/common';
import type { Prisma, SalInvoice } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import type { OrderLineDto } from '../orders/dto/order.dto';
import { SalesDocumentLines } from '../shared/document-lines.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT, SAL_LINK } from '../shared/sales.constants';
import { debitSummary, DN_LOCKED_MESSAGE, invoiceProblem, type DebitNoteAction } from './debit-note.rules';
import { DebitNotesQuery, type DebitWithLines } from './debit-notes.query';
import type { CreateDebitDto, UpdateDebitDto } from './dto/debit-note.dto';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Debit note commands (FlowS6 steps 9–11). A debit note always points to one released invoice, never moves stock,
 * and on release raises that invoice's balance; posting and a debit-note e-Invoice are queued.
 */
@Injectable()
export class DebitNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: DebitNotesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly docs: SalesDocumentLines,
    private readonly clock: ClockService,
  ) {}

  async create(ctx: RequestContext, dto: CreateDebitDto) {
    const inv = await this.releasedInvoice(ctx, dto.invoiceId);
    const docDate = dto.docDate ?? this.clock.today();
    const built = await this.buildLines(ctx, inv, docDate, dto.lines);
    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.DEBIT_NOTE, { date: docDate, branchCode: inv.branchCode });
      const row = await tx.salDebitNote.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode: inv.branchCode,
          customerId: inv.customerId, customerCode: inv.customerCode, customerName: inv.customerName, invoiceId: inv.id, invoiceNo: inv.docNo, dueDate: inv.dueDate,
          reason: dto.reason?.trim() || 'Extra service requested', summary: built.summary, note: dto.note?.trim() || null, ...built.totals,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.INVOICE, fromId: inv.id, fromNo: inv.docNo, toType: SAL_ENTITY.DEBIT_NOTE, toId: row.id, toNo: docNo, linkType: SAL_LINK.DEBITED } });
      await this.log(tx, ctx, row.id, docNo, 'created', `Created on ${inv.docNo} by ${ctx.user.name}`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateDebitDto) {
    const d = await this.query.load(ctx.tenantId, id);
    this.require(ctx, d, 'edit');
    const inv = await this.releasedInvoice(ctx, dto.invoiceId ?? d.invoiceId ?? '');
    const docDate = dto.docDate ?? d.docDate.toISOString().slice(0, 10);
    const lines = dto.lines ?? d.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: '0' }));
    const built = await this.buildLines(ctx, inv, docDate, lines);
    const invoiceChanged = inv.id !== d.invoiceId;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, d.id, dto.version, {
        docDate: day(docDate),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() || d.reason }),
        ...(dto.note !== undefined && { note: dto.note.trim() || null }),
        ...(invoiceChanged && {
          invoiceId: inv.id, invoiceNo: inv.docNo, dueDate: inv.dueDate, customerId: inv.customerId, customerCode: inv.customerCode, customerName: inv.customerName, branchCode: inv.branchCode,
        }),
        summary: built.summary,
        ...built.totals,
      });
      await tx.salDebitNoteLine.deleteMany({ where: { debitNoteId: d.id } });
      await tx.salDebitNoteLine.createMany({ data: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, debitNoteId: d.id, lineNo: i + 1 })) });
      if (invoiceChanged) {
        await tx.sysDocLink.updateMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.DEBIT_NOTE, toId: d.id }, data: { fromId: inv.id, fromNo: inv.docNo } });
      }
      await this.log(tx, ctx, d.id, d.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const d = await this.query.load(ctx.tenantId, id);
    this.require(ctx, d, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salDebitNote.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.DEBIT_NOTE, toId: id } });
      await this.log(tx, ctx, id, d.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${d.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: d.docNo };
  }

  /** Release: the invoice row is locked and its debited amount raised in the same transaction as the events. */
  async release(ctx: RequestContext, id: string, version: number) {
    const d = await this.query.load(ctx.tenantId, id);
    this.require(ctx, d, 'release');
    await this.docs.checkStillSellable(ctx, d.branchCode, d.lines.map((l) => l.itemCode));
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sal_invoice WHERE id = ${d.invoiceId} FOR UPDATE`;
      const inv = await tx.salInvoice.findUniqueOrThrow({ where: { id: d.invoiceId! } });
      const problem = invoiceProblem(inv);
      if (problem) throw new BusinessRuleError('INVOICE_NOT_RELEASED', problem);
      await tx.salInvoice.update({ where: { id: inv.id }, data: { debitedAmount: { increment: d.total }, version: { increment: 1 }, updatedBy: ctx.user.code } });
      await this.bump(tx, ctx, d.id, version, { status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code });
      await this.log(tx, ctx, d.id, d.docNo, 'released', `Released by ${ctx.user.name} · ${inv.docNo} raised by ${toRmText(d.total)} · posting and debit-note e-Invoice queued`);
      await this.activity.log(tx, ctx, { entityType: SAL_ENTITY.INVOICE, entityId: inv.id, docNo: inv.docNo, action: 'debited', message: `${d.docNo} released: ${toRmText(d.total)} added`, comment: null });
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.DEBIT_NOTE_RELEASED, aggregateType: SAL_ENTITY.DEBIT_NOTE, aggregateId: d.id,
        payload: {
          debitNoteNo: d.docNo, invoiceNo: inv.docNo, customerCode: d.customerCode, branchCode: d.branchCode, reason: d.reason,
          dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
          subtotal: toMoney(d.subtotal), taxTotal: toMoney(d.taxTotal), total: toMoney(d.total),
          lines: d.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), unitPrice: l.unitPrice.toString(), taxCode: l.taxCode, amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async releasedInvoice(ctx: RequestContext, invoiceId: string): Promise<SalInvoice> {
    const inv = invoiceId ? await this.prisma.salInvoice.findFirst({ where: { id: invoiceId, tenantId: ctx.tenantId } }) : null;
    const problem = invoiceProblem(inv);
    if (problem) throw ValidationFailedError.field('invoiceId', problem);
    return inv!;
  }

  /** Charges are items from Master Data like goods (service items too); their tax code decides the tax. */
  private async buildLines(ctx: RequestContext, inv: SalInvoice, docDate: string, input: OrderLineDto[]) {
    const customer = await this.docs.activeCustomer(ctx, inv.customerCode, 'a debit note');
    const built = await this.docs.buildLines(ctx, customer, inv.branchCode, docDate, input.map((l) => ({ ...l, discountPct: '0' })));
    const lines = built.lines.map((l) => ({
      itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxRate: l.taxRate, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, taxAmount: l.taxAmount,
    }));
    const subtotal = lines.reduce((s, l) => s.add(l.amount), dec(0));
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), dec(0));
    return { lines, summary: debitSummary(lines), totals: { subtotal, taxTotal, total: subtotal.add(taxTotal) } };
  }

  private require(ctx: RequestContext, d: DebitWithLines, action: DebitNoteAction) {
    if (!this.query.actions(ctx, d).includes(action)) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', d.status === 'DRAFT' && !d.isMigrated ? 'Only the billing team can change debit notes.' : DN_LOCKED_MESSAGE);
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalDebitNoteUpdateManyMutationInput) {
    const result = await tx.salDebitNote.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.DEBIT_NOTE, entityId: id, docNo, action, message, comment: null });
  }
}
