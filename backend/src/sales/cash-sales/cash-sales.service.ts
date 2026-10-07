import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort, type MdCustomer } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, ConfigurationError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { SalesDocumentLines } from '../shared/document-lines.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT } from '../shared/sales.constants';
import { cashSummary, changeDue, consolidatedDue, CS_LOCKED_MESSAGE, PAYMENT_LABELS, releaseProblems, type CashSaleAction, type PaymentMethod } from './cash-sale.rules';
import { CashSalesQuery, type CashSaleWithLines } from './cash-sales.query';
import type { CashSaleDto, UpdateCashSaleDto } from './dto/cash-sale.dto';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Cash sale commands (rule 10). The walk-in customer, tax included in the price, no credit check. One document records
 * the sale, the payment and the stock going out: releasing saves one event for Finance, Inventory and LHDN.
 */
@Injectable()
export class CashSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: CashSalesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly docs: SalesDocumentLines,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async create(ctx: RequestContext, dto: CashSaleDto) {
    const walkIn = await this.walkInCustomer(ctx);
    const branchCode = ctx.branchCode;
    const docDate = dto.docDate ?? this.clock.today();
    const built = await this.docs.buildLines(ctx, walkIn, branchCode, docDate, dto.lines ?? [], 'INCLUSIVE');
    const [warehouseCode, branches] = await Promise.all([this.docs.warehouseFor(ctx, branchCode), this.masterData.listBranches(ctx.tenantId)]);
    const branchName = branches.find((b) => b.code === branchCode)?.name.replace(/ branch$/i, '') ?? branchCode;
    const method = (dto.paymentMethod ?? 'CASH') as PaymentMethod;

    const { id } = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.CASH_SALE, { date: docDate, branchCode });
      const row = await tx.salCashSale.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode, counterName: `${branchName} showroom counter`,
          customerId: walkIn.id, customerCode: walkIn.code, customerName: walkIn.name, servedByCode: ctx.user.code, servedByName: ctx.user.name,
          buyerName: dto.buyerName?.trim() || null, buyerPhone: dto.buyerPhone?.trim() || null, buyerTin: dto.buyerTin?.trim() || null, ownEInvoice: dto.ownEInvoice ?? false,
          warehouseCode, taxMode: 'INCLUSIVE', paymentMethod: method, paymentRef: dto.paymentRef?.trim() || null,
          amountReceived: dec(dto.amountReceived ?? 0), summary: cashSummary(built.lines), ...built.totals,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map(({ isBuyToOrder: _b, unitCost: _c, listPrice: _l, ...l }, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await this.log(tx, ctx, row.id, docNo, 'created', `Started at the counter by ${ctx.user.name}`);
      return row;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateCashSaleDto) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'edit');
    const docDate = dto.docDate ?? c.docDate.toISOString().slice(0, 10);
    const walkIn = await this.walkInCustomer(ctx);
    const built = dto.lines ? await this.docs.buildLines(ctx, walkIn, c.branchCode, docDate, dto.lines, 'INCLUSIVE') : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, c.id, dto.version, {
        docDate: day(docDate),
        ...(dto.buyerName !== undefined && { buyerName: dto.buyerName.trim() || null }),
        ...(dto.buyerPhone !== undefined && { buyerPhone: dto.buyerPhone.trim() || null }),
        ...(dto.buyerTin !== undefined && { buyerTin: dto.buyerTin.trim() || null }),
        ...(dto.ownEInvoice !== undefined && { ownEInvoice: dto.ownEInvoice }),
        ...(dto.paymentMethod && { paymentMethod: dto.paymentMethod }),
        ...(dto.paymentRef !== undefined && { paymentRef: dto.paymentRef.trim() || null }),
        ...(dto.amountReceived !== undefined && { amountReceived: dec(dto.amountReceived) }),
        ...(built && { summary: cashSummary(built.lines), ...built.totals }),
      });
      if (built) {
        await tx.salCashSaleLine.deleteMany({ where: { cashSaleId: c.id } });
        await tx.salCashSaleLine.createMany({
          data: built.lines.map(({ isBuyToOrder: _b, unitCost: _c, listPrice: _l, ...l }, i) => ({ ...l, tenantId: ctx.tenantId, cashSaleId: c.id, lineNo: i + 1 })),
        });
      }
      await this.log(tx, ctx, c.id, c.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salCashSale.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, c.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${c.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: c.docNo };
  }

  /** "Take payment and release": balance 0, own e-Invoice details if asked, then one event for Finance, Inventory and LHDN. */
  async release(ctx: RequestContext, id: string, version: number) {
    const c = await this.query.load(ctx.tenantId, id);
    this.require(ctx, c, 'release');
    const method = c.paymentMethod as PaymentMethod;
    const problems = releaseProblems({ toPay: c.total, received: c.amountReceived, method, ownEInvoice: c.ownEInvoice, buyerName: c.buyerName, buyerTin: c.buyerTin, lineCount: c.lines.length });
    if (problems.length) throw new ValidationFailedError(problems, 'The sale cannot be released yet.');
    await this.docs.checkStillSellable(ctx, c.branchCode, c.lines.map((l) => l.itemCode));
    const change = changeDue(method, c.total, c.amountReceived);
    const now = this.clock.now();
    const docDate = c.docDate.toISOString().slice(0, 10);

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, c.id, version, { status: 'RELEASED', changeAmount: change, releasedAt: now, releasedByCode: ctx.user.code });
      const paid = `${PAYMENT_LABELS[method]} ${toRmText(c.amountReceived)}${change.gt(0) ? `, change ${toRmText(change)}` : ''}`;
      await this.log(tx, ctx, c.id, c.docNo, 'released', `Released by ${ctx.user.name} · ${paid} · stock out saved for Inventory · ${c.ownEInvoice ? 'own e-Invoice queued' : `in the consolidated e-Invoice due ${consolidatedDue(docDate)}`}`);
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.CASH_SALE_RELEASED, aggregateType: SAL_ENTITY.CASH_SALE, aggregateId: c.id,
        payload: {
          saleNo: c.docNo, docDate, branchCode: c.branchCode, warehouseCode: c.warehouseCode, customerCode: c.customerCode,
          payment: { method, reference: c.paymentRef, received: toMoney(c.amountReceived), change: toMoney(change), total: toMoney(c.total) },
          eInvoice: c.ownEInvoice ? { kind: 'OWN', buyerName: c.buyerName, buyerTin: c.buyerTin } : { kind: 'CONSOLIDATED', due: consolidatedDue(docDate) },
          totals: { beforeTax: toMoney(c.subtotal), tax: toMoney(c.taxTotal), rounding: toMoney(c.rounding), total: toMoney(c.total) },
          lines: c.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), unitPrice: l.unitPrice.toString(), taxCode: l.taxCode, amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async walkInCustomer(ctx: RequestContext): Promise<MdCustomer> {
    const walkIn = await this.masterData.findCustomer(ctx.tenantId, 'C-CASH');
    if (!walkIn?.isCash) throw new ConfigurationError('The walk-in customer C-CASH is missing in Master Data. Add it before selling at the counter.');
    return walkIn;
  }

  private require(ctx: RequestContext, c: CashSaleWithLines, action: CashSaleAction) {
    if (!this.query.actions(ctx, c).includes(action)) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', c.status === 'DRAFT' && !c.isMigrated ? 'Only counter staff can change cash sales.' : CS_LOCKED_MESSAGE);
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalCashSaleUpdateManyMutationInput) {
    const result = await tx.salCashSale.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.CASH_SALE, entityId: id, docNo, action, message, comment: null });
  }
}
