import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DemandService } from '../demand/demand.service';
import { OrdersService } from '../orders/orders.service';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY, PUR_ROLE } from '../shared/purchase.constants';
import type { CreateRequestDto, FromDemandDto, RejectRequestDto, RequestLineDto, RequestToPoDto, UpdateRequestDto } from './dto/request.dto';
import { groupLinesBySupplier, submitProblems, summarizeLines, type RequestAction } from './request.rules';
import { RequestsQuery, type RequestWithLines } from './requests.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Purchase request commands (FlowP1). Requests come from the demand list or from staff; Purchasing
 * rejects them or turns them into POs (here) or RFQs (step 6).
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: RequestsQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
    private readonly demand: DemandService,
    private readonly orders: OrdersService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async create(ctx: RequestContext, dto: CreateRequestDto, source: 'STAFF' | 'DEMAND' = 'STAFF') {
    const lines = await this.buildLines(ctx, dto.lines);
    const branchCode = this.branchOf(ctx, dto.branchCode);
    const estValue = lines.reduce((sum, l) => sum.add(l.estAmount), dec(0));

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.REQUEST);
      const request = await tx.purRequest.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(this.clock.today()),
          status: 'DRAFT',
          branchCode,
          requestedByCode: ctx.user.code,
          requestedByName: ctx.user.name,
          requesterTitle: ctx.user.jobTitle,
          department: dto.department?.trim() || ctx.user.department,
          neededBy: dto.neededBy ? day(dto.neededBy) : null,
          priority: dto.priority ?? 'NORMAL',
          source,
          reason: dto.reason?.trim() || null,
          summary: summarizeLines(lines.map((l) => ({ itemName: l.itemName, qty: l.qty }))),
          estValue,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: { create: lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
      });
      await this.log(tx, ctx, request.id, docNo, 'created', source === 'DEMAND' ? `Created from the demand list by ${ctx.user.name}` : `Created by ${ctx.user.name}`);
      return request.id;
    });
    return this.query.detail(ctx, id);
  }

  /** "Raise request for selected" on the Demand list: a draft the requester completes and submits. */
  async fromDemand(ctx: RequestContext, dto: FromDemandDto) {
    return this.create(ctx, { lines: dto.lines, priority: 'NORMAL' }, 'DEMAND');
  }

  async update(ctx: RequestContext, id: string, dto: UpdateRequestDto) {
    const request = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, request), 'edit', this.lockedMessage(request));
    const lines = dto.lines ? await this.buildLines(ctx, dto.lines) : null;
    const branchCode = dto.branchCode ? this.branchOf(ctx, dto.branchCode) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'DRAFT', {
        ...(dto.neededBy !== undefined && { neededBy: dto.neededBy ? day(dto.neededBy) : null }),
        ...(dto.priority && { priority: dto.priority }),
        ...(dto.reason !== undefined && { reason: dto.reason.trim() || null }),
        ...(dto.department !== undefined && { department: dto.department.trim() || null }),
        ...(branchCode && { branchCode }),
        ...(lines && {
          estValue: lines.reduce((sum, l) => sum.add(l.estAmount), dec(0)),
          summary: summarizeLines(lines.map((l) => ({ itemName: l.itemName, qty: l.qty }))),
        }),
      });
      if (lines) {
        await tx.purRequestLine.deleteMany({ where: { requestId: id } });
        await tx.purRequestLine.createMany({ data: lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, requestId: id, lineNo: i + 1 })) });
      }
      await this.log(tx, ctx, id, request.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const request = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, request), 'delete', 'Only your own draft requests can be deleted.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purRequest.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'DRAFT' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, request.docNo, 'deleted', `Draft deleted by ${ctx.user.name}. ${request.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: request.docNo };
  }

  /** Sends the request to Purchasing. Needed-by date and reason are required (FlowP1 step 2). */
  async submit(ctx: RequestContext, id: string, version: number) {
    const request = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, request), 'submit', this.lockedMessage(request));
    const problems = submitProblems({
      neededBy: request.neededBy?.toISOString().slice(0, 10) ?? null,
      reason: request.reason,
      lineCount: request.lines.length,
      today: this.clock.today(),
    });
    if (problems.length) throw new ValidationFailedError(problems, 'Complete the request before you submit it.');
    const buyers = (await this.masterData.listUsers(ctx.tenantId))
      .filter((u) => u.isActive && u.roles.includes(PUR_ROLE.BUYER) && u.branchCodes.includes(request.branchCode))
      .map((u) => u.name);

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, version, 'DRAFT', { status: 'SUBMITTED', submittedAt: this.clock.now() });
      await this.log(tx, ctx, id, request.docNo, 'submitted', ['Submitted to Purchasing', ...(buyers.length ? [`${buyers.join(', ')} notified`] : [])].join(' · '));
      await this.outbox.publish(tx, ctx, [{
        name: 'purchase.request.submitted',
        aggregateType: PUR_ENTITY.REQUEST,
        aggregateId: id,
        payload: {
          prqNo: request.docNo,
          branchCode: request.branchCode,
          neededBy: request.neededBy?.toISOString().slice(0, 10) ?? null,
          lines: request.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty) })),
        },
      }]);
    });
    return this.query.detail(ctx, id);
  }

  /** Purchasing says no. The reason is required and shown to the requester (FlowP1 step 4). */
  async reject(ctx: RequestContext, id: string, dto: RejectRequestDto) {
    const request = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, request), 'reject', this.lockedMessage(request));
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'SUBMITTED', {
        status: 'REJECTED',
        rejectReason: dto.reason.trim(),
        decidedAt: this.clock.now(),
        decidedByCode: ctx.user.code,
      });
      await this.log(tx, ctx, id, request.docNo, 'rejected', `Rejected by ${ctx.user.name}`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  /**
   * "Create PO directly" (FlowP1 step 6): one draft PO per supplier, with the request's items, quantities and
   * last price (or the supplier's contract price). The request becomes Converted and links to the POs.
   */
  async toPo(ctx: RequestContext, id: string, dto: RequestToPoDto) {
    const request = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, request), 'toPo', this.lockedMessage(request));

    // Every line exactly once.
    const chosen = new Map<number, string>();
    for (const group of dto.groups) for (const lineNo of group.lineNos) {
      if (chosen.has(lineNo)) throw ValidationFailedError.field('groups', `Line ${lineNo} is given to two suppliers.`);
      chosen.set(lineNo, group.supplierCode);
    }
    const { groups, missing } = groupLinesBySupplier(request.lines, (l) => chosen.get(l.lineNo) ?? null);
    if (missing.length) throw ValidationFailedError.field('groups', `Pick a supplier for line ${missing.join(', ')}.`);

    const warehouseCode = dto.warehouseCode ?? (await this.mainWarehouse(ctx, request.branchCode));
    const today = this.clock.today();
    const prepared: Awaited<ReturnType<OrdersService['prepareDraft']>>[] = [];
    for (const [supplierCode, lines] of groups) {
      const contracts = await this.masterData.listContractPrices(ctx.tenantId, { supplierCode, itemCodes: lines.map((l) => l.itemCode), onDate: today });
      prepared.push(
        await this.orders.prepareDraft(ctx, {
          supplierCode,
          warehouseCode,
          lines: lines.map((l) => ({
            itemCode: l.itemCode,
            qty: l.qty.toString(),
            unitPrice: contracts.find((c) => c.itemCode === l.itemCode)?.unitPrice ?? l.unitPrice.toString(),
          })),
          expectedDate: request.neededBy ? request.neededBy.toISOString().slice(0, 10) : undefined,
        }),
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, id, dto.version, 'SUBMITTED', { status: 'CONVERTED', decidedAt: this.clock.now(), decidedByCode: ctx.user.code });
      const orders: { id: string; docNo: string }[] = [];
      for (const p of prepared) {
        const order = await this.orders.insertDraft(tx, ctx, p, {
          sourceType: 'REQUEST',
          sourceNo: request.docNo,
          requestId: request.id,
          message: `Created from ${request.docNo} by ${ctx.user.name}`,
        });
        await this.orders.link(tx, ctx, { type: PUR_ENTITY.REQUEST, id: request.id, no: request.docNo }, order, DOC_LINK.CONVERTED);
        orders.push(order);
      }
      await this.log(tx, ctx, id, request.docNo, 'converted', `Converted to ${orders.map((o) => o.docNo).join(', ')}`);
      return orders;
    });
    return { orders: created, request: await this.query.detail(ctx, id) };
  }

  /** The first time a buyer opens a submitted request it shows in the activity ("Opened by Lim Mei Ying"). */
  async markOpened(ctx: RequestContext, id: string) {
    const request = await this.prisma.purRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true, docNo: true, requestedByCode: true, isMigrated: true } });
    if (request?.status !== 'SUBMITTED' || request.requestedByCode === ctx.user.code) return;
    if (!this.query.actions(ctx, request).includes('toPo')) return;
    const seen = await this.prisma.sysActivity.count({ where: { tenantId: ctx.tenantId, entityType: PUR_ENTITY.REQUEST, entityId: id, action: 'opened', userCode: ctx.user.code } });
    if (seen) return;
    await this.prisma.$transaction((tx) => this.log(tx, ctx, id, request.docNo, 'opened', `Opened by ${ctx.user.name}`));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private require(actions: RequestAction[], action: RequestAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(request: RequestWithLines): string {
    switch (request.status) {
      case 'SUBMITTED':
        return `${request.docNo} is with Purchasing and can no longer be changed.`;
      case 'CONVERTED':
        return `${request.docNo} has already been turned into an order.`;
      case 'REJECTED':
        return `${request.docNo} was rejected. Raise a new request if it is still needed.`;
      default:
        return request.isMigrated ? 'Migrated requests cannot be changed.' : 'Only the person who raised this draft can change it.';
    }
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, status: 'DRAFT' | 'SUBMITTED', data: Prisma.PurRequestUpdateManyMutationInput) {
    const result = await tx.purRequest.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment?: string) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.REQUEST, entityId: id, docNo, action, message, comment: comment ?? null });
  }

  private branchOf(ctx: RequestContext, branchCode?: string): string {
    const branch = branchCode ?? ctx.branchCode;
    if (!ctx.user.branchCodes.includes(branch)) throw ValidationFailedError.field('branchCode', `You do not work in branch ${branch}.`);
    return branch;
  }

  private async mainWarehouse(ctx: RequestContext, branchCode: string): Promise<string> {
    const warehouses = (await this.masterData.listWarehouses(ctx.tenantId, branchCode)).filter((w) => w.isActive);
    const main = warehouses.find((w) => w.code.endsWith('-MAIN')) ?? warehouses[0];
    if (!main) throw new BusinessRuleError('NO_WAREHOUSE', `Branch ${branchCode} has no warehouse to deliver to.`);
    return main.code;
  }

  /** Items must be active and purchasable; the line keeps the item snapshot and the last price paid. */
  private async buildLines(ctx: RequestContext, input: RequestLineDto[]) {
    const codes = [...new Set(input.map((l) => l.itemCode))];
    const [items, taxes, lastPrices, suppliers] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.demand.lastPrices(ctx.tenantId, codes),
      this.masterData.listSuppliers(ctx.tenantId),
    ]);
    const errors: FieldError[] = [];
    const lines = input.map((line, i) => {
      const item = items.find((it) => it.code === line.itemCode);
      if (!item) errors.push({ field: `lines[${i}].itemCode`, message: `Item ${line.itemCode} is not in Master Data.` });
      else if (!item.isPurchasable || item.status !== 'ACTIVE') {
        errors.push({ field: `lines[${i}].itemCode`, message: `${item.code} cannot be bought: it is not an active purchasable item in Master Data.` });
      }
      if (!dec(line.qty).gt(0)) errors.push({ field: `lines[${i}].qty`, message: 'Quantity must be more than 0.' });
      const tax = taxes.find((t) => t.code === item?.purchaseTaxCode);
      const price = dec(lastPrices.get(line.itemCode) ?? 0);
      const preferred = suppliers.find((s) => s.code === item?.preferredSupplierCode);
      return {
        itemId: item?.id ?? '',
        itemCode: line.itemCode,
        itemName: item?.name ?? line.itemCode,
        uomCode: item?.uomCode ?? '',
        taxCode: item?.purchaseTaxCode ?? '',
        taxRate: dec(tax?.rate ?? 0),
        unitPrice: price,
        qty: dec(line.qty),
        estAmount: roundMoney(dec(line.qty).mul(price)),
        preferredSupplierCode: preferred?.code ?? null,
        preferredSupplierName: preferred?.name ?? null,
      };
    });
    if (errors.length) throw new ValidationFailedError(errors);
    return lines;
  }
}
