import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalProforma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DepositsService } from '../shared/deposits.service';
import { mailDate, SalesMailService } from '../shared/sales-mail.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_LINK } from '../shared/sales.constants';
import type { CreateProformaDto, UpdateProformaDto } from './dto/proforma.dto';
import { depositAmount, PF_LOCKED_MESSAGE, requestLabel, requestProblem, type PfRequestKind, type PfStatus, type ProformaAction } from './proforma.rules';
import { ProformasQuery } from './proformas.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, days: number) => {
  const d = day(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/**
 * Proforma commands (FlowS4). A proforma only asks for money: nothing is posted, nothing goes to LHDN and the order
 * does not change. Finance records the payment; the deposit is used by the order's next invoice.
 */
@Injectable()
export class ProformasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: ProformasQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly deposits: DepositsService,
    private readonly mail: SalesMailService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async create(ctx: RequestContext, dto: CreateProformaDto) {
    const order = await this.prisma.salSalesOrder.findFirst({ where: { id: dto.salesOrderId, tenantId: ctx.tenantId }, include: { lines: true, proformas: true } });
    if (!order) throw ValidationFailedError.field('salesOrderId', 'Pick a released sales order.');
    if (order.isMigrated || !['RELEASED', 'PARTIAL'].includes(order.status)) {
      throw new BusinessRuleError('ORDER_NOT_RELEASED', `${order.docNo} is not released. A proforma is made for a released order with something still to deliver.`);
    }
    const open = order.proformas.find((p) => ['DRAFT', 'SENT', 'PAID'].includes(p.status));
    if (open) throw new BusinessRuleError('PROFORMA_EXISTS', `${order.docNo} already has ${open.docNo}. Cancel it first to ask for a different deposit.`);
    const kind = (dto.requestKind ?? 'DEPOSIT_PCT') as PfRequestKind;
    const pct = kind === 'DEPOSIT_PCT' ? (dto.depositPct ?? '30') : null;
    const problem = requestProblem(kind, pct);
    if (problem) throw ValidationFailedError.field('depositPct', problem);
    const docDate = dto.docDate ?? this.clock.today();

    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.PROFORMA, { date: docDate, branchCode: order.branchCode });
      const row = await tx.salProforma.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode: order.branchCode,
          customerId: order.customerId, customerCode: order.customerCode, customerName: order.customerName, attention: dto.attention?.trim() || order.contactName,
          agentCode: order.agentCode, agentName: order.agentName, salesOrderId: order.id, salesOrderNo: order.docNo,
          payBy: day(dto.payBy ?? addDays(docDate, 7)), currency: order.currency, requestKind: kind, depositPct: pct ? dec(pct) : null,
          orderSubtotal: order.subtotal.sub(order.discountTotal), orderTax: order.taxTotal, orderTotal: order.total, amount: depositAmount(kind, order.total, pct),
          note: dto.note?.trim() || 'Delivery is scheduled once the deposit is received.',
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
        },
      });
      await tx.sysDocLink.create({ data: { tenantId: ctx.tenantId, fromType: SAL_ENTITY.ORDER, fromId: order.id, fromNo: order.docNo, toType: SAL_ENTITY.PROFORMA, toId: row.id, toNo: docNo, linkType: SAL_LINK.REQUESTED } });
      await this.log(tx, ctx, row.id, docNo, 'created', `Created from ${order.docNo} by ${ctx.user.name}`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateProformaDto) {
    const p = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, p, 'edit');
    const kind = (dto.requestKind ?? p.requestKind) as PfRequestKind;
    const pct = kind === 'DEPOSIT_PCT' ? (dto.depositPct ?? p.depositPct?.toString() ?? null) : null;
    const problem = requestProblem(kind, pct);
    if (problem) throw ValidationFailedError.field('depositPct', problem);
    const docDate = dto.docDate ?? iso(p.docDate);
    if (dto.payBy && dto.payBy < docDate) throw ValidationFailedError.field('payBy', 'Pay by cannot be before the proforma date.');

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, p.id, dto.version, {
        docDate: day(docDate),
        ...(dto.payBy && { payBy: day(dto.payBy) }),
        ...(dto.attention !== undefined && { attention: dto.attention.trim() || null }),
        ...(dto.note !== undefined && { note: dto.note.trim() || null }),
        requestKind: kind,
        depositPct: pct ? dec(pct) : null,
        amount: depositAmount(kind, p.orderTotal, pct),
      }, 'DRAFT');
      await this.log(tx, ctx, p.id, p.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const p = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, p, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salProforma.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await tx.sysDocLink.deleteMany({ where: { tenantId: ctx.tenantId, toType: SAL_ENTITY.PROFORMA, toId: id } });
      await this.log(tx, ctx, id, p.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${p.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: p.docNo };
  }

  /** Release: the proforma is sent and, while unpaid, holds the order's delivery (rule 9). */
  async release(ctx: RequestContext, id: string, version: number) {
    const p = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, p, 'release');
    if (!p.payBy) throw ValidationFailedError.field('payBy', 'Set a pay-by date before releasing the proforma.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, p.id, version, { status: 'SENT', releasedAt: this.clock.now(), releasedByCode: ctx.user.code }, 'DRAFT');
      await this.log(tx, ctx, p.id, p.docNo, 'released', `Released by ${ctx.user.name} · ${requestLabel(p.requestKind as PfRequestKind, p.depositPct)}, ${toRmText(p.amount)} · delivery of ${p.salesOrderNo} waits for the payment`);
    });
    return this.query.detail(ctx, id);
  }

  async email(ctx: RequestContext, id: string) {
    const p = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, p, 'email', 'Release the proforma before emailing it.');
    const customer = await this.masterData.findCustomer(ctx.tenantId, p.customerCode);
    if (!customer?.email) throw new BusinessRuleError('NO_EMAIL', `${p.customerName} has no email address in Master Data.`);
    const agent = (await this.masterData.listUsers(ctx.tenantId)).find((u) => u.code === p.agentCode);
    await this.prisma.$transaction(async (tx) => {
      await this.mail.send(tx, ctx, {
        templateKey: 'PROFORMA', entityType: SAL_ENTITY.PROFORMA, entityId: p.id, docNo: p.docNo, to: customer.email!, agentEmail: agent?.email,
        vars: { 'contact.name': p.attention ?? customer.contactName ?? customer.name, 'document.number': p.docNo, 'document.total': toRmText(p.amount), 'document.due_date': mailDate(p.payBy) },
      });
      await this.log(tx, ctx, p.id, p.docNo, 'emailed', `Emailed to ${customer.email}`);
    });
    return { sentTo: customer.email };
  }

  /** Cancels a sent proforma that was not paid: the delivery hold is lifted. */
  async cancel(ctx: RequestContext, id: string, version: number) {
    const p = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, p, 'cancel', 'Only a sent proforma that is not paid can be cancelled.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, p.id, version, { status: 'CANCELLED' }, 'SENT');
      await this.log(tx, ctx, p.id, p.docNo, 'cancelled', `Cancelled by ${ctx.user.name} · ${p.salesOrderNo} no longer waits for this deposit`);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async statusOf(tenantId: string, p: SalProforma): Promise<PfStatus> {
    return (await this.deposits.withReceived(tenantId, [p]))[0]!.status;
  }

  private async requireAction(ctx: RequestContext, p: SalProforma, action: ProformaAction, message?: string) {
    const status = await this.statusOf(ctx.tenantId, p);
    if (!this.query.actions(ctx, p, status).includes(action)) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', message ?? (status === 'DRAFT' ? 'Only the billing team can change proformas.' : PF_LOCKED_MESSAGE));
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalProformaUpdateManyMutationInput, status: 'DRAFT' | 'SENT') {
    const result = await tx.salProforma.updateMany({ where: { id, tenantId: ctx.tenantId, version, status }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.PROFORMA, entityId: id, docNo, action, message, comment: null });
  }
}
