import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { summarizeLines } from '../requests/request.rules';
import { PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CashLineDto, CreateCashPurchaseDto, UpdateCashPurchaseDto } from './dto/cash-purchase.dto';
import { CASH_PURCHASE_LIMIT, cashChecks, type CashPurchaseAction } from './cash-purchase.rules';
import { CashPurchasesQuery, type CashPurchaseWithLines } from './cash-purchases.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Cash purchase commands (FlowP7): staff record an urgent small buy with a receipt photo; the buyer checks and
 * releases it. Released = already paid and received: stock-in for Inventory, spend for Finance.
 */
@Injectable()
export class CashPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: CashPurchasesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async create(ctx: RequestContext, dto: CreateCashPurchaseDto) {
    const docDate = dto.docDate ?? this.clock.today();
    this.checkDate(docDate);
    const header = await this.header(ctx, dto.supplierCode, dto.paymentMethodCode);
    const built = await this.build(ctx, dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.CASH_PURCHASE);
      const row = await tx.purCashPurchase.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(docDate),
          status: 'DRAFT',
          ...header,
          boughtByCode: ctx.user.code,
          boughtByName: ctx.user.name,
          receiptNo: dto.receiptNo?.trim() || null,
          remarks: dto.remarks?.trim() || null,
          ...built.header,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId })) },
        },
      });
      await this.log(tx, ctx, row.id, docNo, 'created', `Created by ${ctx.user.name}`);
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, row.id, docNo, dto.attachmentIds);
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateCashPurchaseDto) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'edit', this.lockedMessage(row));
    if (dto.docDate) this.checkDate(dto.docDate);
    const header = dto.supplierCode || dto.paymentMethodCode ? await this.header(ctx, dto.supplierCode ?? row.supplierCode, dto.paymentMethodCode ?? row.paymentMethodCode) : null;
    const built = dto.lines ? await this.build(ctx, dto.lines) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.receiptNo !== undefined && { receiptNo: dto.receiptNo.trim() || null }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(header && { ...header, supplierId: header.supplierId }),
        ...(built && built.header),
      });
      if (built) {
        await tx.purCashPurchaseLine.deleteMany({ where: { cashPurchaseId: id } });
        await tx.purCashPurchaseLine.createMany({ data: built.lines.map((l) => ({ ...l, tenantId: ctx.tenantId, cashPurchaseId: id })) });
      }
      if (dto.attachmentIds?.length) await this.attachFiles(tx, ctx, id, row.docNo, dto.attachmentIds);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'delete', this.lockedMessage(row));
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purCashPurchase.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, row.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${row.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: row.docNo };
  }

  /** FlowP7 step 4. Rule 10: within RM 1,000.00 and a receipt photo; supplier active; card allowed for the branch. */
  async release(ctx: RequestContext, id: string, version: number) {
    const row = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, row), 'release', this.lockedMessage(row));
    const [supplier, method, photos] = await Promise.all([
      this.masterData.findSupplier(ctx.tenantId, row.supplierCode),
      this.prisma.purPaymentMethod.findFirst({ where: { tenantId: ctx.tenantId, code: row.paymentMethodCode } }),
      this.query.photoCount(ctx.tenantId, id),
    ]);
    const failed = cashChecks({
      total: row.total,
      hasPhoto: photos > 0,
      supplierActive: supplier?.status === 'ACTIVE',
      supplierName: row.supplierName,
      payment: method ? { label: method.label, active: method.isActive, branchCode: method.branchCode, holder: method.holder } : null,
      branchCode: row.branchCode,
    }).filter((c) => !c.ok);
    if (failed.length) throw new BusinessRuleError(failed[0]!.key === 'limit' ? 'OVER_CASH_LIMIT' : 'CHECK_FAILED', failed.map((c) => c.text).join('. ') + '.');

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, version, { status: 'RELEASED', releasedAt: this.clock.now(), releasedByCode: ctx.user.code });
      await this.log(tx, ctx, id, row.docNo, 'released', `Released by ${ctx.user.name} · ${toRmText(row.total)} paid by ${row.paidByLabel}`);
      await this.outbox.publish(tx, ctx, [{
        name: 'purchase.cash_purchase.released',
        aggregateType: PUR_ENTITY.CASH_PURCHASE,
        aggregateId: row.id,
        payload: {
          cpNo: row.docNo,
          supplierCode: row.supplierCode,
          branchCode: row.branchCode,
          paidBy: row.paidBy,
          paymentMethodCode: row.paymentMethodCode,
          receiptNo: row.receiptNo,
          total: toMoney(row.total),
          taxTotal: toMoney(row.taxTotal),
          warehouseCode: row.warehouseCode,
          lines: row.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), amount: toMoney(l.amount) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Supplier (walk-in shops allowed) and payment method of a branch the user works in. */
  private async header(ctx: RequestContext, supplierCode: string, paymentMethodCode: string) {
    const [supplier, method] = await Promise.all([
      this.masterData.findSupplier(ctx.tenantId, supplierCode),
      this.prisma.purPaymentMethod.findFirst({ where: { tenantId: ctx.tenantId, code: paymentMethodCode, isActive: true } }),
    ]);
    if (!supplier) throw ValidationFailedError.field('supplierCode', `Supplier ${supplierCode} is not in Master Data.`);
    if (supplier.status !== 'ACTIVE') throw ValidationFailedError.field('supplierCode', `${supplier.name} is blocked in Master Data.`);
    if (!method || !ctx.user.branchCodes.includes(method.branchCode)) {
      throw ValidationFailedError.field('paymentMethodCode', 'Pick a company card or petty cash of your branch.');
    }
    const warehouses = (await this.masterData.listWarehouses(ctx.tenantId, method.branchCode)).filter((w) => w.isActive);
    const warehouse = warehouses.find((w) => w.code.endsWith('-MAIN')) ?? warehouses[0];
    if (!warehouse) throw new BusinessRuleError('NO_WAREHOUSE', `Branch ${method.branchCode} has no warehouse to receive into.`);
    return {
      branchCode: method.branchCode,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      paymentMethodCode: method.code,
      paidBy: method.kind,
      paidByLabel: method.label,
      warehouseCode: warehouse.code,
    };
  }

  /** Items from Master Data with their tax; the total is checked against the limit when saving too. */
  private async build(ctx: RequestContext, input: CashLineDto[]) {
    const codes = [...new Set(input.map((l) => l.itemCode))];
    const [items, taxes] = await Promise.all([this.masterData.findItems(ctx.tenantId, codes), this.masterData.listTaxCodes(ctx.tenantId)]);
    const errors: FieldError[] = [];
    const lines = input.map((l, i) => {
      const item = items.find((it) => it.code === l.itemCode);
      if (!item) errors.push({ field: `lines[${i}].itemCode`, message: `Item ${l.itemCode} is not in Master Data.` });
      else if (!item.isPurchasable || item.status !== 'ACTIVE') errors.push({ field: `lines[${i}].itemCode`, message: `${item.code} cannot be bought: it is not an active purchasable item.` });
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
    if (totals.total.gt(dec(CASH_PURCHASE_LIMIT))) {
      throw ValidationFailedError.field('lines', `${toRmText(totals.total)} is over the ${toRmText(CASH_PURCHASE_LIMIT)} limit for a cash purchase. Raise a purchase order instead.`);
    }
    return {
      lines,
      header: {
        summary: summarizeLines(lines.map((l) => ({ itemName: l.itemName, qty: l.qty }))),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    };
  }

  private checkDate(docDate: string) {
    if (docDate > this.clock.today()) throw ValidationFailedError.field('docDate', 'The purchase date cannot be in the future.');
  }

  private async attachFiles(tx: Tx, ctx: RequestContext, id: string, docNo: string, ids: string[]) {
    await this.attachments.attach(tx, ctx, ids, PUR_ENTITY.CASH_PURCHASE, id);
    await this.log(tx, ctx, id, docNo, 'attached', `${ids.length === 1 ? 'Receipt photo' : `${ids.length} files`} added by ${ctx.user.name}`);
  }

  private require(actions: CashPurchaseAction[], action: CashPurchaseAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(row: CashPurchaseWithLines): string {
    if (row.isMigrated) return 'Migrated cash purchases cannot be changed.';
    if (row.status === 'RELEASED') return `${row.docNo} is released and locked.`;
    return 'Only the buyer can release a cash purchase.';
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurCashPurchaseUpdateManyMutationInput) {
    const result = await tx.purCashPurchase.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.CASH_PURCHASE, entityId: id, docNo, action, message });
  }
}
