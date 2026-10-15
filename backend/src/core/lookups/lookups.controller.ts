import { Controller, Get, Inject, Query } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { latestValidByKey } from '../../master-data/master-data.rules';
import { ClockService } from '../../platform/clock/clock.service';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { ID_TYPE_LABEL, ID_TYPES } from '../customers/customers.rules';
import { itemUnits } from '../price-lists/price-lists.rules';
import { EINVOICE_CLASSIFICATIONS } from '../shared/einvoice-classifications';
import { CURRENCIES } from '../suppliers/suppliers.rules';

/** What Core forms pick from — /api/v1/core/lookups. Only active entries; tax codes with the rate valid today. */
@Controller('core/lookups')
export class CoreLookupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  /** C02 filters and the C03 item form. */
  @Get('item-form')
  @RequirePermission(P.VIEW)
  async itemForm(@CurrentContext() ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const today = this.clock.todayDate();
    const [groups, uoms, taxes] = await Promise.all([
      this.prisma.mdmItemGroup.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true } }),
      this.prisma.mdmUom.findMany({ where: { tenantId, isActive: true }, orderBy: { code: 'asc' }, select: { code: true, name: true, decimals: true } }),
      this.prisma.mdmTaxCode.findMany({ where: { tenantId, isActive: true, validFrom: { lte: today } }, orderBy: [{ code: 'asc' }, { validFrom: 'asc' }] }),
    ]);
    return {
      itemGroups: groups.map((g) => g.name),
      uoms,
      taxCodes: latestValidByKey(taxes, (t) => t.code, today).map((t) => ({ code: t.code, name: t.name, type: t.type, rate: t.rate.toFixed(4) })),
      classifications: EINVOICE_CLASSIFICATIONS,
    };
  }

  /** C04 filters and the C05 customer form. Sales agents are the active users with the SALES_AGENT role. Branches and users come from Configuration. */
  @Get('customer-form')
  @RequirePermission(P.VIEW)
  async customerForm(@CurrentContext() ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [categories, areas, terms, branches, users, priceLists] = await Promise.all([
      this.prisma.mdmCustomerCategory.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true } }),
      this.prisma.mdmArea.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true } }),
      this.prisma.mdmCreditTerm.findMany({ where: { tenantId, isActive: true }, orderBy: { days: 'asc' }, select: { days: true, name: true } }),
      this.masterData.listBranches(tenantId),
      this.masterData.listUsers(tenantId),
      this.prisma.mdmPriceList.findMany({ where: { tenantId, isActive: true }, orderBy: { code: 'asc' }, select: { code: true, name: true } }),
    ]);
    return {
      categories: categories.map((c) => c.name),
      areas: areas.map((a) => a.name),
      creditTerms: terms,
      branches: branches.filter((b) => b.isActive).map(({ code, name }) => ({ code, name })),
      agents: users.filter((u) => u.isActive && u.roles.includes('SALES_AGENT')).map((u) => ({ code: u.code, name: u.name })),
      priceLists,
      idTypes: ID_TYPES.map((value) => ({ value, label: ID_TYPE_LABEL[value] })),
    };
  }

  /** The C07 supplier form: payment terms (the credit terms list), currencies and ID types. */
  @Get('supplier-form')
  @RequirePermission(P.VIEW)
  async supplierForm(@CurrentContext() ctx: RequestContext) {
    const terms = await this.prisma.mdmCreditTerm.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { days: 'asc' }, select: { days: true, name: true } });
    return { paymentTerms: terms, currencies: [...CURRENCIES], idTypes: ID_TYPES.map((value) => ({ value, label: ID_TYPE_LABEL[value] })) };
  }

  /** Active items that can be bought, matching code or name, for the contract-price picker. */
  @Get('purchasable-items')
  @RequirePermission(P.VIEW)
  async purchasableItems(@CurrentContext() ctx: RequestContext, @Query('q') q?: string) {
    const text = q?.trim();
    const rows = await this.prisma.mdmItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', isPurchasable: true, ...(text && { OR: [{ code: { contains: text } }, { name: { contains: text } }] }) },
      orderBy: { code: 'asc' },
      take: 20,
      select: { code: true, name: true, baseUom: true },
    });
    return { items: rows };
  }

  /** Active items Sales can sell, matching code or name, with the units they can be priced in (C09 price picker). */
  @Get('sellable-items')
  @RequirePermission(P.VIEW)
  async sellableItems(@CurrentContext() ctx: RequestContext, @Query('q') q?: string) {
    const tenantId = ctx.tenantId;
    const text = q?.trim();
    const rows = await this.prisma.mdmItem.findMany({
      where: { tenantId, status: 'ACTIVE', isSellable: true, ...(text && { OR: [{ code: { contains: text } }, { name: { contains: text } }] }) },
      orderBy: { code: 'asc' },
      take: 20,
      select: { code: true, name: true, baseUom: true },
    });
    const conversions = await this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: { in: rows.map((r) => r.code) } }, select: { itemCode: true, fromUom: true, toUom: true } });
    return { items: rows.map((r) => ({ ...r, units: itemUnits(r.baseUom, conversions.filter((c) => c.itemCode === r.code)) })) };
  }

  /** Active suppliers matching code or name, for the preferred-supplier picker. */
  @Get('suppliers')
  @RequirePermission(P.VIEW)
  async suppliers(@CurrentContext() ctx: RequestContext, @Query('q') q?: string) {
    const text = q?.trim();
    const rows = await this.prisma.mdmSupplier.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        ...(text && { OR: [{ code: { contains: text } }, { name: { contains: text } }, { shortName: { contains: text } }] }),
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: { code: true, name: true, shortName: true },
    });
    return { items: rows };
  }
}
