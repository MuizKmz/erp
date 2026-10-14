import { Injectable } from '@nestjs/common';
import type { MdmPriceList, MdmPriceListItem } from '@prisma/client';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import type { Tx } from '../../platform/prisma/prisma.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import type { RecordPreview } from '../shared/record-preview';
import { deleteRefusal } from '../usage/usage.rules';
import type { CreatePriceListDto, UpdatePriceListDto } from './dto/price-list.dto';
import {
  auditLabels,
  deactivateRefusal,
  headerErrors,
  isHistory,
  itemUnits,
  priceItemErrors,
  priceListAudit,
  priceListMessage,
  priceListSnapshot,
  priceRowErrors,
  STATUS_LABEL,
  statusActions,
  statusOf,
  type PriceItem,
  type PriceListRecord,
  type PriceRow,
} from './price-lists.rules';
import { PriceListsQuery } from './price-lists.query';

const DONE_WORD = { deactivate: 'deactivated', activate: 'activated' } as const;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const record = (l: MdmPriceList): PriceListRecord => ({
  code: l.code,
  name: l.name,
  currency: l.currency,
  taxInclusive: l.taxInclusive,
  validFrom: isoDay(l.validFrom),
  validTo: l.validTo ? isoDay(l.validTo) : null,
  isActive: l.isActive,
});
const rowOf = (p: MdmPriceListItem): PriceRow => ({ itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: p.unitPrice, validFrom: isoDay(p.validFrom) });

