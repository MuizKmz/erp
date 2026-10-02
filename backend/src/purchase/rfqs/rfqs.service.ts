import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Env } from '../../config/env';
import { MASTER_DATA_PORT, type MasterDataPort, type MdSupplier } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DemandService } from '../demand/demand.service';
import { OrdersService } from '../orders/orders.service';
import { RequestsQuery } from '../requests/requests.query';
import { summarizeLines } from '../requests/request.rules';
import { DOC_LINK, PUR_DOC_TYPE, PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseMailService } from '../shared/purchase-mail.service';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { plainQty } from '../shared/text.rules';
import type { AddSupplierDto, AwardRfqDto, CloseRfqDto, CreateRfqDto, RecordReplyDto, RemindDto } from './dto/rfq.dto';
import { addDays, awardProblem, compareReplies, leadTimeText, statusAfterReply, supplierCountProblem, type RfqAction } from './rfq.rules';
import { RfqsQuery, type RfqFull } from './rfqs.query';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dateText = (d: Date | null) => {
  if (!d) return '';
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
};

/**
 * Request for quote commands (FlowP2): ask suppliers, record their replies, remind, award (draft PO) or
 * close without an order. Emails are logged, not sent.
 */
@Injectable()
export class RfqsService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly query: RfqsQuery,
    private readonly requests: RequestsQuery,
    private readonly orders: OrdersService,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly mail: PurchaseMailService,
    private readonly settings: PurchaseSettingsService,
    private readonly demand: DemandService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  // ── Create and send ───────────────────────────────────────────────────────

  /** FlowP2 step 1–2: the RFQ is numbered, sent to each supplier with its own reply link, and Waiting. */
  async create(ctx: RequestContext, dto: CreateRfqDto) {
    const today = this.clock.today();
    const request = dto.requestId ? await this.requests.load(ctx.tenantId, dto.requestId) : null;
    if (request && !this.requests.actions(ctx, request).includes('toRfq')) {
      throw new BusinessRuleError('ACTION_NOT_ALLOWED', `${request.docNo} is not waiting for Purchasing, so it cannot go to suppliers.`);
    }
    const input = dto.lines ?? request?.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty.toString() })) ?? [];
    const errors: FieldError[] = [];
    if (!input.length) errors.push({ field: 'lines', message: 'Add at least one item.' });
    if (dto.replyBy < today) errors.push({ field: 'replyBy', message: 'The reply-by date cannot be in the past.' });
    const neededBy = dto.neededBy ?? request?.neededBy?.toISOString().slice(0, 10) ?? null;
    if (neededBy && neededBy < dto.replyBy) errors.push({ field: 'neededBy', message: 'Needed by cannot be before the reply-by date.' });

    const codes = [...new Set(input.map((l) => l.itemCode))];
    const supplierCodes = [...new Set(dto.supplierCodes)];
    const [items, taxes, suppliers, lastPrices, settings] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listSuppliers(ctx.tenantId, supplierCodes),
      this.demand.lastPrices(ctx.tenantId, codes),
      this.settings.settings(ctx.tenantId),
    ]);

    const lines = input.map((line, i) => {
      const item = items.find((it) => it.code === line.itemCode);
      if (!item) errors.push({ field: `lines[${i}].itemCode`, message: `Item ${line.itemCode} is not in Master Data.` });
      else if (!item.isPurchasable || item.status !== 'ACTIVE') {
        errors.push({ field: `lines[${i}].itemCode`, message: `${item.code} cannot be bought: it is not an active purchasable item in Master Data.` });
      }
      if (!dec(line.qty).gt(0)) errors.push({ field: `lines[${i}].qty`, message: 'Quantity must be more than 0.' });
      return {
        itemId: item?.id ?? '',
        itemCode: line.itemCode,
        itemName: item?.name ?? line.itemCode,
        uomCode: item?.uomCode ?? '',
        taxCode: item?.purchaseTaxCode ?? '',
        taxRate: dec(taxes.find((t) => t.code === item?.purchaseTaxCode)?.rate ?? 0),
        qty: dec(line.qty),
      };
    });
    errors.push(...this.supplierProblems(supplierCodes, suppliers));
    const estimate = lines.reduce((sum, l) => sum.add(roundMoney(l.qty.mul(dec(lastPrices.get(l.itemCode) ?? 0)))), dec(0));
    const countProblem = supplierCountProblem({
      supplierCount: supplierCodes.length,
      estimatedValue: estimate,
      rfqRequiredOn: settings.rfqRequiredOn,
      rfqRequiredOver: settings.rfqRequiredOver,
      minSuppliers: settings.rfqMinReplies,
      limitText: toRmText(settings.rfqRequiredOver),
    });
    if (countProblem) errors.push({ field: 'supplierCodes', message: countProblem });
    if (errors.length) throw new ValidationFailedError(errors);

    const now = this.clock.now();
    const id = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.numbering.next(tx, ctx.tenantId, PUR_DOC_TYPE.RFQ);
      const rfq = await tx.purRfq.create({
        data: {
          tenantId: ctx.tenantId,
          docNo,
          docDate: day(today),
          status: 'WAITING',
          branchCode: request?.branchCode ?? ctx.branchCode,
          buyerCode: ctx.user.code,
          buyerName: ctx.user.name,
          requestId: request?.id ?? null,
          sourceNo: request?.docNo ?? null,
          summary: summarizeLines(lines.map((l) => ({ itemName: l.itemName, qty: l.qty }))),
          neededBy: neededBy ? day(neededBy) : null,
          replyBy: day(dto.replyBy),
          sentAt: now,
          remarks: dto.remarks?.trim() || null,
          createdBy: ctx.user.code,
          updatedBy: ctx.user.code,
          lines: { create: lines.map((l, i) => ({ ...l, tenantId: ctx.tenantId, lineNo: i + 1 })) },
        },
        include: { lines: true },
      });
      for (const code of supplierCodes) await this.askSupplier(tx, ctx, rfq, suppliers.find((s) => s.code === code)!, now);
      await this.log(tx, ctx, rfq.id, docNo, 'sent', `RFQ sent to ${supplierCodes.length} ${supplierCodes.length === 1 ? 'supplier' : 'suppliers'} by ${ctx.user.name}`);

      if (request) {
        const done = await tx.purRequest.updateMany({
          where: { id: request.id, tenantId: ctx.tenantId, version: request.version, status: 'SUBMITTED' },
          data: { status: 'CONVERTED', decidedAt: now, decidedByCode: ctx.user.code, version: { increment: 1 }, updatedBy: ctx.user.code },
        });
        if (done.count === 0) throw new StaleVersionError();
        await tx.sysDocLink.create({
          data: {
            tenantId: ctx.tenantId, fromType: PUR_ENTITY.REQUEST, fromId: request.id, fromNo: request.docNo,
            toType: PUR_ENTITY.RFQ, toId: rfq.id, toNo: docNo, linkType: DOC_LINK.CONVERTED,
          },
        });
        await this.activity.log(tx, ctx, { entityType: PUR_ENTITY.REQUEST, entityId: request.id, docNo: request.docNo, action: 'converted', message: `Converted to ${docNo}` });
      }
      return rfq.id;
    });
    return this.query.detail(ctx, id);
  }

  // ── Replies, reminders, more suppliers ────────────────────────────────────

  /** The buyer types in what the supplier sent. A reply can be corrected until the RFQ is awarded or closed. */
  async recordReply(ctx: RequestContext, id: string, dto: RecordReplyDto) {
    const rfq = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, rfq), 'recordReply', this.lockedMessage(rfq));
    const supplier = this.rfqSupplier(rfq, dto.supplierCode);

    const errors: FieldError[] = [];
    const prices = new Map<number, { unitPrice: string; minOrderQty?: string }>();
    if (!dto.declined) {
      for (const [i, l] of (dto.lines ?? []).entries()) {
        if (!rfq.lines.some((x) => x.lineNo === l.lineNo)) errors.push({ field: `lines[${i}].lineNo`, message: `Line ${l.lineNo} is not on ${rfq.docNo}.` });
        else if (!dec(l.unitPrice).gt(0)) errors.push({ field: `lines[${i}].unitPrice`, message: 'Unit price must be more than 0.' });
        else prices.set(l.lineNo, { unitPrice: l.unitPrice, minOrderQty: l.minOrderQty });
      }
      if (!prices.size) errors.push({ field: 'lines', message: 'Enter the price for at least one item, or mark the supplier as declined.' });
      if (dto.leadTimeDays === undefined) errors.push({ field: 'leadTimeDays', message: 'Enter the delivery time in days.' });
      if (dto.validUntil && dto.validUntil < this.clock.today()) errors.push({ field: 'validUntil', message: 'The quote has already expired.' });
    }
    if (errors.length) throw new ValidationFailedError(errors);

    const now = this.clock.now();
    const short = await this.shortName(ctx, supplier.supplierCode, supplier.supplierName);
    await this.prisma.$transaction(async (tx) => {
      await tx.purRfqReplyLine.deleteMany({ where: { rfqSupplierId: supplier.id } });
      await tx.purRfqSupplier.update({
        where: { id: supplier.id },
        data: dto.declined
          ? { status: 'DECLINED', repliedAt: now, leadTimeDays: null, paymentTermDays: null, validUntil: null, quoteRef: null, replyNote: dto.note?.trim() || null }
          : {
              status: 'REPLIED',
              repliedAt: now,
              leadTimeDays: dto.leadTimeDays ?? null,
              paymentTermDays: dto.paymentTermDays ?? null,
              validUntil: dto.validUntil ? day(dto.validUntil) : null,
              quoteRef: dto.quoteRef?.trim() || null,
              replyNote: dto.note?.trim() || null,
              replyLines: {
                create: [...prices].map(([lineNo, p]) => ({
                  tenantId: ctx.tenantId,
                  rfqLineId: rfq.lines.find((l) => l.lineNo === lineNo)!.id,
                  unitPrice: dec(p.unitPrice),
                  minOrderQty: p.minOrderQty ? dec(p.minOrderQty) : null,
                })),
              },
            },
      });
      if (dto.attachmentIds?.length) await this.attachments.attach(tx, ctx, dto.attachmentIds, PUR_ENTITY.RFQ_SUPPLIER, supplier.id);
      const statuses = rfq.suppliers.map((s) => ({ status: s.id === supplier.id ? (dto.declined ? 'DECLINED' : 'REPLIED') : s.status }) as const);
      await this.bump(tx, ctx, rfq.id, dto.version, { status: statusAfterReply(statuses) });

      const priceText =
        rfq.lines.length === 1 && prices.get(rfq.lines[0]!.lineNo)
          ? `RM ${toMoney(prices.get(rfq.lines[0]!.lineNo)!.unitPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${dec(rfq.lines[0]!.qty).gt(1) && rfq.lines[0]!.uomCode === 'PCS' ? ' each' : ''}`
          : `${prices.size} of ${rfq.lines.length} items priced`;
      const message = dto.declined
        ? `${short} declined to quote`
        : `${short} replied · ${priceText}${dto.leadTimeDays !== undefined ? `, ${leadTimeText(dto.leadTimeDays)}` : ''}`;
      await this.log(tx, ctx, rfq.id, rfq.docNo, dto.declined ? 'declined' : 'replied', `${message} (recorded by ${ctx.user.name})`, dto.note?.trim() || null);
    });
    return this.query.detail(ctx, id);
  }

  /** "Remind" for late suppliers: the RFQ email goes again with the same reply link. */
  async remind(ctx: RequestContext, id: string, dto: RemindDto) {
    const rfq = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, rfq), 'remind', this.lockedMessage(rfq));
    const targets = rfq.suppliers.filter((s) => s.status === 'ASKED' && (!dto.supplierCode || s.supplierCode === dto.supplierCode));
    if (!targets.length) throw new BusinessRuleError('NOTHING_TO_REMIND', dto.supplierCode ? `${dto.supplierCode} has already replied.` : 'Every supplier has replied.');
    const now = this.clock.now();
    const names: string[] = [];
    for (const s of targets) names.push(await this.shortName(ctx, s.supplierCode, s.supplierName));
    await this.prisma.$transaction(async (tx) => {
      for (const s of targets) {
        await tx.purRfqSupplier.update({ where: { id: s.id }, data: { remindedAt: now } });
        await this.sendRfqMail(tx, ctx, rfq, s);
      }
      await this.log(tx, ctx, rfq.id, rfq.docNo, 'reminded', `Reminder sent to ${names.join(', ')}`);
    });
    return this.query.detail(ctx, id);
  }

  /** "+ Ask another supplier" on the compare view. */
  async addSupplier(ctx: RequestContext, id: string, dto: AddSupplierDto) {
    const rfq = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, rfq), 'addSupplier', this.lockedMessage(rfq));
    if (rfq.suppliers.some((s) => s.supplierCode === dto.supplierCode)) {
      throw ValidationFailedError.field('supplierCode', `${dto.supplierCode} is already asked on ${rfq.docNo}.`);
    }
    const suppliers = await this.masterData.listSuppliers(ctx.tenantId, [dto.supplierCode]);
    const problems = this.supplierProblems([dto.supplierCode], suppliers);
    if (problems.length) throw new ValidationFailedError(problems.map((p) => ({ ...p, field: 'supplierCode' })));
    const supplier = suppliers[0]!;
    await this.prisma.$transaction(async (tx) => {
      await this.askSupplier(tx, ctx, rfq, supplier, this.clock.now());
      await this.bump(tx, ctx, rfq.id, dto.version, { status: 'WAITING' });
      await this.log(tx, ctx, rfq.id, rfq.docNo, 'asked', `${supplier.shortName ?? supplier.name} asked as well by ${ctx.user.name}`);
    });
    return this.query.detail(ctx, id);
  }

  // ── Award or close ────────────────────────────────────────────────────────

  /**
   * FlowP2 step 7–8: a draft PO for the winner with price, lead time, payment term and quote reference copied
   * from the reply; the others get "not this time"; the RFQ is Awarded and links to the PO.
   */
  async award(ctx: RequestContext, id: string, dto: AwardRfqDto) {
    const rfq = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, rfq), 'award', this.lockedMessage(rfq));
    const winner = this.rfqSupplier(rfq, dto.supplierCode);
    const lineNoById = new Map(rfq.lines.map((l) => [l.id, l.lineNo]));
    const replies = rfq.suppliers
      .filter((s) => s.status === 'REPLIED')
      .map((s) => ({ supplierCode: s.supplierCode, prices: new Map(s.replyLines.map((r) => [lineNoById.get(r.rfqLineId)!, r.unitPrice])), leadTimeDays: s.leadTimeDays }));
    const compare = compareReplies(rfq.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })), replies);
    const cheapestCode = compare.cheapest[0];
    const cheapest = rfq.suppliers.find((s) => s.supplierCode === cheapestCode);
    const winnerTotal = compare.totals.get(winner.supplierCode);
    const problem = awardProblem({
      supplierCode: winner.supplierCode,
      replied: winner.status === 'REPLIED',
      quotedAllLines: winnerTotal !== undefined,
      cheapest: compare.cheapest,
      reason: dto.reason,
      cheapestName: cheapest ? await this.shortName(ctx, cheapest.supplierCode, cheapest.supplierName) : undefined,
      saving: winnerTotal && cheapestCode ? toRmText(dec(winnerTotal).sub(dec(compare.totals.get(cheapestCode)!))) : undefined,
    });
    if (problem) throw new ValidationFailedError([problem]);

    const today = this.clock.today();
    const prices = replies.find((r) => r.supplierCode === winner.supplierCode)!.prices;
    const prepared = await this.orders.prepareDraft(ctx, {
      supplierCode: winner.supplierCode,
      warehouseCode: await this.mainWarehouse(ctx, rfq.branchCode),
      expectedDate: winner.leadTimeDays !== null ? addDays(today, winner.leadTimeDays) : undefined,
      supplierQuoteRef: winner.quoteRef ?? undefined,
      lines: rfq.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty.toString(), unitPrice: dec(prices.get(l.lineNo)!).toString() })),
    });
    const winnerName = await this.shortName(ctx, winner.supplierCode, winner.supplierName);
    const now = this.clock.now();

    const order = await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, rfq.id, dto.version, {
        status: 'AWARDED',
        awardedSupplierCode: winner.supplierCode,
        awardedSupplierName: winner.supplierName,
        awardReason: dto.reason?.trim() || null,
        awardedAt: now,
        awardedByCode: ctx.user.code,
      });
      await tx.purRfqSupplier.update({ where: { id: winner.id }, data: { isAwarded: true } });
      const created = await this.orders.insertDraft(tx, ctx, prepared, {
        sourceType: 'RFQ',
        sourceNo: rfq.docNo,
        rfqId: rfq.id,
        requestId: rfq.requestId ?? undefined,
        message: `Created from ${rfq.docNo} award by ${ctx.user.name}`,
      });
      // Payment term as quoted, when the supplier gave one.
      if (winner.paymentTermDays !== null) {
        await tx.purPurchaseOrder.update({ where: { id: created.id }, data: { paymentTermDays: winner.paymentTermDays } });
      }
      await this.orders.link(tx, ctx, { type: PUR_ENTITY.RFQ, id: rfq.id, no: rfq.docNo }, created, DOC_LINK.AWARDED);
      for (const s of rfq.suppliers.filter((x) => x.id !== winner.id)) await this.sendNotAwarded(tx, ctx, rfq, s);
      await this.log(tx, ctx, rfq.id, rfq.docNo, 'awarded', `Awarded to ${winnerName} · ${created.docNo} drafted`, dto.reason?.trim() || null);
      return created;
    });
    return { order, rfq: await this.query.detail(ctx, id) };
  }

  /** FlowP2 step 6 "No": closes without an order and tells every supplier. */
  async close(ctx: RequestContext, id: string, dto: CloseRfqDto) {
    const rfq = await this.query.load(ctx.tenantId, id);
    this.require(this.query.actions(ctx, rfq), 'close', this.lockedMessage(rfq));
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, ctx, rfq.id, dto.version, { status: 'CLOSED', closeReason: dto.reason.trim() });
      for (const s of rfq.suppliers) await this.sendNotAwarded(tx, ctx, rfq, s);
      await this.log(tx, ctx, rfq.id, rfq.docNo, 'closed', `Closed without order by ${ctx.user.name} · suppliers told`, dto.reason.trim());
    });
    return this.query.detail(ctx, id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private require(actions: RfqAction[], action: RfqAction, message: string) {
    if (!actions.includes(action)) throw new BusinessRuleError('ACTION_NOT_ALLOWED', message);
  }

  private lockedMessage(rfq: RfqFull): string {
    if (rfq.isMigrated) return 'Migrated RFQs cannot be changed.';
    if (rfq.status === 'AWARDED') return `${rfq.docNo} is already awarded.`;
    if (rfq.status === 'CLOSED') return `${rfq.docNo} is closed.`;
    return 'You cannot do this on this RFQ.';
  }

  private rfqSupplier(rfq: RfqFull, code: string) {
    const supplier = rfq.suppliers.find((s) => s.supplierCode === code);
    if (!supplier) throw ValidationFailedError.field('supplierCode', `${code} was not asked on ${rfq.docNo}.`);
    return supplier;
  }

  /** Rule 6: only active suppliers; walk-in "suppliers" are for cash purchases only. */
  private supplierProblems(codes: string[], found: MdSupplier[]): FieldError[] {
    return codes.flatMap((code, i) => {
      const s = found.find((x) => x.code === code);
      if (!s) return [{ field: `supplierCodes[${i}]`, message: `Supplier ${code} is not in Master Data.` }];
      if (s.status !== 'ACTIVE') return [{ field: `supplierCodes[${i}]`, message: `${s.name} is blocked in Master Data and cannot be asked.` }];
      if (s.isWalkIn) return [{ field: `supplierCodes[${i}]`, message: `${s.name} is for cash purchases and cannot be asked for a quote.` }];
      return [];
    });
  }

  private async askSupplier(tx: Tx, ctx: RequestContext, rfq: Pick<RfqFull, 'id' | 'docNo' | 'replyBy' | 'lines'>, supplier: MdSupplier, at: Date) {
    const row = await tx.purRfqSupplier.create({
      data: {
        tenantId: ctx.tenantId,
        rfqId: rfq.id,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.name,
        email: supplier.email,
        replyToken: randomUUID(),
        status: 'ASKED',
        askedAt: at,
      },
    });
    await this.sendRfqMail(tx, ctx, rfq, row, supplier.shortName ?? supplier.name);
  }

  private async sendRfqMail(
    tx: Tx,
    ctx: RequestContext,
    rfq: Pick<RfqFull, 'docNo' | 'replyBy' | 'lines'>,
    s: { email: string | null; supplierName: string; replyToken: string; rfqId: string },
    contact?: string,
  ) {
    if (!s.email) return;
    await this.mail.send(tx, ctx, {
      templateKey: 'RFQ_REQUEST',
      entityType: PUR_ENTITY.RFQ,
      entityId: s.rfqId,
      docNo: rfq.docNo,
      vars: {
        ...this.supplierVars(s, ctx, contact),
        'rfq.number': rfq.docNo,
        'rfq.reply_by': dateText(rfq.replyBy),
        'rfq.items': rfq.lines.map((l) => `- ${plainQty(l.qty)} ${l.uomCode} · ${l.itemName} (${l.itemCode})`).join('\n'),
        'rfq.reply_link': `${this.appUrl}/rfq-reply/${s.replyToken}`,
      },
    });
  }

  private async sendNotAwarded(tx: Tx, ctx: RequestContext, rfq: RfqFull, s: RfqFull['suppliers'][number]) {
    if (!s.email) return;
    await this.mail.send(tx, ctx, {
      templateKey: 'RFQ_NOT_AWARDED',
      entityType: PUR_ENTITY.RFQ,
      entityId: rfq.id,
      docNo: rfq.docNo,
      vars: { ...this.supplierVars(s, ctx), 'rfq.number': rfq.docNo },
    });
  }

  private supplierVars(s: { email: string | null; supplierName: string }, ctx: RequestContext, contact?: string) {
    return {
      'supplier.contact': contact ?? s.supplierName,
      'supplier.email': s.email ?? '',
      'buyer.name': ctx.user.name,
      'buyer.email': ctx.user.email,
    };
  }

  private async shortName(ctx: RequestContext, code: string, fallback: string) {
    return (await this.masterData.findSupplier(ctx.tenantId, code))?.shortName ?? fallback;
  }

  private async mainWarehouse(ctx: RequestContext, branchCode: string): Promise<string> {
    const warehouses = (await this.masterData.listWarehouses(ctx.tenantId, branchCode)).filter((w) => w.isActive);
    const main = warehouses.find((w) => w.code.endsWith('-MAIN')) ?? warehouses[0];
    if (!main) throw new BusinessRuleError('NO_WAREHOUSE', `Branch ${branchCode} has no warehouse to deliver to.`);
    return main.code;
  }

  private async bump(tx: Tx, ctx: RequestContext, id: string, version: number, data: Prisma.PurRfqUpdateManyMutationInput) {
    const result = await tx.purRfq.updateMany({
      where: { id, tenantId: ctx.tenantId, version, status: { in: ['WAITING', 'READY'] } },
      data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code },
    });
    if (result.count === 0) throw new StaleVersionError();
  }

  private log(tx: Tx, ctx: RequestContext, id: string, docNo: string, action: string, message: string, comment: string | null = null) {
    return this.activity.log(tx, ctx, { entityType: PUR_ENTITY.RFQ, entityId: id, docNo, action, message, comment });
  }
}
