import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import type { DecisionResult } from '../../platform/approvals/approvals.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY, PUR_ROLE } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CreateDebitNoteDto, DebitLineDto, SubmitDebitNoteDto, UpdateDebitNoteDto } from './dto/debit-note.dto';
import { chargesOnPo, type DebitNoteAction } from './debit-note.rules';
import { DebitNotesQuery, type DebitNoteWithLines } from './debit-notes.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = day(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
};

/**
 * Supplier debit note commands (FlowP6 steps 9–12): an extra charge on a supplier invoice. Charges that are on
 * the PO are released directly; a charge not on the PO goes to the Purchasing Manager first (rule 11).
 */
@Injectable()
export class DebitNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: DebitNotesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly outbox: OutboxWriter,
    private readonly mail: PurchaseMailService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Draft ─────────────────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateDebitNoteDto) {
    const invoice = await this.query.loadInvoice(ctx, dto.invoiceId);
    const docDate = dto.docDate ?? this.clock.today();
    this.checkDate(docDate);
    const built = await this.build(ctx, dto.lines, invoice.po.lines.map((l) => l.itemCode));

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.DEBIT_NOTE);
      const row = await tx.purDebitNote.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(docDate),
          status: 'DRAFT',
          branchCode: invoice.branchCode,
          supplierId: invoice.supplierId,
          supplierCode: invoice.supplierCode,
          supplierName: invoice.supplierName,
          invoiceId: invoice.id,
          invoiceNo: invoice.docNo,
          supplierInvoiceNo: invoice.supplierInvoiceNo,
          theirNoteNo: dto.theirNoteNo.trim(),
          reason: dto.reason.trim(),
          chargeOnPo: built.onPo,
          dueDate: day(addDays(docDate, invoice.po.paymentTermDays)),
          remarks: dto.remarks?.trim() || null,
          ...built.totals,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId })) },
        },
      });
      await tx.sysDocLink.create({
        data: {
          tenantId: ctx.tenantId, fromType: PUR_ENTITY.INVOICE, fromId: invoice.id, fromNo: invoice.docNo,
          toType: PUR_ENTITY.DEBIT_NOTE, toId: row.id, toNo: docNo, linkType: DOC_LINK.DEBITED,
        },
      });
      await this.log(tx, ctx, row.id, docNo, 'created', `Recorded by ${ctx.user.name} · ${built.onPo ? 'charges are on the PO' : 'a charge is not on the PO, so it needs approval'}`);
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, row.id, docNo, dto.attachmentIds);
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateDebitNoteDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'edit', this.lockedMessage(row));
    const invoice = await this.query.loadInvoice(ctx, row.invoiceId!);
    const docDate = dto.docDate ?? isoDate(row.docDate);
    this.checkDate(docDate);
    const built = dto.lines ? await this.build(ctx, dto.lines, invoice.po.lines.map((l) => l.itemCode)) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, ['DRAFT'], {
        docDate: day(docDate),
        dueDate: day(addDays(docDate, invoice.po.paymentTermDays)),
        ...(dto.theirNoteNo !== undefined && { theirNoteNo: dto.theirNoteNo.trim() }),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(built && { chargeOnPo: built.onPo, ...built.totals }),
      });
      if (built) {
        await tx.purDebitNoteLine.deleteMany({ where: { debitNoteId: id } });
        await tx.purDebitNoteLine.createMany({ data: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId, debitNoteId: id })) });
      }
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, id, row.docNo, dto.attachmentIds);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'delete', this.lockedMessage(row));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purDebitNote.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: { in: ['DRAFT', 'REJECTED'] } } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: PUR_ENTITY.DEBIT_NOTE, toId: id } });
      await this.log(tx, ctx, id, row.docNo, 'deleted', `Deleted by ${ctx.user.name}. ${row.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: row.docNo };
  }

  // ── Approval and release ──────────────────────────────────────────────────

  /** Rule 11: a charge not on the PO goes to the Purchasing Manager with the check result. */
  async submit(ctx: RequestContext, id: string, dto: SubmitDebitNoteDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'submit', row.chargeOnPo ? 'Every charge is on the PO. Release it directly.' : this.lockedMessage(row));
    const check = await this.query.check(ctx, row.invoiceId!, row.lines.map((l) => l.itemCode), row.total);
    const approver = await this.query.manager(ctx, row.branchCode);
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, ['DRAFT'], { status: 'PENDING_APPROVAL' });
      await this.approvals.create(tx, ctx, {
        entityType: PUR_ENTITY.DEBIT_NOTE,
        entityId: id,
        docNo: row.docNo,
        amount: row.total,
        title: `${row.docNo} · ${row.supplierName}`,
        reason: `Charge not on ${check.po.docNo} · adds ${toRmText(row.total)} to ${row.invoiceNo}`,
        requesterNote: dto.note?.trim() || null,
        steps: [{ approverRole: PUR_ROLE.MANAGER, approverCode: approver?.code ?? null, approverName: approver?.name ?? null }],
      });
      if (approver) {
        await this.mail.send(tx, ctx, {
          templateKey: 'APPROVAL_REQUEST',
          entityType: PUR_ENTITY.DEBIT_NOTE,
          entityId: id,
          docNo: row.docNo,
          vars: {
            'approver.name': approver.name,
            'approver.email': approver.email,
            'requester.name': ctx.user.name,
            'doc.number': row.docNo,
            'doc.title': `${row.docNo} · ${row.supplierName}`,
            'approval.reason': check.message,
            'doc.currency': 'RM',
            'doc.total': toRmText(row.total).replace(/^RM /, ''),
            'approval.note': dto.note?.trim() || '—',
          },
        });
      }
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.DEBIT_NOTE, entityId: id, docNo: row.docNo, action: 'submitted',
        message: `Sent for approval to ${approver?.name ?? 'the Purchasing Manager'}`, comment: dto.note?.trim() || null,
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Charges on the PO need no approval: released directly. */
  async release(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'release', row.chargeOnPo ? this.lockedMessage(row) : 'A charge is not on the PO. Send it for approval first.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, version, ['DRAFT'], {});
      await this.postReleased(tx, ctx, row);
      await this.log(tx, ctx, id, row.docNo, 'released', `Released by ${ctx.user.name} · charges are on the PO`);
    });
    return this.query.detail(ctx, id);
  }

  /** What an approvals-inbox decision does to a debit note. */
  async onApprovalDecision(tx: Tx, ctx: RequestContext, result: DecisionResult, comment: string | null) {
    const row = await tx.purDebitNote.findFirstOrThrow({ where: { id: result.entityId, tenantId: ctx.tenantId }, include: { lines: true } });
    const log = (action: string, message: string) => this.activity.log(tx, ctx, { entityType: PUR_ENTITY.DEBIT_NOTE, entityId: row.id, docNo: row.docNo, action, message, comment });
    if (result.outcome === 'NEXT_STEP') return log('approved_step', `Approved by ${ctx.user.name} · waiting for the next approver`);
    if (result.outcome === 'REJECTED') {
      await tx.purDebitNote.update({ where: { id: row.id }, data: { status: 'REJECTED', version: { increment: 1 }, updatedBy: ctx.user.code } });
      return log('rejected', `Rejected by ${ctx.user.name} · ask the supplier to withdraw it`);
    }
    await tx.purDebitNote.update({ where: { id: row.id }, data: { version: { increment: 1 }, updatedBy: ctx.user.code } });
    await this.postReleased(tx, ctx, row);
    return log('approved', `Approved by ${ctx.user.name} · ${toRmText(row.total)} added to ${row.invoiceNo}`);
  }

  /** We owe more on the invoice; the posting waits for Finance. */
  private async postReleased(tx: Tx, ctx: RequestContext, row: DebitNoteWithLines) {
    await tx.purDebitNote.update({ where: { id: row.id }, data: { status: 'RELEASED', releasedAt: this.clock.now(), releasedByCode: ctx.user.code } });
    const invoice = row.invoiceId ? await tx.purInvoice.findUnique({ where: { id: row.invoiceId } }) : null;
    if (invoice) {
      await this.activity.log(tx, ctx, {
        entityType: PUR_ENTITY.INVOICE, entityId: invoice.id, docNo: invoice.docNo, action: 'debited',
        message: `${row.docNo}: + ${toRmText(row.total)} (${row.theirNoteNo}) · we owe ${toRmText(invoice.total.add(row.total))}`,
      });
    }
    await this.outbox.publish(tx, ctx, [{
      name: 'purchase.debit_note.released',
      aggregateType: PUR_ENTITY.DEBIT_NOTE,
      aggregateId: row.id,
      payload: {
        pdnNo: row.docNo,
        piNo: row.invoiceNo,
        supplierCode: row.supplierCode,
        theirNoteNo: row.theirNoteNo,
        amount: toMoney(row.total),
        subtotal: toMoney(row.subtotal),
        taxTotal: toMoney(row.taxTotal),
        dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
      },
    }]);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Charges are items from Master Data with their own tax code (services use the service tax code). */
  private async build(ctx: RequestContext, input: DebitLineDto[], poItemCodes: string[]) {
    const codes = [...new Set(input.map((l) => l.itemCode))];
    const [items, taxes] = await Promise.all([this.masterData.findItems(ctx.tenantId, codes), this.masterData.listTaxCodes(ctx.tenantId)]);
    const errors: FieldError[] = [];
    const lines = input.map((l, i) => {
      const item = items.find((it) => it.code === l.itemCode);
      if (!item) errors.push({ field: `lines[${i}].itemCode`, message: `Item ${l.itemCode} is not in Master Data.` });
      else if (item.status !== 'ACTIVE') errors.push({ field: `lines[${i}].itemCode`, message: `${item.code} is not active in Master Data.` });
      if (!dec(l.qty).gt(0)) errors.push({ field: `lines[${i}].qty`, message: 'Quantity must be more than 0.' });
      if (!dec(l.unitPrice).gt(0)) errors.push({ field: `lines[${i}].unitPrice`, message: 'Unit price must be more than 0.' });
      const tax = taxes.find((t) => t.code === item?.purchaseTaxCode);
      const t = lineTotals({ qty: l.qty, unitPrice: l.unitPrice, taxRate: tax?.rate ?? 0 });
      return {
        lineNo: i + 1,
        itemId: item?.id ?? '',
        itemCode: l.itemCode,
        itemName: item?.name ?? l.itemCode,
        uomCode: item?.uomCode ?? '',
        taxCode: item?.purchaseTaxCode ?? '',
        taxRate: dec(tax?.rate ?? 0),
        unitPrice: dec(l.unitPrice),
        qty: dec(l.qty),
        amount: t.amount,
        taxAmount: t.taxAmount,
      };
    });
    if (errors.length) throw new ValidationFailedError(errors);
    const totals = documentTotals(lines);
    return {
      lines,
      onPo: chargesOnPo(lines.map((l) => l.itemCode), poItemCodes).onPo,
      totals: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total },
    };
  }

  private checkDate(docDate: string) {
    if (docDate > this.clock.today()) throw ValidationFailedError.field('docDate', 'The date cannot be in the future.');
  }

  private async attachFiles(tx: Tx, ctx: RequestContext, id: string, docNo: string, ids: string[]) {
    await this.attachments.attach(tx, ctx, ids, PUR_ENTITY.DEBIT_NOTE, id);
    await this.log(tx, ctx, id, docNo, 'files', `${ids.length === 1 ? 'A file' : `${ids.length} files`} added`);
  }

  private require(actions: DebitNoteAction[], action: DebitNoteAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(row: DebitNoteWithLines): string {
    if (row.isMigrated) return 'Migrated debit notes cannot be changed.';
    if (row.status === 'PENDING_APPROVAL') return `${row.docNo} is waiting for approval and is locked.`;
    if (row.status === 'RELEASED') return `${row.docNo} is released and locked.`;
    if (row.status === 'REJECTED') return `${row.docNo} was rejected. Delete it, or record a new one.`;
    return 'You cannot change this debit note.';
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, statuses: ('DRAFT' | 'PENDING_APPROVAL')[], data: Prisma.PurDebitNoteUpdateManyMutationInput) {
    const result = await tx.purDebitNote.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status: { in: statuses } },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.DEBIT_NOTE, entityId: id, docNo, action, message });
  }
}
