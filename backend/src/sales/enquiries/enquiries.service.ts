import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toPrice, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { QuotationsService } from '../quotations/quotations.service';
import { SAL_DOC_TYPE, SAL_ENTITY, SAL_ROLE } from '../shared/sales.constants';
import type { CreateEnquiryDto, EnquiryItemDto, EnquiryLostDto, UpdateEnquiryDto } from './dto/enquiry.dto';
import { EnquiriesQuery, type EnquiryWithItems } from './enquiries.query';
import type { EnqAction } from './enquiry.rules';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Enquiry commands (FlowS1 steps 1–4): record, forward to the agent, turn into a quotation, or close as lost.
 * The customer comes from Master Data, or a new prospect is typed by name (it must be added to Master Data
 * before a quotation can be made).
 */
@Injectable()
export class EnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: EnquiriesQuery,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly quotations: QuotationsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async create(ctx: RequestContext, dto: CreateEnquiryDto) {
    const docDate = dto.docDate ?? this.clock.today();
    const party = await this.resolveParty(ctx, dto);
    await this.checkTypeAndSource(ctx, dto.enquiryTypeCode, dto.sourceCode);
    const agent = await this.resolveAgent(ctx, dto.agentCode, party.defaultAgentCode);
    const items = await this.buildItems(ctx, dto.items ?? []);
    const branchCode = dto.branchCode && ctx.user.branchCodes.includes(dto.branchCode) ? dto.branchCode : party.branchCode ?? ctx.branchCode;

    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, SAL_DOC_TYPE.ENQUIRY, { date: docDate, branchCode });
      const e = await tx.salEnquiry.create({
        data: {
          tenantId: ctx.tenantId, docNo, docDate: day(docDate), status: dto.forward ? 'FORWARDED' : 'NEW', branchCode,
          customerId: party.id, customerCode: party.code, customerName: party.name, isProspect: party.isProspect,
          contactName: dto.contactName?.trim() || party.contactName, phone: dto.phone?.trim() || party.phone, email: dto.email?.trim() || party.email,
          enquiryTypeCode: dto.enquiryTypeCode, sourceCode: dto.sourceCode, agentCode: agent.code, agentName: agent.name,
          budget: dto.budget ? dec(dto.budget) : null, neededBy: dto.neededBy ? day(dto.neededBy) : null, customerRef: dto.customerRef?.trim() || null,
          description: dto.description?.trim() || null, details: dto.details ?? undefined, forwardedAt: dto.forward ? this.clock.now() : null,
          createdBy: ctx.user.code, updatedBy: ctx.user.code,
          items: { create: items.map((i, n) => ({ ...i, tenantId: ctx.tenantId, lineNo: n + 1 })) },
        },
      });
      await this.log(tx, ctx, e.id, docNo, 'created', `Recorded by ${ctx.user.name}${party.isProspect ? ' · new prospect' : ''}`);
      if (dto.forward) await this.log(tx, ctx, e.id, docNo, 'forwarded', `Forwarded to ${agent.name}`);
      return e.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateEnquiryDto) {
    const e = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, e, 'edit', 'Quoted and lost enquiries cannot be changed.');
    if (dto.enquiryTypeCode || dto.sourceCode) await this.checkTypeAndSource(ctx, dto.enquiryTypeCode ?? e.enquiryTypeCode, dto.sourceCode ?? e.sourceCode);
    const agent = dto.agentCode && dto.agentCode !== e.agentCode ? await this.resolveAgent(ctx, dto.agentCode, null) : null;
    const items = dto.items ? await this.buildItems(ctx, dto.items) : null;
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SalEnquiryUpdateManyMutationInput = {
        ...(dto.docDate && { docDate: day(dto.docDate) }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName.trim() || null }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() || null }),
        ...(dto.email !== undefined && { email: dto.email.trim() || null }),
        ...(dto.enquiryTypeCode && { enquiryTypeCode: dto.enquiryTypeCode }),
        ...(dto.sourceCode && { sourceCode: dto.sourceCode }),
        ...(agent && { agentCode: agent.code, agentName: agent.name }),
        ...(dto.budget !== undefined && { budget: dto.budget ? dec(dto.budget) : null }),
        ...(dto.neededBy !== undefined && { neededBy: dto.neededBy ? day(dto.neededBy) : null }),
        ...(dto.customerRef !== undefined && { customerRef: dto.customerRef.trim() || null }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.details !== undefined && { details: dto.details }),
      };
      const result = await tx.salEnquiry.updateMany({ where: { id, tenantId: ctx.tenantId, version: dto.version }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (result.count === 0) throw new StaleVersionError();
      if (items) {
        await tx.salEnquiryItem.deleteMany({ where: { enquiryId: id } });
        await tx.salEnquiryItem.createMany({ data: items.map((i, n) => ({ ...i, tenantId: ctx.tenantId, enquiryId: id, lineNo: n + 1 })) });
      }
      await this.log(tx, ctx, id, e.docNo, 'saved', `Saved by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  async remove(ctx: RequestContext, id: string, version: number) {
    const e = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, e, 'delete', 'Only new enquiries without a quotation can be deleted.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.salEnquiry.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: 'NEW' } });
      if (deleted.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, e.docNo, 'deleted', `Deleted by ${ctx.user.name}. ${e.docNo} will not be used again.`);
    });
    return { deleted: true, docNo: e.docNo };
  }

  /** New → Forwarded: the agent is told (logged; emails come later). */
  async forward(ctx: RequestContext, id: string, version: number) {
    const e = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, e, 'forward', `${e.docNo} was already forwarded.`);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.salEnquiry.updateMany({
        where: { id, tenantId: ctx.tenantId, version, status: 'NEW' },
        data: { status: 'FORWARDED', forwardedAt: this.clock.now(), version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (result.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, e.docNo, 'forwarded', `Forwarded to ${e.agentName}`);
    });
    return this.query.detail(ctx, id);
  }

  /** Copies the customer and the items of interest into a new draft quotation, priced from the price list. */
  async createQuotation(ctx: RequestContext, id: string) {
    const e = await this.query.load(ctx.tenantId, id);
    if (e.isProspect && !e.customerCode) {
      throw new BusinessRuleError('PROSPECT', `${e.customerName} is a new prospect. Ask Admin to add the customer in Master Data before making a quotation.`);
    }
    await this.requireAction(ctx, e, 'createQuotation', e.status === 'QUOTED' ? `${e.docNo} is already quoted on ${e.quotationNo}.` : 'This enquiry cannot be quoted.');
    if (!e.items.length) throw new BusinessRuleError('NO_ITEMS', `${e.docNo} has no items of interest. Open a new quotation for ${e.customerName} and add the items there.`);
    const customer = (await this.masterData.findCustomer(ctx.tenantId, e.customerCode!))!;
    const prices = await this.masterData.listPrices(ctx.tenantId, { priceListCode: customer.priceListCode, itemCodes: e.items.map((i) => i.itemCode), onDate: this.clock.today() });
    const validUntil = new Date(Date.parse(`${this.clock.today()}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
    return this.quotations.create(ctx, {
      customerCode: e.customerCode!,
      enquiryId: e.id,
      validUntil,
      contactName: e.contactName ?? undefined,
      lines: e.items.map((i) => ({ itemCode: i.itemCode, qty: toQty(i.qty), unitPrice: toPrice(prices.find((p) => p.itemCode === i.itemCode)?.unitPrice ?? '0') })),
    });
  }

  async markLost(ctx: RequestContext, id: string, dto: EnquiryLostDto) {
    const e = await this.query.load(ctx.tenantId, id);
    await this.requireAction(ctx, e, 'markLost', 'Only open enquiries can be marked as lost.');
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.salEnquiry.updateMany({
        where: { id, tenantId: ctx.tenantId, version: dto.version },
        data: { status: 'LOST', lostReason: dto.reason.trim(), version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (result.count === 0) throw new StaleVersionError();
      await this.log(tx, ctx, id, e.docNo, 'lost', `Closed as lost by ${ctx.user.name}`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async resolveParty(ctx: RequestContext, dto: CreateEnquiryDto) {
    if (dto.isProspect) {
      const name = dto.prospectName?.trim();
      if (!name) throw ValidationFailedError.field('prospectName', 'Type the company or person asking.');
      return { id: null, code: null, name, isProspect: true, contactName: null, phone: null, email: null, branchCode: null as string | null, defaultAgentCode: null };
    }
    if (!dto.customerCode) throw ValidationFailedError.field('customerCode', 'Pick the customer from Master Data, or tick New prospect.');
    const c = await this.masterData.findCustomer(ctx.tenantId, dto.customerCode);
    if (!c || c.isCash) throw ValidationFailedError.field('customerCode', 'Pick the customer from Master Data.');
    if (c.status === 'BLOCKED') throw ValidationFailedError.field('customerCode', `${c.name} is blocked in Master Data and cannot be used.`);
    return { id: c.id, code: c.code, name: c.name, isProspect: c.status === 'PROSPECT', contactName: c.contactName, phone: c.phone, email: c.email, branchCode: c.branchCode, defaultAgentCode: c.defaultAgentCode };
  }

  private async resolveAgent(ctx: RequestContext, agentCode: string | undefined, defaultAgent: string | null) {
    const users = await this.masterData.listUsers(ctx.tenantId);
    const code = agentCode ?? defaultAgent ?? (ctx.user.roles.includes(SAL_ROLE.AGENT) ? ctx.user.code : null);
    const agent = users.find((u) => u.code === code && u.isActive && u.roles.includes(SAL_ROLE.AGENT));
    if (!agent) throw ValidationFailedError.field('agentCode', 'Pick the sales agent.');
    return { code: agent.code, name: agent.name };
  }

  private async checkTypeAndSource(ctx: RequestContext, typeCode: string, sourceCode: string) {
    const [type, source] = await Promise.all([
      this.prisma.salEnquiryType.findFirst({ where: { tenantId: ctx.tenantId, code: typeCode } }),
      this.prisma.salEnquirySource.findFirst({ where: { tenantId: ctx.tenantId, code: sourceCode } }),
    ]);
    const problems: FieldError[] = [];
    if (!type || !type.isActive) problems.push({ field: 'enquiryTypeCode', message: 'Pick an active enquiry type from Enquiry Types.' });
    if (!source || !source.isActive) problems.push({ field: 'sourceCode', message: 'Pick where the enquiry came from.' });
    if (problems.length) throw new ValidationFailedError(problems);
  }

  /** Items of interest are optional, but always from Master Data and sellable. */
  private async buildItems(ctx: RequestContext, input: EnquiryItemDto[]) {
    if (!input.length) return [];
    const items = await this.masterData.findItems(ctx.tenantId, input.map((i) => i.itemCode));
    const problems: FieldError[] = [];
    const rows = input.map((i, index) => {
      const item = items.find((x) => x.code === i.itemCode);
      if (!item || !item.isSellable || item.status !== 'ACTIVE') {
        problems.push({ field: `items[${index}].itemCode`, message: item ? `${item.code} is not for sale in Master Data.` : 'Pick an item from Master Data.' });
        return null;
      }
      if (!dec(i.qty).gt(0)) problems.push({ field: `items[${index}].qty`, message: 'Quantity must be more than 0.' });
      return { itemId: item.id, itemCode: item.code, itemName: item.name, uomCode: item.salesUomCode, qty: dec(i.qty), remarks: i.remarks?.trim() || null };
    });
    if (problems.length) throw new ValidationFailedError(problems);
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  }

  private async requireAction(ctx: RequestContext, e: EnquiryWithItems, action: EnqAction, message: string) {
    if (!(await this.query.actions(ctx, e)).includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment?: string | null) {
    return this.activity.log(tx, ctx, { entityType: SAL_ENTITY.ENQUIRY, entityId: id, docNo, action, message, comment: comment ?? null });
  }
}
