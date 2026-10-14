import { Injectable } from '@nestjs/common';
import type { MdmItem, Prisma } from '@prisma/client';
import { latestValidByKey } from '../../master-data/master-data.rules';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, pageArgs, statusFromKey, toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { classificationName } from '../shared/einvoice-classifications';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { ItemListQueryDto } from './dto/item.dto';
import { conversionText, ITEM_STATUSES, STATUS_LABEL, statusActions, TYPE_LABEL, type ItemAction, type ItemStatus, type ItemType } from './items.rules';

const qty = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(4));

/** C02 item list and C03 item (CLAUDE.md → Phase 3). Reads mdm_ tables; where an item is used comes from the record-usage check. */
@Injectable()
export class ItemsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: RequestContext, query: ItemListQueryDto) {
    const tenantId = ctx.tenantId;
    const q = query.q?.trim();
    const base: Prisma.MdmItemWhereInput = {
      tenantId,
      ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }, { barcode: { contains: q } }] }),
      ...(query.group && { itemGroup: query.group }),
      ...(query.type && { type: query.type }),
      ...(query.use === 'buy' && { isPurchasable: true }),
      ...(query.use === 'sell' && { isSellable: true }),
      ...(query.use === 'both' && { isPurchasable: true, isSellable: true }),
    };
    const status = statusFromKey(query.status, ITEM_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.mdmItem.findMany({ where, orderBy: { code: 'asc' }, ...pageArgs(query) }),
      this.prisma.mdmItem.count({ where }),
      this.prisma.mdmItem.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const codes = [...new Set(rows.map((r) => r.preferredSupplierCode).filter((c): c is string => !!c))];
    const suppliers = await this.prisma.mdmSupplier.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, name: true, shortName: true } });
    const supplier = new Map(suppliers.map((s) => [s.code, s]));
    const items = rows.map((r) => {
      const s = r.preferredSupplierCode ? supplier.get(r.preferredSupplierCode) : undefined;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        itemGroup: r.itemGroup,
        type: r.type,
        typeLabel: TYPE_LABEL[r.type as ItemType],
        baseUom: r.baseUom,
        isPurchasable: r.isPurchasable,
        isSellable: r.isSellable,
        isBuyToOrder: r.isBuyToOrder,
        barcode: r.barcode,
        preferredSupplier: s ? { code: s.code, name: s.shortName ?? s.name } : null,
        status: r.status,
        statusLabel: STATUS_LABEL[r.status as ItemStatus],
      };
    });
    return toListResponse(items, total, query, buildStatusCounts(grouped, ITEM_STATUSES));
  }

  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const item = await this.prisma.mdmItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundError('Item');
    const today = this.clock.todayDate();
    const [conversions, priceRows, contracts, usage, activity, baseUnit] = await Promise.all([
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: item.code }, orderBy: [{ fromUom: 'asc' }, { toUom: 'asc' }] }),
      this.prisma.mdmPriceListItem.findMany({ where: { tenantId, itemCode: item.code }, orderBy: { validFrom: 'asc' } }),
      this.prisma.mdmContractPrice.findMany({ where: { tenantId, itemCode: item.code }, orderBy: { validFrom: 'desc' } }),
      this.usage.check({ tenantId, kind: 'ITEM', code: item.code }),
      this.activity.listFor(tenantId, CORE_ENTITY.ITEM, item.id),
      this.prisma.mdmUom.findFirst({ where: { tenantId, code: item.baseUom }, select: { name: true } }),
    ]);
    const current = latestValidByKey(priceRows, (r) => `${r.priceListCode}|${r.uomCode}`, today);
    const supplierCodes = [...new Set([item.preferredSupplierCode, ...contracts.map((c) => c.supplierCode)].filter((c): c is string => !!c))];
    const [lists, suppliers] = await Promise.all([
      this.prisma.mdmPriceList.findMany({ where: { tenantId, code: { in: [...new Set(current.map((p) => p.priceListCode))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.mdmSupplier.findMany({ where: { tenantId, code: { in: supplierCodes } }, select: { id: true, code: true, name: true, shortName: true } }),
    ]);
    const list = new Map(lists.map((l) => [l.code, l]));
    const supplier = new Map(suppliers.map((s) => [s.code, s]));

    const canEdit = this.permissions.has(ctx.user.roles, P.ITEM_EDIT);
    const deactivate = deactivateRefusal(item.code, usage);
    const remove = deleteRefusal('ITEM', item.code, usage, [
      { label: 'price lists', count: priceRows.length },
      { label: 'contract prices', count: contracts.length },
    ]);
    const allowedActions: ItemAction[] = [];
    const refusals: Partial<Record<ItemAction, string>> = {};
    if (canEdit) {
      allowedActions.push('edit');
      for (const action of statusActions(item.status as ItemStatus)) {
        if (action !== 'activate' && deactivate) refusals[action] = deactivate;
        else allowedActions.push(action);
      }
      if (remove) refusals.delete = remove;
      else allowedActions.push('delete');
    }
    const preferred = item.preferredSupplierCode ? supplier.get(item.preferredSupplierCode) : undefined;

    return {
      ...this.fields(item, canEdit),
      baseUomName: baseUnit?.name ?? null,
      einvoiceClassificationName: classificationName(item.einvoiceClassification),
      preferredSupplier: preferred ? { id: preferred.id, code: preferred.code, name: preferred.name, shortName: preferred.shortName } : null,
      conversions: conversions.map((c) => ({ fromUom: c.fromUom, toUom: c.toUom, factor: c.factor.toString(), text: conversionText(c) })),
      prices: current
        .map((p) => ({
          priceListId: list.get(p.priceListCode)?.id ?? null,
          priceListCode: p.priceListCode,
          priceListName: list.get(p.priceListCode)?.name ?? p.priceListCode,
          uomCode: p.uomCode,
          unitPrice: p.unitPrice.toFixed(2),
          validFrom: p.validFrom.toISOString().slice(0, 10),
        }))
        .sort((a, b) => a.priceListName.localeCompare(b.priceListName) || a.uomCode.localeCompare(b.uomCode)),
      contractPrices: contracts.map((c) => {
        const s = supplier.get(c.supplierCode);
        return {
          supplierId: s?.id ?? null,
          supplierCode: c.supplierCode,
          supplierName: s?.shortName ?? s?.name ?? c.supplierCode,
          unitPrice: c.unitPrice.toFixed(4),
          validFrom: c.validFrom.toISOString().slice(0, 10),
          validTo: c.validTo ? c.validTo.toISOString().slice(0, 10) : null,
        };
      }),
      usage,
      activity,
      allowedActions,
      refusals,
      canSeeCost: canEdit,
    };
  }

  private fields(item: MdmItem, canSeeCost: boolean) {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      itemGroup: item.itemGroup,
      type: item.type,
      typeLabel: TYPE_LABEL[item.type as ItemType],
      baseUom: item.baseUom,
      barcode: item.barcode,
      einvoiceClassification: item.einvoiceClassification,
      isPurchasable: item.isPurchasable,
      isBuyToOrder: item.isBuyToOrder,
      purchaseUom: item.purchaseUom,
      purchaseTaxCode: item.purchaseTaxCode,
      preferredSupplierCode: item.preferredSupplierCode,
      reorderLevel: qty(item.reorderLevel),
      packSize: item.packSize.toFixed(4),
      isSellable: item.isSellable,
      salesUom: item.salesUom,
      salesTaxCode: item.salesTaxCode,
      // Standard cost gives the estimated margin, so only those who edit items see it here.
      standardCost: canSeeCost ? qty(item.standardCost) : null,
      status: item.status,
      statusLabel: STATUS_LABEL[item.status as ItemStatus],
      version: item.version,
    };
  }
}
