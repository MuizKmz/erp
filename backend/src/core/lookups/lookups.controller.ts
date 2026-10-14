import { Controller, Get, Query } from '@nestjs/common';
import { latestValidByKey } from '../../master-data/master-data.rules';
import { ClockService } from '../../platform/clock/clock.service';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { EINVOICE_CLASSIFICATIONS } from '../shared/einvoice-classifications';

/** What Core forms pick from — /api/v1/core/lookups. Only active entries; tax codes with the rate valid today. */
@Controller('core/lookups')
export class CoreLookupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
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
