import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort, type MdCustomer } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService, type DecisionResult } from '../../platform/approvals/approvals.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, ConfigurationError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { breachText, creditActivityText } from '../shared/credit.rules';
import { CreditService, type CreditOutcome } from '../shared/credit.service';
import { CREDIT_DOC, SAL_DOC_TYPE, SAL_ENTITY, SAL_EVENT, SAL_ROLE } from '../shared/sales.constants';
import { saleLineTotals, saleTotals } from '../shared/totals.rules';
import type { CreateOrderDto, OrderLineDto, RequestApprovalDto, UpdateOrderDto } from './dto/order.dto';
import { lineProblems, ORDER_LOCKED_MESSAGE, stockShortfall, type OrderAction } from './order.rules';
import { OrdersQuery, type OrderWithLines } from './orders.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Sales order commands (FlowS2). Every change runs in one transaction: the order, its activity, approval
 * requests and outbox events. The credit check runs on every save and again on release.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: OrdersQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly outbox: OutboxWriter,
    private readonly credit: CreditService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  // ── Create and save ───────────────────────────────────────────────────────

  async create(ctx: RequestContext, dto: CreateOrderDto) {
    const docDate = dto.docDate ?? this.clock.today();
    const customer = await this.activeCustomer(ctx, dto.customerCode);
    const branchCode = this.branchFor(ctx, customer);
    const built = await this.buildLines(ctx, customer, branchCode, docDate, dto.lines);
    const credit = await this.credit.check(ctx.tenantId, { customer, docType: CREDIT_DOC.SALES_ORDER, thisDocument: toMoney(built.totals.total), branchCode });
    const warehouseCode = await this.warehouseFor(ctx, branchCode);
    const agent = await this.agentFor(ctx, customer);

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.ORDER, { date: docDate, branchCode });
      const order = await tx.salSalesOrder.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: 'DRAFT', branchCode, orderTypeCode: dto.orderTypeCode ?? (built.anyBuyToOrder ? 'BTO' : 'STD'),
          customerId: customer.id, customerCode: customer.code, customerName: customer.name, contactName: dto.contactName?.trim() || customer.contactName,
          agentCode: agent.code, agentName: agent.name, warehouseCode, deliveryWantedBy: dto.deliveryWantedBy ? day(dto.deliveryWantedBy) : null,
          currency: 'MYR', taxMode: 'EXCLUSIVE', creditTermDays: customer.creditTermDays, priceListCode: customer.priceListCode,
          customerPoRef: dto.customerPoRef?.trim() || null, project: dto.project?.trim() || null,
          deliveryAddress: dto.deliveryAddress?.trim() || customer.deliveryAddress, remarks: dto.remarks?.trim() || null,
          ...built.totals, creditResult: credit.check.result, creditSnapshot: credit.snapshot,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          lines: { create: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await this.log(tx, ctx, order.id, docNo, 'created', `Created by ${ctx.user.name}`);
      await this.log(tx, ctx, order.id, docNo, 'credit_check', creditActivityText(credit.input, credit.check));
      return order.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateOrderDto) {
    const order = await this.query.load(ctx.tenantId, id);
    this.require(await this.actionsFor(ctx, order), 'edit', order.isMigrated ? 'Migrated orders cannot be changed.' : order.status === 'PENDING_APPROVAL' ? `${order.docNo} is waiting for approval and is locked.` : ORDER_LOCKED_MESSAGE);

    const docDate = dto.docDate ?? iso(order.docDate);
    const customer = await this.activeCustomer(ctx, dto.customerCode ?? order.customerCode);
    const customerChanged = customer.code !== order.customerCode;
    const branchCode = customerChanged ? this.branchFor(ctx, customer) : order.branchCode;
    const built = dto.lines ? await this.buildLines(ctx, customer, branchCode, docDate, dto.lines) : null;
    const total = built ? built.totals.total : order.total;
    const credit = await this.credit.check(ctx.tenantId, { customer, docType: CREDIT_DOC.SALES_ORDER, thisDocument: toMoney(total), branchCode, excludeOrderId: order.id });

    // Changing what was approved removes the approval: the order must be approved again.
    const clearApproval = Boolean(order.approvedAt) && (customerChanged || !total.eq(order.total));
    const creditChanged = credit.check.result !== order.creditResult || !total.eq(order.total);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SalSalesOrderUpdateManyMutationInput = {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.deliveryWantedBy !== undefined && { deliveryWantedBy: dto.deliveryWantedBy ? day(dto.deliveryWantedBy) : null }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName.trim() || null }),
        ...(dto.customerPoRef !== undefined && { customerPoRef: dto.customerPoRef.trim() || null }),
        ...(dto.project !== undefined && { project: dto.project.trim() || null }),
        ...(dto.deliveryAddress !== undefined && { deliveryAddress: dto.deliveryAddress.trim() || null }),
        ...(dto.orderTypeCode && { orderTypeCode: dto.orderTypeCode }),
        ...(dto.remarks !== undefined && { remarks: dto.remarks.trim() || null }),
        ...(customerChanged && {
          customerId: customer.id, customerCode: customer.code, customerName: customer.name, branchCode, creditTermDays: customer.creditTermDays,
          priceListCode: customer.priceListCode, warehouseCode: await this.warehouseFor(ctx, branchCode),
          ...(dto.contactName === undefined && { contactName: customer.contactName }),
          ...(dto.deliveryAddress === undefined && { deliveryAddress: customer.deliveryAddress }),
        }),
        ...(built && built.totals),
        creditResult: clearApproval || !order.approvedAt ? credit.check.result : order.creditResult,
        creditSnapshot: credit.snapshot,
        ...(clearApproval && { approvedAt: null, approvalRequired: false }),
      };
      await this.bump(tx, ctx, order.id, dto.version, data, 'DRAFT');
      if (built) {
        await tx.salSalesOrderLine.deleteMany({ where: { salesOrderId: order.id } });
        await tx.salSalesOrderLine.createMany({ data: built.lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, salesOrderId: order.id, lineNo: i + 1 })) });
      }
      await this.log(tx, ctx, order.id, order.docNo, 'saved', `Saved by ${ctx.user.name}`);
      if (creditChanged) await this.log(tx, ctx, order.id, order.docNo, 'credit_check', creditActivityText(credit.input, credit.check));
      if (clearApproval) await this.log(tx, ctx, order.id, order.docNo, 'approval_cleared', 'Approval cleared: the order changed after it was approved');
    });
    return this.query.detail(ctx, id);
  }

  /** Deletes a draft. Its number is not reused: the gap shows in the sequence. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const order = await this.query.load(ctx.tenantId, id);
    this.require(await this.actionsFor(ctx, order), 'delete', 'Only draft orders can be deleted.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salSalesOrder.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.approvals.cancelPending(tx, ctx, SAL_ENTITY.ORDER, id);
      await this.log(tx, ctx, id, order.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${order.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: order.docNo };
  }

  // ── Credit approval (S12) ─────────────────────────────────────────────────

  async requestApproval(ctx: RequestContext, id: string, dto: RequestApprovalDto) {
    const order = await this.query.load(ctx.tenantId, id);
    const credit = await this.query.liveCredit(ctx, order);
    const actions = this.query.actions(ctx, order, credit);
    if (credit && credit.check.action !== 'APPROVAL') {
      throw new BusinessRuleError('APPROVAL_NOT_NEEDED', credit.check.action === 'BLOCK'
        ? `The credit check blocks this order: ${breachText(credit.check)}. It cannot be approved; reduce the order or ask Finance.`
        : 'The credit check passed. Release the order directly.');
    }
    this.require(actions, 'requestApproval', order.status === 'PENDING_APPROVAL' ? `${order.docNo} is already waiting for approval.` : ORDER_LOCKED_MESSAGE);
    const step = await this.approverFor(ctx, credit!, order.branchCode);

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, order.id, dto.version, { status: 'PENDING_APPROVAL', approvalRequired: true, creditResult: 'OVER_LIMIT', creditSnapshot: credit!.snapshot }, 'DRAFT');
      await this.approvals.create(tx, ctx, {
        entityType: SAL_ENTITY.ORDER, entityId: order.id, docNo: order.docNo, amount: order.total,
        title: `${order.docNo} · ${order.customerName}`,
        reason: `${breachText(credit!.check)}${order.quotationNo ? ` · from quotation ${order.quotationNo}` : order.enquiryNo ? ` · from enquiry ${order.enquiryNo}` : ''}`,
        requesterNote: dto.reason, steps: [step],
      });
      await this.log(tx, ctx, order.id, order.docNo, 'approval_requested', `Sent for approval to ${step.approverName ?? step.approverRole}`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  /** Called by the approvals inbox after a decision on a sales order, inside its transaction. */
  async onApprovalDecision(tx: Tx, ctx: RequestContext, result: DecisionResult, comment: string | null) {
    const order = await tx.salSalesOrder.findFirstOrThrow({ where: { id: result.entityId, tenantId: ctx.tenantId } });
    if (result.outcome === 'NEXT_STEP') {
      await this.log(tx, ctx, order.id, order.docNo, 'approved_step', `Approved by ${ctx.user.name} · waiting for the next approver`, comment);
      return;
    }
    const approved = result.outcome === 'APPROVED';
    await tx.salSalesOrder.update({
      where: { id: order.id },
      data: {
        status: 'DRAFT', approvedAt: approved ? this.clock.now() : null, creditResult: approved ? 'APPROVED' : 'OVER_LIMIT',
        version: { increment: 1 }, updatedBy: ctx.user.code,
      },
    });
    await this.log(tx, ctx, order.id, order.docNo, approved ? 'approved' : 'rejected',
      approved ? `Approved by ${ctx.user.name} · ready to release` : `Rejected by ${ctx.user.name} · back to draft`, comment);
  }

  // ── Release (FlowS2 step 5) ───────────────────────────────────────────────

  async release(ctx: RequestContext, id: string, version: number) {
    const order = await this.query.load(ctx.tenantId, id);
    const customer = await this.activeCustomer(ctx, order.customerCode);
    const credit = await this.query.liveCredit(ctx, order);
    if (order.status === 'DRAFT' && credit && !order.approvedAt) {
      if (credit.check.action === 'BLOCK') throw new BusinessRuleError('CREDIT_BLOCKED', `${creditActivityText(credit.input, credit.check)}. The order cannot be released.`);
      if (credit.check.action === 'APPROVAL') throw new BusinessRuleError('CREDIT_APPROVAL_REQUIRED', `${creditActivityText(credit.input, credit.check)}. Type a reason and request approval.`);
    }
    this.require(this.query.actions(ctx, order, credit), 'release', order.status === 'PENDING_APPROVAL' ? `${order.docNo} is waiting for approval.` : `${order.docNo} is already released.`);
    await this.checkLinesStillSellable(ctx, order);

    // Stock only warns (policy "Stock check while entering: warn, never block").
    const items = await this.masterData.findItems(ctx.tenantId, order.lines.map((l) => l.itemCode));
    const stock = await this.stock.listStock(ctx.tenantId, order.lines.map((l) => l.itemCode));
    const shortfall = stockShortfall(order.lines.map((l) => ({
      itemCode: l.itemCode, qty: l.orderedQty, isStock: items.find((i) => i.code === l.itemCode)?.type === 'STOCK' && !l.isBuyToOrder,
      onHand: stock.filter((s) => s.itemCode === l.itemCode && s.warehouseCode === order.warehouseCode).reduce((sum, s) => sum.add(dec(s.onHand)), dec(0)),
    })));
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, order.id, version, {
        status: 'RELEASED', releasedAt: now, releasedByCode: ctx.user.code, releasedByName: ctx.user.name,
        ...(credit && !order.approvedAt && { creditResult: credit.check.result, creditSnapshot: credit.snapshot }),
      }, 'DRAFT');
      if (shortfall) await this.log(tx, ctx, order.id, order.docNo, 'stock_warning', `At release: ${shortfall}. Warned, not blocked (policy: stock check warns).`);
      const bto = order.lines.filter((l) => l.isBuyToOrder);
      await this.log(tx, ctx, order.id, order.docNo, 'released', `Released by ${ctx.user.name} · event sales.order.released saved${bto.length ? ' · Purchase drafts a PO for the buy-to-order lines' : ''}`);
      await this.outbox.publish(tx, ctx, [{
        name: SAL_EVENT.ORDER_RELEASED, aggregateType: SAL_ENTITY.ORDER, aggregateId: order.id,
        payload: {
          soNo: order.docNo, branchCode: order.branchCode, customerCode: customer.code, customerName: customer.name,
          deliveryWantedBy: order.deliveryWantedBy ? iso(order.deliveryWantedBy) : null, warehouseCode: order.warehouseCode,
          lines: order.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.orderedQty), isBuyToOrder: l.isBuyToOrder })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async activeCustomer(ctx: RequestContext, code: string): Promise<MdCustomer> {
    const customer = await this.masterData.findCustomer(ctx.tenantId, code);
    if (!customer) throw ValidationFailedError.field('customerCode', 'Pick the customer from Master Data.');
    if (customer.isCash) throw ValidationFailedError.field('customerCode', 'The walk-in customer is for cash sales only. Pick a customer account.');
    if (customer.status !== 'ACTIVE') {
      throw ValidationFailedError.field('customerCode', customer.status === 'PROSPECT'
        ? `${customer.name} is still a prospect. Add them to Master Data before taking an order.`
        : `${customer.name} is blocked in Master Data and cannot be used.`);
    }
    return customer;
  }

  /** The customer's branch when the user works there, else the branch the user is working in. */
  private branchFor(ctx: RequestContext, customer: MdCustomer): string {
    return ctx.user.branchCodes.includes(customer.branchCode) ? customer.branchCode : ctx.branchCode;
  }

  private async warehouseFor(ctx: RequestContext, branchCode: string): Promise<string> {
    const warehouses = await this.masterData.listWarehouses(ctx.tenantId, branchCode);
    const main = warehouses.find((w) => w.code.endsWith('-MAIN') && w.isActive) ?? warehouses.find((w) => w.isActive);
    if (!main) throw new ConfigurationError(`Branch ${branchCode} has no warehouse to deliver from. Add one in Master Data.`);
    return main.code;
  }

  /** The agent is the person saving when they are a sales agent, else the customer's default agent. */
  private async agentFor(ctx: RequestContext, customer: MdCustomer): Promise<{ code: string; name: string }> {
    if (ctx.user.roles.includes(SAL_ROLE.AGENT) || !customer.defaultAgentCode) return { code: ctx.user.code, name: ctx.user.name };
    const agent = (await this.masterData.listUsers(ctx.tenantId)).find((u) => u.code === customer.defaultAgentCode);
    return agent ? { code: agent.code, name: agent.name } : { code: ctx.user.code, name: ctx.user.name };
  }

  /** Lines from Master Data: sellable and active items not excluded in the branch, price list and tax copied now. */
  private async buildLines(ctx: RequestContext, customer: MdCustomer, branchCode: string, docDate: string, input: OrderLineDto[]) {
    const problems: FieldError[] = lineProblems(input.map((l, index) => ({ index, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? '0' })));
    const codes = [...new Set(input.map((l) => l.itemCode))];
    const [items, taxes, prices, excluded, setting] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listPrices(ctx.tenantId, { priceListCode: customer.priceListCode, itemCodes: codes, onDate: docDate }),
      this.excludedItems(ctx.tenantId, branchCode, codes, docDate),
      this.prisma.salSetting.findUnique({ where: { tenantId: ctx.tenantId } }),
    ]);
    const lines = input.map((l, index) => {
      const item = items.find((i) => i.code === l.itemCode);
      const field = `lines[${index}].itemCode`;
      if (!item) { problems.push({ field, message: 'Pick an item from Master Data.' }); return null; }
      if (item.status !== 'ACTIVE') { problems.push({ field, message: `${item.code} is ${item.status.toLowerCase()} in Master Data and cannot be sold.` }); return null; }
      if (!item.isSellable) { problems.push({ field, message: `${item.code} is not for sale in Master Data.` }); return null; }
      const ex = excluded.find((e) => e.itemCode === item.code);
      if (ex) { problems.push({ field, message: `${item.code} is excluded from sale in this branch (${ex.reason}).` }); return null; }
      const tax = taxes.find((t) => t.code === (item.salesTaxCode ?? item.purchaseTaxCode));
      if (!tax) { problems.push({ field, message: `${item.code} has no sales tax code in Master Data.` }); return null; }
      const totals = saleLineTotals({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? '0', taxRate: tax.rate });
      const list = prices.find((p) => p.itemCode === item.code);
      return {
        itemId: item.id, itemCode: item.code, itemName: item.name, uomCode: item.salesUomCode, taxCode: tax.code, taxRate: dec(tax.rate),
        listPrice: list ? dec(list.unitPrice) : null, unitPrice: dec(l.unitPrice), discountPct: dec(l.discountPct ?? '0'), orderedQty: dec(l.qty),
        grossAmount: totals.grossAmount, discountAmount: totals.discountAmount, amount: totals.amount, taxAmount: totals.taxAmount, isBuyToOrder: item.isBuyToOrder,
      };
    });
    if (problems.length) throw new ValidationFailedError(problems);
    const built = lines.filter((l): l is NonNullable<typeof l> => l !== null);
    const t = saleTotals(built, 'EXCLUSIVE', setting?.roundTo5Sen ?? true);
    return {
      lines: built,
      totals: { subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, rounding: t.rounding, total: t.total },
      anyBuyToOrder: built.some((l) => l.isBuyToOrder),
    };
  }

  private excludedItems(tenantId: string, branchCode: string, codes: string[], onDate: string) {
    const on = day(onDate);
    return this.prisma.salExcludedItem.findMany({
      where: { tenantId, branchCode, itemCode: { in: codes }, removedAt: null, fromDate: { lte: on }, OR: [{ untilDate: null }, { untilDate: { gte: on } }] },
    });
  }

  /** Release re-checks that nothing became unsellable since the order was saved. */
  private async checkLinesStillSellable(ctx: RequestContext, order: OrderWithLines) {
    const codes = order.lines.map((l) => l.itemCode);
    const [items, excluded] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.excludedItems(ctx.tenantId, order.branchCode, codes, this.clock.today()),
    ]);
    for (const l of order.lines) {
      const item = items.find((i) => i.code === l.itemCode);
      if (!item || item.status !== 'ACTIVE' || !item.isSellable) throw new BusinessRuleError('ITEM_NOT_SELLABLE', `${l.itemCode} can no longer be sold. Remove the line and save again.`);
      const ex = excluded.find((e) => e.itemCode === l.itemCode);
      if (ex) throw new BusinessRuleError('ITEM_EXCLUDED', `${l.itemCode} is now excluded from sale in this branch (${ex.reason}). Remove the line and save again.`);
    }
  }

  /** The named approver: someone holding the approver role in the order's branch, never the requester. */
  private async approverFor(ctx: RequestContext, credit: CreditOutcome, branchCode: string) {
    const role = credit.approverRole ?? SAL_ROLE.MANAGER;
    const candidates = (await this.masterData.listUsers(ctx.tenantId)).filter(
      (u) => u.isActive && u.roles.includes(role) && u.branchCodes.includes(branchCode) && u.code !== ctx.user.code,
    );
    const chosen = candidates[0];
    if (!chosen) throw new ConfigurationError(`Nobody holds the ${role.replace(/_/g, ' ').toLowerCase()} role in this branch to approve. Add one in Master Data.`);
    return { approverRole: role, approverCode: chosen.code, approverName: chosen.name };
  }

  private async actionsFor(ctx: RequestContext, order: OrderWithLines) {
    return this.query.actions(ctx, order, await this.query.liveCredit(ctx, order));
  }

  private require(actions: OrderAction[], action: OrderAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  /** Optimistic lock + status guard: refuses if someone else changed the order meanwhile. */
  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.SalSalesOrderUpdateManyMutationInput, status?: 'DRAFT') {
    const result = await tx.salSalesOrder.updateMany({
      where: { id, tenantId: ctx.tenantId, version, ...(status && { status }) },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment?: string | null) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.ORDER, entityId: id, docNo, action, message, comment: comment ?? null });
  }
}
