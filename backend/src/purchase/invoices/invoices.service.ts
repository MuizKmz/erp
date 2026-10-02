import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurPurchaseOrderLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY, PUR_ROLE } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CreateInvoiceDto, DecideInvoiceDto, InvoiceLineDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceApprovalService } from './invoice-approval.service';
import { dueDate, fixedSummary, matchInvoice, recordedLines, type InvoiceAction, type InvoiceDecision } from './invoice.rules';
import { InvoicesQuery, type InvoiceWithLines } from './invoices.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Supplier invoice commands (FlowP5): record the bill, let the three-way match run, then record it, hold it,
 * or accept it as billed (Purchasing Manager approval). Approved invoices become payables for Finance.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: InvoicesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly mail: PurchaseMailService,
    private readonly invoiceApproval: InvoiceApprovalService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Record and correct ────────────────────────────────────────────────────

  /** FlowP5 step 1–2: the bill is numbered and matched at once (To match). */
  async create(ctx: RequestContext, dto: CreateInvoiceDto) {
    const po = await this.query.loadPo(ctx, dto.poId);
    await this.checkDuplicate(ctx, po.supplierCode, dto.supplierInvoiceNo.trim());
    this.checkDate(dto.invoiceDate);
    const built = await this.build(ctx, po.lines, dto.lines, dto.billedTax ?? null);

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.INVOICE);
      const invoice = await tx.purInvoice.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(this.clock.today()),
          status: 'TO_MATCH',
          branchCode: po.branchCode,
          supplierId: po.supplierId,
          supplierCode: po.supplierCode,
          supplierName: po.supplierName,
          supplierInvoiceNo: dto.supplierInvoiceNo.trim(),
          invoiceDate: day(dto.invoiceDate),
          dueDate: day(dueDate(dto.invoiceDate, po.paymentTermDays)),
          poId: po.id,
          poNo: po.docNo,
          currency: po.currency,
          supplierNote: dto.supplierNote?.trim() || null,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          ...built.header,
          lines: { create: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId })) },
        },
      });
      for (const grn of built.grns) {
        await tx.sysDocLink.create({
          data: {
            tenantId: ctx.tenantId, fromType: PUR_ENTITY.RECEIPT, fromId: grn.id, fromNo: grn.docNo,
            toType: PUR_ENTITY.INVOICE, toId: invoice.id, toNo: docNo, linkType: DOC_LINK.BILLED,
          },
        });
      }
      if (dto.attachmentIds?.length) await this.attachments.attach(tx, ctx, dto.attachmentIds, PUR_ENTITY.INVOICE, invoice.id);
      await this.log(tx, ctx, invoice.id, docNo, 'created', `Recorded ${invoice.supplierInvoiceNo} · ${built.matched ? 'all three agree' : lower(built.header.matchSummary)}`);
      return invoice.id;
    });
    return this.query.detail(ctx, id);
  }

  /** While still to match: correct their invoice number, date, billed figures (e.g. a corrected invoice). */
  async update(ctx: RequestContext, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, invoice, 'edit');
    const supplierInvoiceNo = dto.supplierInvoiceNo?.trim() ?? invoice.supplierInvoiceNo;
    if (supplierInvoiceNo !== invoice.supplierInvoiceNo) await this.checkDuplicate(ctx, invoice.supplierCode, supplierInvoiceNo);
    const invoiceDate = dto.invoiceDate ?? isoDate(invoice.invoiceDate);
    this.checkDate(invoiceDate);
    const po = await this.query.loadPo(ctx, invoice.poId);
    const lines = dto.lines ?? invoice.lines.map((l) => ({ poLineId: l.poLineId, billedQty: l.billedQty.toString(), billedUnitPrice: l.billedUnitPrice.toString() }));
    const billedTax = dto.billedTax !== undefined ? dto.billedTax : invoice.billedTax.toString();
    const built = await this.build(ctx, po.lines, lines, billedTax, invoice.id);

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, {
        supplierInvoiceNo,
        invoiceDate: day(invoiceDate),
        dueDate: day(dueDate(invoiceDate, po.paymentTermDays)),
        ...(dto.supplierNote !== undefined && { supplierNote: dto.supplierNote.trim() || null }),
        ...built.header,
      });
      await tx.purInvoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.purInvoiceLine.createMany({ data: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId, invoiceId: id })) });
      if (dto.attachmentIds?.length) await this.attachments.attach(tx, ctx, dto.attachmentIds, PUR_ENTITY.INVOICE, id);
      const changed = !invoice.billedSubtotal.eq(built.header.billedSubtotal) || !invoice.billedTax.eq(built.header.billedTax);
      if (changed) await this.log(tx, ctx, id, invoice.docNo, 'corrected', `Billed figures corrected · ${built.matched ? 'all three agree' : lower(built.header.matchSummary)}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const invoice = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, invoice, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purInvoice.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'TO_MATCH' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: PUR_ENTITY.INVOICE, toId: id } });
      await this.log(tx, ctx, id, invoice.docNo, 'deleted', `Deleted by ${ctx.user.name}. ${invoice.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: invoice.docNo };
  }

  // ── Decide ────────────────────────────────────────────────────────────────

  /**
   * FlowP5 steps 3–6. "record": inside tolerance it is recorded as billed; outside it records only what was
   * received at the PO price. "hold": waits for a corrected invoice. "acceptAsBilled": Purchasing Manager.
   */
  async decide(ctx: RequestContext, id: string, dto: DecideInvoiceDto) {
    const invoice = await this.query.load(ctx.tenantId, id);
    const action: InvoiceAction = dto.action;
    await this.requireAction(ctx, invoice, action);
    const [inputs, tol, view, supplier] = await Promise.all([
      this.query.matchInputs(ctx.tenantId, invoice),
      this.query.tolerance(ctx.tenantId),
      this.query.detail(ctx, id),
      this.masterData.findSupplier(ctx.tenantId, invoice.supplierCode),
    ]);
    const match = matchInvoice(inputs, invoice.billedTax, tol);
    const decision: InvoiceDecision | 'MATCHED' = match.matched ? 'MATCHED' : action === 'record' ? 'RECORD_RECEIVED' : action === 'hold' ? 'HOLD' : 'ACCEPT_AS_BILLED';
    const recorded = recordedLines(inputs, match.lines, decision === 'HOLD' ? 'RECORD_RECEIVED' : decision);
    const totals = documentTotals(recorded);
    const message = dto.message?.trim() || (decision === 'HOLD' ? view.messages.hold : view.messages.record);
    const summary = decision === 'MATCHED' ? 'All three agree' : decision === 'RECORD_RECEIVED' ? fixedSummary(inputs, match.lines) : match.summary;

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, {
        decision: decision === 'MATCHED' ? null : decision,
        matchResult: decision === 'MATCHED' ? 'MATCHED' : 'DIFFERENCE',
        matchSummary: summary,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        messageToSupplier: decision === 'RECORD_RECEIVED' || decision === 'HOLD' ? message : null,
        decisionNote: dto.note?.trim() || null,
      });
      // What was received when the decision was made stays with the invoice (the match table keeps it).
      for (const [i, line] of invoice.lines.entries()) {
        const r = recorded[i]!;
        await tx.purInvoiceLine.update({
          where: { id: line.id },
          data: { receivedQty: dec(inputs[i]!.billableQty).lt(0) ? dec(0) : dec(inputs[i]!.billableQty), qty: r.qty, unitPrice: r.unitPrice, amount: r.amount, taxAmount: r.taxAmount },
        });
      }

      if (decision === 'MATCHED' || decision === 'RECORD_RECEIVED') {
        await this.invoiceApproval.postApproved(tx, ctx, id, { status: 'APPROVED' });
        if (decision === 'RECORD_RECEIVED') await this.emailSupplier(tx, ctx, invoice, supplier?.email ?? null, supplier?.shortName ?? invoice.supplierName, message, totals.total);
        await this.log(
          tx, ctx, id, invoice.docNo, 'approved',
          decision === 'MATCHED'
            ? `Recorded by ${ctx.user.name} · all three agree · payable queued for Finance`
            : `Recorded ${toRmText(totals.total)} for what was received by ${ctx.user.name} · ${lower(summary)}${supplier?.email ? ' · supplier emailed' : ''}`,
        );
      } else if (decision === 'HOLD') {
        await this.emailSupplier(tx, ctx, invoice, supplier?.email ?? null, supplier?.shortName ?? invoice.supplierName, message, totals.total);
        await this.log(tx, ctx, id, invoice.docNo, 'held', `Put on hold by ${ctx.user.name} · supplier asked for a corrected invoice or credit note`);
      } else {
        const approver = await this.manager(ctx, invoice.branchCode);
        await tx.purInvoice.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
        await this.approvals.create(tx, ctx, {
          entityType: PUR_ENTITY.INVOICE,
          entityId: id,
          docNo: invoice.docNo,
          amount: totals.total,
          title: `${invoice.docNo} · ${invoice.supplierName}`,
          reason: view.options.approvalReason,
          requesterNote: dto.note?.trim() || null,
          steps: [{ approverRole: PUR_ROLE.MANAGER, approverCode: approver?.code ?? null, approverName: approver?.name ?? null }],
        });
        if (approver) {
          await this.mail.send(tx, ctx, {
            templateKey: 'APPROVAL_REQUEST',
            entityType: PUR_ENTITY.INVOICE,
            entityId: id,
            docNo: invoice.docNo,
            vars: {
              'approver.name': approver.name,
              'approver.email': approver.email,
              'requester.name': ctx.user.name,
              'doc.number': invoice.docNo,
              'doc.title': `${invoice.docNo} · ${invoice.supplierName}`,
              'approval.reason': view.options.approvalReason,
              'doc.currency': 'RM',
              'doc.total': toRmText(totals.total).replace(/^RM /, ''),
              'approval.note': dto.note?.trim() || '—',
            },
          });
        }
        await this.activity.log(tx, ctx, {
          entityType: PUR_ENTITY.INVOICE, entityId: id, docNo: invoice.docNo, action: 'submitted',
          message: `Sent for approval to ${approver?.name ?? 'the Purchasing Manager'}`, comment: dto.note?.trim() || null,
        });
      }
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Line snapshots, billed amounts, the match and what would be recorded. The same supplier PO line may be
   * billed only once per invoice; billed quantities may be 0 for lines they did not bill.
   */
  private async build(ctx: RequestContext, poLines: PurPurchaseOrderLine[], input: InvoiceLineDto[], billedTaxInput: string | null, excludeInvoiceId?: string) {
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    input.forEach((l, i) => {
      if (!poLines.some((p) => p.id === l.poLineId)) errors.push({ field: `lines[${i}].poLineId`, message: 'This line is not on the purchase order.' });
      else if (seen.has(l.poLineId)) errors.push({ field: `lines[${i}].poLineId`, message: 'This line is on the invoice twice.' });
      seen.add(l.poLineId);
    });
    if (!input.some((l) => dec(l.billedQty).gt(0))) errors.push({ field: 'lines', message: 'Enter the quantity billed for at least one line.' });
    if (errors.length) throw new ValidationFailedError(errors);

    const ids = input.map((l) => l.poLineId);
    const [billable, receipts, tol] = await Promise.all([
      this.query.billable(ctx.tenantId, ids, excludeInvoiceId),
      this.query.latestReceiptLines(ctx.tenantId, ids),
      this.query.tolerance(ctx.tenantId),
    ]);
    const rows = input.map((l, i) => {
      const p = poLines.find((x) => x.id === l.poLineId)!;
      const billed = lineTotals({ qty: l.billedQty, unitPrice: l.billedUnitPrice, taxRate: p.taxRate });
      const receivable = billable.get(p.id)!;
      return {
        p,
        dto: l,
        billed,
        input: {
          lineNo: i + 1,
          orderedQty: p.orderedQty,
          orderedPrice: p.unitPrice,
          billableQty: receivable,
          billedQty: l.billedQty,
          billedPrice: l.billedUnitPrice,
          taxRate: p.taxRate,
        },
      };
    });
    const billedTotals = documentTotals(rows.map((r) => r.billed));
    const billedTax = billedTaxInput === null ? billedTotals.taxTotal : dec(billedTaxInput);
    const match = matchInvoice(rows.map((r) => r.input), billedTax, tol);
    const recorded = recordedLines(rows.map((r) => r.input), match.lines, match.matched ? 'MATCHED' : 'RECORD_RECEIVED');
    const recordedTotals = documentTotals(recorded);
    const grns = [...new Map(rows.map((r) => receipts.get(r.p.id)).filter((g) => g).map((g) => [g!.grn.id, { id: g!.grn.id, docNo: g!.grn.docNo }])).values()];

    return {
      matched: match.matched,
      grns,
      header: {
        billedSubtotal: billedTotals.subtotal,
        billedTax,
        billedTotal: billedTotals.subtotal.add(billedTax),
        subtotal: recordedTotals.subtotal,
        taxTotal: recordedTotals.taxTotal,
        total: recordedTotals.total,
        matchResult: (match.matched ? 'MATCHED' : 'DIFFERENCE') as 'MATCHED' | 'DIFFERENCE',
        matchSummary: match.summary,
      },
      lines: rows.map((r, i) => ({
        poLineId: r.p.id,
        grnLineId: receipts.get(r.p.id)?.id ?? null,
        lineNo: i + 1,
        itemId: r.p.itemId,
        itemCode: r.p.itemCode,
        itemName: r.p.itemName,
        uomCode: r.p.uomCode,
        taxCode: r.p.taxCode,
        taxRate: r.p.taxRate,
        orderedQty: r.p.orderedQty,
        orderedPrice: r.p.unitPrice,
        receivedQty: r.input.billableQty.lt(0) ? dec(0) : r.input.billableQty,
        billedQty: dec(r.dto.billedQty),
        billedUnitPrice: dec(r.dto.billedUnitPrice),
        billedAmount: r.billed.amount,
        billedTax: r.billed.taxAmount,
        qty: recorded[i]!.qty,
        unitPrice: recorded[i]!.unitPrice,
        amount: recorded[i]!.amount,
        taxAmount: recorded[i]!.taxAmount,
      })),
    };
  }

  /** FlowP5 step 1: the same supplier invoice number cannot be recorded twice. */
  private async checkDuplicate(ctx: RequestContext, supplierCode: string, supplierInvoiceNo: string) {
    const existing = await this.prisma.purInvoice.findFirst({
      where: { tenantId: ctx.tenantId, supplierCode, supplierInvoiceNo },
      select: { docNo: true, supplierName: true },
    });
    if (existing) {
      throw new BusinessRuleError('DUPLICATE_INVOICE', `${supplierInvoiceNo} from ${existing.supplierName} is already recorded as ${existing.docNo}.`);
    }
  }

  private checkDate(invoiceDate: string) {
    if (invoiceDate > this.clock.today()) throw ValidationFailedError.field('invoiceDate', 'The invoice date cannot be in the future.');
  }

  private async requireAction(ctx: RequestContext, invoice: InvoiceWithLines, action: InvoiceAction) {
    const inputs = await this.query.matchInputs(ctx.tenantId, invoice);
    const match = matchInvoice(inputs, invoice.billedTax, await this.query.tolerance(ctx.tenantId));
    if (this.query.actions(ctx, invoice, match.matched).includes(action)) return;
    if (invoice.status !== 'TO_MATCH') {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', `${invoice.docNo} is ${invoice.status === 'PENDING_APPROVAL' ? 'waiting for approval' : invoice.status.toLowerCase()} and can no longer be changed.`);
    }
    if (match.matched && (action === 'hold' || action === 'acceptAsBilled')) {
      throw new BusinessRuleError('ALREADY_MATCHED', `${invoice.docNo} matches the order and the goods received. Record it.`);
    }
    throw new BusinessRuleError('ACTION_NOT_ALLOWED', 'You cannot do this on a supplier invoice.');
  }

  /** The Purchasing Manager of the branch (Ahmad Zaki at HQ). */
  private async manager(ctx: RequestContext, branchCode: string) {
    const users = (await this.masterData.listUsers(ctx.tenantId)).filter((u) => u.isActive && u.roles.includes(PUR_ROLE.MANAGER) && u.code !== ctx.user.code);
    return users.find((u) => u.branchCodes.includes(branchCode)) ?? users[0] ?? null;
  }

  private async emailSupplier(tx: Tx, ctx: RequestContext, invoice: InvoiceWithLines, email: string | null, contact: string, message: string, total: Prisma.Decimal) {
    if (!email) return;
    await this.mail.send(tx, ctx, {
      templateKey: 'INVOICE_DIFFERENCE',
      entityType: PUR_ENTITY.INVOICE,
      entityId: invoice.id,
      docNo: invoice.docNo,
      vars: {
        'supplier.contact': contact,
        'supplier.email': email,
        'invoice.supplier_no': invoice.supplierInvoiceNo,
        'invoice.recorded_total': toRmText(total),
        'invoice.message': message,
        'buyer.name': ctx.user.name,
        'buyer.email': ctx.user.email,
      },
    });
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurInvoiceUpdateManyMutationInput) {
    const result = await tx.purInvoice.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status: 'TO_MATCH' },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.INVOICE, entityId: id, docNo, action, message });
  }
}
