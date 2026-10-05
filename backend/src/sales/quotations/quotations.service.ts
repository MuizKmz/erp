import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { toPrice, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { SalesDocumentLines } from '../shared/document-lines.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_LINK, SAL_ROLE } from '../shared/sales.constants';
import { SalesMailService } from '../shared/sales-mail.service';
import type { CreateQuotationDto, DiscountApprovalDto, LostDto, TransferDto, UpdateQuotationDto } from './dto/quotation.dto';
import { discountOverLimit, isExpired, QT_LOCKED_MESSAGE, releaseProblem, type QtAction } from './quotation.rules';
import { QuotationsQuery, type QuotationWithLines } from './quotations.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateText = (isoDate: string) => {
  const d = day(isoDate);
  return `${d.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d)} ${d.getUTCFullYear()}`;
};

/**
 * Quotation commands (FlowS1 steps 4–10). Every change runs in one transaction: the quotation, its activity,
 * links, approval requests and emails (logged). Revisions keep the number.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: QuotationsQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly docs: SalesDocumentLines,
    private readonly mail: SalesMailService,
    private readonly orders: OrdersService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  // ── Create and save ───────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateQuotationDto, message?: string) {
    const docDate = dto.docDate ?? this.clock.today();
    const customer = await this.docs.activeCustomer(ctx, dto.customerCode, 'a quotation');
    const branchCode = this.docs.branchFor(ctx, customer);
    const built = await this.docs.buildLines(ctx, customer, branchCode, docDate, dto.lines);
    const agent = await this.docs.agentFor(ctx, customer);
    const enquiry = dto.enquiryId ? await this.prisma.salEnquiry.findFirst({ where: { id: dto.enquiryId, tenantId: ctx.tenantId } }) : null;
    if (dto.enquiryId && !enquiry) throw ValidationFailedError.field('enquiryId', 'The enquiry was not found.');
    if (enquiry && (enquiry.status === 'QUOTED' || enquiry.status === 'LOST')) {
      throw new BusinessRuleError('ENQUIRY_CLOSED', `${enquiry.docNo} is already ${enquiry.status === 'QUOTED' ? `quoted on ${enquiry.quotationNo}` : 'lost'}.`);
    }
    this.checkDates(docDate, dto.validUntil ?? null);

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.QUOTATION, { date: docDate, branchCode });
      const q = await tx.salQuotation.create({
        data: {
          tenantId: ctx.tenantId, docNo, revision: 0, docDate: day(docDate), validUntil: dto.validUntil ? day(dto.validUntil) : null, status: 'DRAFT', branchCode,
          customerId: customer.id, customerCode: customer.code, customerName: customer.name, contactName: dto.contactName?.trim() || enquiry?.contactName || customer.contactName,
          agentCode: enquiry?.agentCode ?? agent.code, agentName: enquiry?.agentName ?? agent.name, currency: 'MYR', taxMode: 'EXCLUSIVE',
          creditTermDays: customer.creditTermDays, priceListCode: customer.priceListCode, enquiryId: enquiry?.id ?? null, enquiryNo: enquiry?.docNo ?? null,
          customerNote: dto.customerNote?.trim() || null, internalNote: dto.internalNote?.trim() || null,
          ...built.totals, costTotal: built.costTotal, createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map(({ isBuyToOrder: _b, ...l }, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await this.log(tx, ctx, q.id, docNo, 'created', message ?? (enquiry ? `Created from ${enquiry.docNo} by ${ctx.user.name}` : `Created by ${ctx.user.name}`));
      if (enquiry) {
        await tx.salEnquiry.update({ where: { id: enquiry.id }, data: { status: 'QUOTED', quotationNo: docNo, version: { increment: 1 }, updatedBy: ctx.user.code } });
        await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.ENQUIRY, fromId: enquiry.id, fromNo: enquiry.docNo, toType: SAL_ENTITY.QUOTATION, toId: q.id, toNo: docNo, linkType: SAL_LINK.QUOTED } });
        await this.activity.log(tx, ctx, { entityType: SAL_ENTITY.ENQUIRY, entityId: enquiry.id, docNo: enquiry.docNo, action: 'quoted', message: `Quoted on ${docNo} by ${ctx.user.name}` });
      }
      return q.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateQuotationDto) {
    const q = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, q, 'edit', q.status === 'PENDING_APPROVAL' ? `${q.docNo} is waiting for approval and is locked.` : QT_LOCKED_MESSAGE);
    const docDate = dto.docDate ?? iso(q.docDate)!;
    const customer = await this.docs.activeCustomer(ctx, dto.customerCode ?? q.customerCode, 'a quotation');
    const customerChanged = customer.code !== q.customerCode;
    const branchCode = customerChanged ? this.docs.branchFor(ctx, customer) : q.branchCode;
    const built = dto.lines ? await this.docs.buildLines(ctx, customer, branchCode, docDate, dto.lines) : null;
    this.checkDates(docDate, dto.validUntil === undefined ? iso(q.validUntil) : dto.validUntil);
    // Changing what was approved (prices, discounts, customer) removes the discount approval.
    const clearApproval = Boolean(q.approvedAt) && (customerChanged || (built !== null && !built.totals.total.eq(q.total)));

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SalQuotationUpdateManyMutationInput = {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.validUntil !== undefined && { validUntil: dto.validUntil ? day(dto.validUntil) : null }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName.trim() || null }),
        ...(dto.customerNote !== undefined && { customerNote: dto.customerNote.trim() || null }),
        ...(dto.internalNote !== undefined && { internalNote: dto.internalNote.trim() || null }),
        ...(customerChanged && {
          customerId: customer.id, customerCode: customer.code, customerName: customer.name, branchCode, creditTermDays: customer.creditTermDays, priceListCode: customer.priceListCode,
        }),
        ...(built && { ...built.totals, costTotal: built.costTotal }),
        ...(clearApproval && { approvedAt: null, approvalRequired: false }),
      };
      await this.bump(tx, ctx, q.id, dto.version, data, 'DRAFT');
      if (built) {
        await tx.salQuotationLine.deleteMany({ where: { quotationId: q.id } });
        await tx.salQuotationLine.createMany({ data: built.lines.map(({ isBuyToOrder: _b, ...l }, i) => ({ ...l, tenantId: ctx.tenantId, quotationId: q.id, lineNo: i + 1 })) });
      }
      await this.log(tx, ctx, q.id, q.docNo, 'saved', `Saved by ${ctx.user.name}`);
      if (clearApproval) await this.log(tx, ctx, q.id, q.docNo, 'approval_cleared', 'Discount approval cleared: the quotation changed after it was approved');
    });
    return this.query.detail(ctx, id);
  }

  /** Deletes a draft. A deleted revision brings the revision before it back. The number is never reused. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const q = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, q, 'delete', 'Only draft quotations can be deleted.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salQuotation.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.approvals.cancelPending(tx, ctx, SAL_ENTITY.QUOTATION, id);
      if (q.revision > 0) {
        const previous = await tx.salQuotation.findFirst({ where: { tenantId: ctx.tenantId, docNo: q.docNo, revision: q.revision - 1 } });
        if (previous) {
          await tx.salQuotation.update({ where: { id: previous.id }, data: { status: 'RELEASED', version: { increment: 1 } } });
          await tx.sysDocLink.updateMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.QUOTATION, toId: id }, data: { toId: previous.id } });
          await this.log(tx, ctx, previous.id, q.docNo, 'revision_deleted', `Revision ${q.revision} deleted by ${ctx.user.name}; revision ${previous.revision} is current again`);
        }
      } else {
        await tx.salEnquiry.updateMany({ where: { tenantId: ctx.tenantId, quotationNo: q.docNo }, data: { status: 'FORWARDED', quotationNo: null } });
        await this.log(tx, ctx, id, q.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${q.docNo} will not be used again.`);
      }
    });
    return { deleted: true, docNo: q.docNo };
  }

  // ── Discount approval (FlowS1 steps 5–6) ──────────────────────────────────

  async requestApproval(ctx: RequestContext, id: string, dto: DiscountApprovalDto) {
    const q = await this.query.load(ctx.tenantId, id);
    const limits = await this.query.discountLimit(ctx.tenantId);
    const discount = discountOverLimit(q.lines, limits.pct);
    if (!discount.over) throw new BusinessRuleError('APPROVAL_NOT_NEEDED', `No line is above the ${limits.pct.toString()}% discount limit. Release it directly.`);
    await this.requireAction(ctx, q, 'requestApproval', q.status === 'PENDING_APPROVAL' ? `${q.docNo} is already waiting for approval.` : QT_LOCKED_MESSAGE);
    const step = await this.docs.approver(ctx, SAL_ROLE.MANAGER, q.branchCode);
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, q.id, dto.version, { status: 'PENDING_APPROVAL', approvalRequired: true }, 'DRAFT');
      await this.approvals.create(tx, ctx, {
        entityType: SAL_ENTITY.QUOTATION, entityId: q.id, docNo: q.docNo, amount: q.total, title: `${q.docNo} · ${q.customerName}`,
        reason: `Discount ${discount.highest}%, above ${limits.pct.toString()}% rule`, requesterNote: dto.reason, steps: [step],
      });
      await this.log(tx, ctx, q.id, q.docNo, 'approval_requested', `Discount ${discount.highest}% · sent for approval to ${step.approverName}`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  // ── Release, email (FlowS1 step 7) ────────────────────────────────────────

  async release(ctx: RequestContext, id: string, version: number) {
    const q = await this.query.load(ctx.tenantId, id);
    const problem = releaseProblem({ validUntil: iso(q.validUntil), docDate: iso(q.docDate)! });
    if (q.status === 'DRAFT' && problem) throw ValidationFailedError.field('validUntil', problem);
    const limits = await this.query.discountLimit(ctx.tenantId);
    const discount = discountOverLimit(q.lines, limits.pct);
    if (q.status === 'DRAFT' && discount.over && !q.approvedAt) {
      throw new BusinessRuleError('DISCOUNT_APPROVAL_REQUIRED', `A discount of ${discount.highest}% is above the ${limits.pct.toString()}% limit. Request approval first.`);
    }
    await this.requireAction(ctx, q, 'release', q.status === 'PENDING_APPROVAL' ? `${q.docNo} is waiting for approval.` : `${q.docNo} is already released.`);
    await this.docs.activeCustomer(ctx, q.customerCode, 'a quotation');
    await this.docs.checkStillSellable(ctx, q.branchCode, q.lines.map((l) => l.itemCode));
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, q.id, version, { status: 'RELEASED', releasedAt: this.clock.now(), releasedByCode: ctx.user.code }, 'DRAFT');
      await this.log(tx, ctx, q.id, q.docNo, 'released', `Released by ${ctx.user.name} · valid until ${dateText(iso(q.validUntil)!)}`);
    });
    return this.query.detail(ctx, id);
  }

  async email(ctx: RequestContext, id: string) {
    const q = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, q, 'email', 'Release the quotation before emailing it.');
    const customer = await this.masterData.findCustomer(ctx.tenantId, q.customerCode);
    if (!customer?.email) throw new BusinessRuleError('NO_EMAIL', `${q.customerName} has no email address in Master Data.`);
    const agent = (await this.masterData.listUsers(ctx.tenantId)).find((u) => u.code === q.agentCode);
    await this.prisma.$transaction(async (tx) => {
      await this.mail.send(tx, ctx, {
        templateKey: 'QUOTATION', entityType: SAL_ENTITY.QUOTATION, entityId: q.id, docNo: q.docNo, to: customer.email!, agentEmail: agent?.email,
        vars: { 'contact.name': q.contactName ?? customer.name, 'document.number': q.docNo, 'document.total': toRmText(q.total), 'agent.name': q.agentName, 'agent.phone': '' },
      });
      await tx.salQuotation.update({ where: { id: q.id }, data: { emailedAt: this.clock.now() } });
      await this.log(tx, ctx, q.id, q.docNo, 'emailed', `Emailed to ${customer.email}`);
    });
    return { sentTo: customer.email };
  }

  // ── Revise, lost (FlowS1 step 9) ──────────────────────────────────────────

  /** Makes revision n+1 under the same number. The released revision stays read-only (Revised). */
  async revise(ctx: RequestContext, id: string, version: number) {
    const q = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, q, 'revise', 'Only released quotations can be revised.');
    const today = this.clock.today();
    const newId = await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, q.id, version, { status: 'SUPERSEDED' }, 'RELEASED');
      const { id: _id, lines, createdAt: _c, updatedAt: _u, ...header } = q;
      const created = await tx.salQuotation.create({
        data: {
          ...header,
          creditSnapshot: header.creditSnapshot ?? undefined,
          revision: q.revision + 1, status: 'DRAFT', docDate: day(today),
          validUntil: q.validUntil && iso(q.validUntil)! >= today ? q.validUntil : null,
          approvalRequired: false, approvedAt: null, releasedAt: null, releasedByCode: null, emailedAt: null, version: 1,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: lines.map(({ id: _l, quotationId: _q, ...l }) => l) },
        },
      });
      await tx.sysDocLink.updateMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.QUOTATION, toId: q.id }, data: { toId: created.id } });
      await this.log(tx, ctx, q.id, q.docNo, 'revised', `Revised by ${ctx.user.name} · revision ${q.revision + 1} is now the current one`);
      await this.log(tx, ctx, created.id, q.docNo, 'created', `Revision ${q.revision + 1} created from revision ${q.revision} by ${ctx.user.name}`);
      return created.id;
    });
    return this.query.detail(ctx, newId);
  }

  async markLost(ctx: RequestContext, id: string, dto: LostDto) {
    const q = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, q, 'markLost', 'Only released quotations can be marked as lost.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, q.id, dto.version, { status: 'LOST', lostReason: dto.reason.trim() }, 'RELEASED');
      await this.log(tx, ctx, q.id, q.docNo, 'lost', `Marked as lost by ${ctx.user.name}`, dto.reason.trim());
      if (q.enquiryId) {
        const enquiry = await tx.salEnquiry.findFirst({ where: { id: q.enquiryId } });
        if (enquiry && enquiry.status !== 'LOST') {
          await tx.salEnquiry.update({ where: { id: enquiry.id }, data: { status: 'LOST', lostReason: dto.reason.trim(), version: { increment: 1 } } });
          await this.activity.log(tx, ctx, { entityType: SAL_ENTITY.ENQUIRY, entityId: enquiry.id, docNo: enquiry.docNo, action: 'lost', message: `Closed as lost: ${q.docNo} was not accepted`, comment: dto.reason.trim() });
        }
      }
    });
    return this.query.detail(ctx, id);
  }

  // ── Transfer to sales order (FlowS1 step 10) ──────────────────────────────

  /** Copies all lines, or only some, at the quoted prices into a new draft sales order. The credit check runs there. */
  async transferToOrder(ctx: RequestContext, id: string, dto: TransferDto) {
    const q = await this.query.load(ctx.tenantId, id);
    if (isExpired(q.status, iso(q.validUntil), this.clock.today())) {
      throw new BusinessRuleError('QUOTATION_EXPIRED', `${q.docNo} expired on ${dateText(iso(q.validUntil)!)}. Revise it with a new date first.`);
    }
    await this.requireAction(ctx, q, 'transfer', q.status === 'ORDERED' ? `${q.docNo} is already turned into ${q.salesOrderNo}.` : 'Release the quotation before turning it into an order.');
    const lines = dto.lineNos?.length ? q.lines.filter((l) => dto.lineNos!.includes(l.lineNo)) : q.lines;
    if (!lines.length) throw ValidationFailedError.field('lineNos', 'Pick at least one line to copy.');

    const prepared = await this.orders.prepareDraft(ctx, {
      customerCode: q.customerCode,
      contactName: q.contactName ?? undefined,
      lines: lines.map((l) => ({ itemCode: l.itemCode, qty: toQty(l.qty), unitPrice: toPrice(l.unitPrice), discountPct: l.discountPct.toFixed(2) })),
    });
    const result = await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, q.id, dto.version, { status: 'ORDERED' }, 'RELEASED');
      const order = await this.orders.insertDraft(tx, ctx, prepared, {
        quotationId: q.id, quotationNo: q.docNo, enquiryNo: q.enquiryNo, agent: { code: q.agentCode, name: q.agentName },
        message: `Created from ${q.docNo} by ${ctx.user.name}`,
      });
      await tx.salQuotation.update({ where: { id: q.id }, data: { salesOrderNo: order.docNo } });
      await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.QUOTATION, fromId: q.id, fromNo: q.docNo, toType: SAL_ENTITY.ORDER, toId: order.id, toNo: order.docNo, linkType: SAL_LINK.ORDERED } });
      await this.log(tx, ctx, q.id, q.docNo, 'ordered', `Turned into ${order.docNo}${lines.length < q.lines.length ? ` (${lines.length} of ${q.lines.length} lines)` : ''}`);
      return order;
    });
    return { orderId: result.id, orderNo: result.docNo };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private checkDates(docDate: string, validUntil: string | null) {
    if (validUntil && validUntil < docDate) throw ValidationFailedError.field('validUntil', 'Valid until cannot be before the quotation date.');
  }

  private async requireAction(ctx: RequestContext, q: QuotationWithLines, action: QtAction, message: string) {
    const limits = await this.query.discountLimit(ctx.tenantId);
    if (!this.query.actions(ctx, q, limits.pct).includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalQuotationUpdateManyMutationInput, status?: 'DRAFT' | 'RELEASED') {
    const result = await tx.salQuotation.updateMany({
      where: { id, tenantId: ctx.tenantId, version, ...(status && { status }) },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment?: string | null) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.QUOTATION, entityId: id, docNo, action, message, comment: comment ?? null });
  }
}
