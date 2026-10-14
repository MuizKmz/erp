import { Injectable } from '@nestjs/common';
import type { MdmUom } from '@prisma/client';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { conversionText } from '../items/items.rules';
import { deleteRefusal } from '../usage/usage.rules';
import { deactivateUnitError } from './uoms.rules';

/** How Core records use a unit: items (base, purchase or sales unit), conversions and the price lists that price in it. */
export interface UnitCoreUse {
  /** Active items that use the unit anywhere, codes sorted. */
  activeItems: string[];
  /** Items of any status that use it as their base, purchase or sales unit. */
  items: number;
  baseOf: number;
  conversions: number;
  prices: number;
}

/** C11 · Units of measure and conversions. */
@Injectable()
export class UomsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly permissions: PermissionRegistry,
  ) {}

  async list(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [units, items, conversions] = await Promise.all([
      this.prisma.mdmUom.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
      this.prisma.mdmItem.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, baseUom: true } }),
      this.prisma.mdmUomConversion.findMany({ where: { tenantId }, orderBy: [{ itemCode: 'asc' }, { fromUom: 'asc' }] }),
    ]);
    const item = new Map(items.map((i) => [i.code, i]));
    return {
      units: units.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        decimals: u.decimals,
        isActive: u.isActive,
        version: u.version,
        baseOf: items.filter((i) => i.baseUom === u.code).length,
        conversions: conversions.filter((c) => c.fromUom === u.code || c.toUom === u.code).length,
      })),
      conversions: conversions.map((c) => ({ itemId: item.get(c.itemCode)?.id ?? null, itemCode: c.itemCode, itemName: item.get(c.itemCode)?.name ?? '', text: conversionText(c) })),
      canEdit: this.permissions.has(ctx.user.roles, P.ITEM_EDIT),
    };
  }

  /** One unit for the edit dialog: where it is used, and whether it may be deleted or made inactive. */
  async detail(ctx: RequestContext, id: string) {
    const unit = await this.load(ctx, id);
    const [usage, core] = await Promise.all([this.usage.check({ tenantId: ctx.tenantId, kind: 'UOM', code: unit.code }), this.coreUse(ctx.tenantId, unit.code)]);
    const remove = deleteRefusal('UOM', unit.code, usage, [
      { label: 'items', count: core.items },
      { label: 'conversions', count: core.conversions },
      { label: 'price lists', count: core.prices },
    ]);
    const deactivate = unit.isActive ? deactivateUnitError(unit.code, core.activeItems) : null;
    const canEdit = this.permissions.has(ctx.user.roles, P.ITEM_EDIT);
    return {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      decimals: unit.decimals,
      isActive: unit.isActive,
      version: unit.version,
      usage,
      activeItems: core.activeItems,
      allowedActions: canEdit ? ['edit', ...(remove ? [] : ['delete'])] : [],
      refusals: { ...(remove && { delete: remove }), ...(deactivate && { deactivate }) },
    };
  }

  async load(ctx: RequestContext, id: string): Promise<MdmUom> {
    const unit = await this.prisma.mdmUom.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!unit) throw new NotFoundError('Unit of measure');
    return unit;
  }

  async coreUse(tenantId: string, code: string): Promise<UnitCoreUse> {
    const [items, conversions, prices] = await Promise.all([
      this.prisma.mdmItem.findMany({ where: { tenantId, OR: [{ baseUom: code }, { purchaseUom: code }, { salesUom: code }] }, select: { code: true, status: true, baseUom: true } }),
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, OR: [{ fromUom: code }, { toUom: code }] }, select: { itemCode: true } }),
      this.prisma.mdmPriceListItem.findMany({ where: { tenantId, uomCode: code }, select: { priceListCode: true }, distinct: ['priceListCode'] }).then((rows) => rows.length),
    ]);
    const converted = conversions.map((c) => c.itemCode);
    const activeConverted = converted.length
      ? (await this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: converted }, status: 'ACTIVE' }, select: { code: true } })).map((i) => i.code)
      : [];
    const activeItems = [...new Set([...items.filter((i) => i.status === 'ACTIVE').map((i) => i.code), ...activeConverted])].sort();
    return { activeItems, items: items.length, baseOf: items.filter((i) => i.baseUom === code).length, conversions: conversions.length, prices };
  }
}
