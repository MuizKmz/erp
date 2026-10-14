import { Injectable } from '@nestjs/common';
import type { MdmItem } from '@prisma/client';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { changeMessage, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import { EINVOICE_CLASSIFICATIONS } from '../shared/einvoice-classifications';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import {
  activationGaps,
  conversionErrors,
  ITEM_LABELS,
  itemAudit,
  itemSnapshot,
  STATUS_LABEL,
  statusActions,
  unitChoiceError,
  type Conversion,
  type ItemRecord,
  type ItemStatus,
} from './items.rules';
import { ItemsQuery } from './items.query';

type ItemInput = Omit<CreateItemDto, 'code'>;
type StatusAction = 'block' | 'activate' | 'discontinue';
const NEXT_STATUS: Record<StatusAction, ItemStatus> = { block: 'BLOCKED', activate: 'ACTIVE', discontinue: 'DISCONTINUED' };
const DONE_WORD: Record<StatusAction, string> = { block: 'blocked', activate: 'activated', discontinue: 'discontinued' };

const record = (row: MdmItem): ItemRecord => ({
  code: row.code,
  name: row.name,
  itemGroup: row.itemGroup,
  type: row.type,
  baseUom: row.baseUom,
  barcode: row.barcode,
  einvoiceClassification: row.einvoiceClassification,
  isPurchasable: row.isPurchasable,
  isBuyToOrder: row.isBuyToOrder,
  purchaseUom: row.purchaseUom,
  purchaseTaxCode: row.purchaseTaxCode,
  preferredSupplierCode: row.preferredSupplierCode,
  reorderLevel: row.reorderLevel,
  packSize: row.packSize,
  isSellable: row.isSellable,
  salesUom: row.salesUom,
  salesTaxCode: row.salesTaxCode,
  standardCost: row.standardCost,
  status: row.status,
});

/** Item commands (C03): create, update, block, activate, discontinue and delete. One transaction each, with activity and event. */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly query: ItemsQuery,
  ) {}

  async create(ctx: RequestContext, dto: CreateItemDto) {
    const tenantId = ctx.tenantId;
    const [taken, deleted, errors] = await Promise.all([
      this.prisma.mdmItem.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CORE_ENTITY.ITEM, docNo: dto.code, action: 'deleted' }, select: { id: true } }),
      this.check(ctx, dto, null),
    ]);
    if (taken) errors.unshift({ field: 'code', message: `${dto.code} is already the code of ${taken.name}.` });
    else if (deleted) errors.unshift({ field: 'code', message: `${dto.code} belonged to an item that was deleted. Codes are never used again.` });
    if (errors.length) throw new ValidationFailedError(errors);

    const data = this.data(dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmItem.create({ data: { tenantId, code: dto.code, ...data, status: 'ACTIVE', createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      if (dto.conversions.length) await tx.mdmUomConversion.createMany({ data: this.conversionRows(tenantId, row.code, dto.conversions) });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.ITEM,
        entityId: row.id,
        code: row.code,
        action: 'created',
        message: `Item ${row.code} created`,
        changes: diffRecord(null, itemAudit(record(row), dto.conversions), ITEM_LABELS),
        event: CORE_EVENT.ITEM_CREATED,
        snapshot: itemSnapshot(record(row), dto.conversions),
      });
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateItemDto) {
    const tenantId = ctx.tenantId;
    const before = await this.load(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const [beforeConversions, errors] = await Promise.all([
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: before.code } }),
      this.check(ctx, dto, before),
    ]);
    if (errors.length) throw new ValidationFailedError(errors);
    if (dto.baseUom !== before.baseUom) {
      const usage = await this.usage.check({ tenantId, kind: 'ITEM', code: before.code });
      if (usage.documents > 0) {
        throw new BusinessRuleError('BASE_UNIT_IN_USE', `${before.code} is used on ${usage.documents} document${usage.documents === 1 ? '' : 's'}, so its base unit cannot change.`);
      }
    }

    const data = this.data(dto);
    const after: ItemRecord = { ...record(before), ...data };
    const changes = diffRecord(itemAudit(record(before), beforeConversions), itemAudit(after, dto.conversions), ITEM_LABELS);
    if (!changes.length) return this.query.detail(ctx, id);

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmItem.updateMany({ where: { id, tenantId, version: dto.version }, data: { ...data, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      if (changes.some((c) => c.field === 'conversions')) {
        await tx.mdmUomConversion.deleteMany({ where: { tenantId, itemCode: before.code } });
        if (dto.conversions.length) await tx.mdmUomConversion.createMany({ data: this.conversionRows(tenantId, before.code, dto.conversions) });
      }
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.ITEM,
        entityId: id,
        code: before.code,
        action: 'updated',
        message: changeMessage(changes),
        changes,
        event: CORE_EVENT.ITEM_UPDATED,
        snapshot: itemSnapshot(after, dto.conversions),
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Block, activate or discontinue (rules 2, 4, 5). Block and discontinue wait while an open document uses the item. */
  async setStatus(ctx: RequestContext, id: string, action: StatusAction, version: number) {
    const tenantId = ctx.tenantId;
    const item = await this.load(ctx, id);
    if (item.version !== version) throw new StaleVersionError();
    const status = item.status as ItemStatus;
    if (!statusActions(status).includes(action)) {
      throw new BusinessRuleError('ITEM_STATUS', `${item.code} is ${STATUS_LABEL[status].toLowerCase()}, so it cannot be ${DONE_WORD[action]}.`);
    }
    if (action === 'activate') {
      const gaps = activationGaps({ ...item, purchaseTaxCode: item.purchaseTaxCode || null });
      if (gaps.length) throw new ValidationFailedError(gaps, `Fill these in before activating ${item.code}.`);
    } else {
      const refusal = deactivateRefusal(item.code, await this.usage.check({ tenantId, kind: 'ITEM', code: item.code }));
      if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    }
    const next = NEXT_STATUS[action];
    const conversions = await this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: item.code } });
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmItem.updateMany({ where: { id, tenantId, version }, data: { status: next, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.ITEM,
        entityId: id,
        code: item.code,
        action: DONE_WORD[action],
        message: `Item ${item.code} ${DONE_WORD[action]}`,
        changes: [{ field: 'status', label: 'Status', from: STATUS_LABEL[status], to: STATUS_LABEL[next] }],
        event: CORE_EVENT.ITEM_UPDATED,
        snapshot: itemSnapshot({ ...record(item), status: next }, conversions),
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Delete only while nothing uses the item: no document of any status, no price-list row, no contract price (rule 3). */
  async remove(ctx: RequestContext, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const item = await this.load(ctx, id);
    if (item.version !== version) throw new StaleVersionError();
    const [usage, prices, contracts, conversions] = await Promise.all([
      this.usage.check({ tenantId, kind: 'ITEM', code: item.code }),
      this.prisma.mdmPriceListItem.count({ where: { tenantId, itemCode: item.code } }),
      this.prisma.mdmContractPrice.count({ where: { tenantId, itemCode: item.code } }),
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: item.code } }),
    ]);
    const refusal = deleteRefusal('ITEM', item.code, usage, [
      { label: 'price lists', count: prices },
      { label: 'contract prices', count: contracts },
    ]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      await tx.mdmUomConversion.deleteMany({ where: { tenantId, itemCode: item.code } });
      const gone = await tx.mdmItem.deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.ITEM,
        entityId: id,
        code: item.code,
        action: 'deleted',
        message: `Item ${item.code} deleted (nothing used it)`,
        event: CORE_EVENT.ITEM_DELETED,
        snapshot: itemSnapshot(record(item), conversions),
      });
    });
    return { deleted: true, code: item.code };
  }

  private async load(ctx: RequestContext, id: string): Promise<MdmItem> {
    const item = await this.prisma.mdmItem.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!item) throw new NotFoundError('Item');
    return item;
  }

  /** The columns a save writes. "Same as base unit" is stored as no purchase or sales unit. */
  private data(dto: ItemInput) {
    const purchaseTaxCode = dto.purchaseTaxCode || dto.salesTaxCode || '';
    return {
      name: dto.name,
      itemGroup: dto.itemGroup,
      type: dto.type,
      baseUom: dto.baseUom,
      barcode: dto.barcode ?? null,
      einvoiceClassification: dto.einvoiceClassification ?? null,
      isPurchasable: dto.isPurchasable,
      isBuyToOrder: dto.isBuyToOrder,
      purchaseUom: dto.purchaseUom && dto.purchaseUom !== dto.baseUom ? dto.purchaseUom : null,
      // A sell-only item keeps its sales tax code here: the column cannot be empty and Purchase never uses it.
      purchaseTaxCode,
      preferredSupplierCode: dto.preferredSupplierCode ?? null,
      reorderLevel: dto.reorderLevel ? dec(dto.reorderLevel) : null,
      packSize: dec(dto.packSize),
      isSellable: dto.isSellable,
      salesUom: dto.salesUom && dto.salesUom !== dto.baseUom ? dto.salesUom : null,
      salesTaxCode: dto.salesTaxCode ?? null,
      standardCost: dto.standardCost ? dec(dto.standardCost) : null,
    };
  }

  private conversionRows(tenantId: string, itemCode: string, conversions: Conversion[]) {
    return conversions.map((c) => ({ tenantId, itemCode, fromUom: c.fromUom, toUom: c.toUom, factor: dec(c.factor) }));
  }

  /**
   * Field checks that need the database: picked values exist and are active, the barcode is free, conversions and
   * units fit together, and the item has what it needs to be active. A value the item already had may stay even if
   * its list entry was made inactive since.
   */
  private async check(ctx: RequestContext, dto: ItemInput, before: MdmItem | null): Promise<FieldError[]> {
    const tenantId = ctx.tenantId;
    const unitCodes = [...new Set([dto.baseUom, dto.purchaseUom, dto.salesUom, ...dto.conversions.flatMap((c) => [c.fromUom, c.toUom])].filter((c): c is string => !!c))];
    const taxCodes = [dto.purchaseTaxCode, dto.salesTaxCode].filter((c): c is string => !!c);
    const [group, units, taxes, supplier, barcodeOwner] = await Promise.all([
      this.prisma.mdmItemGroup.findFirst({ where: { tenantId, name: dto.itemGroup } }),
      this.prisma.mdmUom.findMany({ where: { tenantId, code: { in: unitCodes } } }),
      this.prisma.mdmTaxCode.findMany({ where: { tenantId, code: { in: taxCodes }, isActive: true }, select: { code: true } }),
      dto.preferredSupplierCode ? this.prisma.mdmSupplier.findUnique({ where: { tenantId_code: { tenantId, code: dto.preferredSupplierCode } } }) : null,
      dto.barcode ? this.prisma.mdmItem.findFirst({ where: { tenantId, barcode: dto.barcode, ...(before && { NOT: { id: before.id } }) }, select: { code: true } }) : null,
    ]);
    const kept = (field: 'itemGroup' | 'baseUom' | 'purchaseUom' | 'salesUom' | 'preferredSupplierCode', value: string | null | undefined) =>
      before !== null && value !== null && value !== undefined && before[field] === value;
    const unit = new Map(units.map((u) => [u.code, u]));
    const unitOk = (code: string) => {
      const u = unit.get(code);
      return Boolean(u && (u.isActive || (before && [before.baseUom, before.purchaseUom, before.salesUom].includes(code))));
    };
    const tax = new Set(taxes.map((t) => t.code));
    const errors: FieldError[] = [];

    if (!group || (!group.isActive && !kept('itemGroup', dto.itemGroup))) errors.push({ field: 'itemGroup', message: 'Pick the item group from the list.' });
    if (!unitOk(dto.baseUom)) errors.push({ field: 'baseUom', message: 'Pick the base unit from the list.' });
    if (dto.purchaseUom && !unitOk(dto.purchaseUom)) errors.push({ field: 'purchaseUom', message: 'Pick the purchase unit from the list.' });
    if (dto.salesUom && !unitOk(dto.salesUom)) errors.push({ field: 'salesUom', message: 'Pick the sales unit from the list.' });
    if (dto.purchaseTaxCode && !tax.has(dto.purchaseTaxCode)) errors.push({ field: 'purchaseTaxCode', message: 'Pick the purchase tax from the list.' });
    if (dto.salesTaxCode && !tax.has(dto.salesTaxCode)) errors.push({ field: 'salesTaxCode', message: 'Pick the sales tax from the list.' });
    if (!dto.isPurchasable && !dto.purchaseTaxCode && !dto.salesTaxCode) errors.push({ field: 'purchaseTaxCode', message: 'Pick a tax code.' });
    if (dto.preferredSupplierCode && (!supplier || (supplier.status !== 'ACTIVE' && !kept('preferredSupplierCode', dto.preferredSupplierCode)))) {
      errors.push({ field: 'preferredSupplierCode', message: 'Pick an active supplier.' });
    }
    if (dto.einvoiceClassification && !EINVOICE_CLASSIFICATIONS.some((c) => c.code === dto.einvoiceClassification)) {
      errors.push({ field: 'einvoiceClassification', message: 'Pick the classification from the LHDN list.' });
    }
    if (barcodeOwner) errors.push({ field: 'barcode', message: `Barcode ${dto.barcode} is already on ${barcodeOwner.code}.` });
    if (dto.isBuyToOrder && !dto.isPurchasable) errors.push({ field: 'isBuyToOrder', message: 'Buy to order only needs Can be bought.' });
    if (!dec(dto.packSize).gt(0)) errors.push({ field: 'packSize', message: 'Pack size must be more than 0.' });

    dto.conversions.forEach((c, i) => {
      const missing = [c.fromUom, c.toUom].find((code) => code && !unit.has(code));
      if (missing) errors.push({ field: `conversions[${i}]`, message: `Unit ${missing} is not in Master Data.` });
    });
    const decimals = new Map(units.map((u) => [u.code, u.decimals]));
    errors.push(...conversionErrors(dto.conversions, dto.baseUom, decimals).filter((e) => !errors.some((x) => x.field === e.field)));
    for (const [field, value, label] of [['purchaseUom', dto.purchaseUom, 'Purchase unit'], ['salesUom', dto.salesUom, 'Sales unit']] as const) {
      const message = unitChoiceError(value ?? null, dto.baseUom, dto.conversions, label);
      if (message && !errors.some((e) => e.field === field)) errors.push({ field, message });
    }
    for (const gap of activationGaps({ ...dto, purchaseTaxCode: dto.purchaseTaxCode ?? null, salesTaxCode: dto.salesTaxCode ?? null })) {
      if (!errors.some((e) => e.field === gap.field)) errors.push(gap);
    }
    return errors;
  }
}