/**
 * Price list commands (C09): create, update, deactivate, activate and delete. One transaction each, with activity and
 * an mdm.price_list.* event. Prices dated before today are history and never touched; the form saves the rest.
 */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly clock: ClockService,
    private readonly query: PriceListsQuery,
  ) {}

  /** The code is typed once (unique, never reused); the list may start inactive while it is prepared. */
  async create(ctx: RequestContext, dto: CreatePriceListDto) {
    const tenantId = ctx.tenantId;
    const [taken, deleted] = await Promise.all([
      this.prisma.mdmPriceList.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CORE_ENTITY.PRICE_LIST, docNo: dto.code, action: 'deleted' }, select: { id: true } }),
    ]);
    if (taken) throw ValidationFailedError.field('code', `${dto.code} is already the code of ${taken.name}.`);
    if (deleted) throw ValidationFailedError.field('code', `${dto.code} belonged to a price list that was deleted. Codes are never used again.`);
    const prices = this.rows(dto);
    const errors = await this.check(ctx, dto, null, prices, []);
    if (errors.length) throw new ValidationFailedError(errors);
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmPriceList.create({ data: { tenantId, code: dto.code, ...this.data(dto), isActive: dto.isActive, createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      await this.writePrices(tx, tenantId, row.code, prices);
      const audit = priceListAudit(record(row), prices);
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.PRICE_LIST,
        entityId: row.id,
        code: row.code,
        action: 'created',
        message: `Price list ${row.code} created`,
        changes: diffRecord(null, audit.values, auditLabels(audit)),
        event: CORE_EVENT.PRICE_LIST_UPDATED,
        snapshot: priceListSnapshot(record(row), prices),
        extra: { created: true },
      });
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  /** The list's fields and its prices from today on. Earlier prices stay exactly as they are (SRS BR-PRC-004). */
  async update(ctx: RequestContext, id: string, dto: UpdatePriceListDto) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const before = await this.query.load(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const beforePrices = (await this.query.prices(tenantId, before.code)).map(rowOf);
    const history = beforePrices.filter((p) => isHistory(p, today));
    const sent = this.rows(dto);
    const afterPrices = [...history, ...sent];
    const after: PriceListRecord = { ...record(before), ...this.dates(dto), name: dto.name, currency: dto.currency, taxInclusive: dto.taxInclusive };
    const preview = await this.preview(ctx, dto, before, beforePrices);
    const changes = preview.changes;
    if (!changes.length) return this.query.detail(ctx, id);
    if (preview.errors.length) throw new ValidationFailedError(preview.errors);

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmPriceList.updateMany({ where: { id, tenantId, version: dto.version }, data: { ...this.data(dto), version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      await tx.mdmPriceListItem.deleteMany({ where: { tenantId, priceListCode: before.code, validFrom: { gte: day(today) } } });
      await this.writePrices(tx, tenantId, before.code, sent);
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.PRICE_LIST,
        entityId: id,
        code: before.code,
        action: changes.every((c) => c.field.startsWith('price:')) ? 'prices_changed' : 'updated',
        message: priceListMessage(changes),
        changes,
        event: CORE_EVENT.PRICE_LIST_UPDATED,
        snapshot: priceListSnapshot(after, afterPrices),
      });
    });
    return this.query.detail(ctx, id);
  }

  /**
   * What saving the list would do, without saving: the changes (its fields and each price) and the field problems.
   * Update and the import's Check of price rows use it. History rows stay as they are.
   */
  async preview(ctx: RequestContext, dto: UpdatePriceListDto, before: MdmPriceList, beforePrices: PriceRow[]): Promise<RecordPreview> {
    const today = this.clock.today();
    const sent = this.rows(dto);
    const afterPrices = [...beforePrices.filter((p) => isHistory(p, today)), ...sent];
    const after: PriceListRecord = { ...record(before), ...this.dates(dto), name: dto.name, currency: dto.currency, taxInclusive: dto.taxInclusive };
    const beforeAudit = priceListAudit(record(before), beforePrices);
    const afterAudit = priceListAudit(after, afterPrices);
    const changes = diffRecord(beforeAudit.values, afterAudit.values, auditLabels(beforeAudit, afterAudit));
    if (!changes.length) return { changes, permission: null, errors: [] };
    return { changes, permission: null, errors: await this.check(ctx, dto, before, sent, beforePrices) };
  }

  /** Deactivate (refused while customers use the list, since Sales would find no prices for them) or activate. */
  async setStatus(ctx: RequestContext, id: string, action: 'deactivate' | 'activate', version: number) {
    const tenantId = ctx.tenantId;
    const l = await this.query.load(ctx, id);
    if (l.version !== version) throw new StaleVersionError();
    const status = statusOf(l.isActive);
    if (!statusActions(l.isActive).includes(action)) {
      throw new BusinessRuleError('PRICE_LIST_STATUS', `${l.code} is ${STATUS_LABEL[status].toLowerCase()}, so it cannot be ${DONE_WORD[action]}.`);
    }
    if (action === 'deactivate') {
      const refusal = deactivateRefusal(l.code, (await this.query.customers(tenantId, l.code)).map((c) => c.code));
      if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    }
    const isActive = action === 'activate';
    const prices = (await this.query.prices(tenantId, l.code)).map(rowOf);
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmPriceList.updateMany({ where: { id, tenantId, version }, data: { isActive, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.PRICE_LIST,
        entityId: id,
        code: l.code,
        action: DONE_WORD[action],
        message: `Price list ${l.code} ${DONE_WORD[action]}`,
        changes: [{ field: 'isActive', label: 'Status', from: STATUS_LABEL[status], to: STATUS_LABEL[statusOf(isActive)] }],
        event: CORE_EVENT.PRICE_LIST_UPDATED,
        snapshot: priceListSnapshot({ ...record(l), isActive }, prices),
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Delete only while no customer and no Sales document uses the list (rule 3). Its prices go with it. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const l = await this.query.load(ctx, id);
    if (l.version !== version) throw new StaleVersionError();
    const [usage, customers, prices] = await Promise.all([
      this.usage.check({ tenantId, kind: 'PRICE_LIST', code: l.code }),
      this.query.customers(tenantId, l.code),
      this.query.prices(tenantId, l.code),
    ]);
    const refusal = deleteRefusal('PRICE_LIST', l.code, usage, [{ label: 'customers', count: customers.length }]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      await tx.mdmPriceListItem.deleteMany({ where: { tenantId, priceListCode: l.code } });
      const gone = await tx.mdmPriceList.deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.PRICE_LIST,
        entityId: id,
        code: l.code,
        action: 'deleted',
        message: `Price list ${l.code} deleted (nothing used it)`,
        event: CORE_EVENT.PRICE_LIST_DELETED,
        snapshot: priceListSnapshot(record(l), prices.map(rowOf)),
      });
    });
    return { deleted: true, code: l.code };
  }

  private dates(dto: CreatePriceListDto | UpdatePriceListDto) {
    return { validFrom: dto.validFrom, validTo: dto.validTo ?? null };
  }

  private data(dto: CreatePriceListDto | UpdatePriceListDto) {
    return { name: dto.name, currency: dto.currency, taxInclusive: dto.taxInclusive, validFrom: day(dto.validFrom), validTo: dto.validTo ? day(dto.validTo) : null };
  }

  private rows(dto: CreatePriceListDto | UpdatePriceListDto): PriceRow[] {
    return dto.prices.map((p) => ({ itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: dec(p.unitPrice), validFrom: p.validFrom }));
  }

  private async writePrices(tx: Tx, tenantId: string, priceListCode: string, prices: PriceRow[]): Promise<void> {
    if (!prices.length) return;
    await tx.mdmPriceListItem.createMany({
      data: prices.map((p) => ({ tenantId, priceListCode, itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: dec(p.unitPrice), validFrom: day(p.validFrom) })),
    });
  }

  /**
   * The list's dates around all its prices, the tax setting fixed once prices have started, and each price sent: today
   * or later, inside the list, above 0, for an item Sales can sell in one of its units.
   */
  private async check(ctx: RequestContext, dto: CreatePriceListDto | UpdatePriceListDto, before: MdmPriceList | null, sent: PriceRow[], beforePrices: PriceRow[]): Promise<FieldError[]> {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const dates = this.dates(dto);
    const errors: FieldError[] = headerErrors({ ...dates, taxInclusive: dto.taxInclusive }, before && { taxInclusive: before.taxInclusive }, beforePrices, today);

    const itemCodes = [...new Set(sent.map((p) => p.itemCode))];
    const [items, conversions] = await Promise.all([
      this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: itemCodes } }, select: { code: true, status: true, isSellable: true, baseUom: true } }),
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: { in: itemCodes } }, select: { itemCode: true, fromUom: true, toUom: true } }),
    ]);
    const priceItems = new Map<string, PriceItem>(
      items.map((i) => [i.code, { status: i.status, isSellable: i.isSellable, units: itemUnits(i.baseUom, conversions.filter((c) => c.itemCode === i.code)) }]),
    );
    const rowErrors = [...priceItemErrors(sent, priceItems, new Set(beforePrices.map((p) => p.itemCode))), ...priceRowErrors(sent, dates, today)];
    for (const e of rowErrors) if (!errors.some((x) => x.field === e.field)) errors.push(e);
    return errors;
  }
}
