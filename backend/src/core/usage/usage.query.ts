import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationFailedError } from '../../platform/http/errors';
import type { RequestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import type { UsageKind } from '../../platform/usage/record-usage.types';
import { KIND_LABEL, USAGE_PATHS, kindFromPath } from './usage.rules';

/** Where a Core record is used, from the record-usage check (Purchase and Sales answer; Core reads only mdm_). */
@Injectable()
export class CoreUsageQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RecordUsageRegistry,
  ) {}

  async usage(ctx: RequestContext, path: string, code: string) {
    const kind = kindFromPath(path);
    if (!kind) {
      throw ValidationFailedError.field('kind', `There is no record type "${path}". Use one of: ${Object.keys(USAGE_PATHS).join(', ')}.`);
    }
    const record = await this.find(ctx.tenantId, kind, code);
    if (!record) throw new NotFoundError(`${KIND_LABEL[kind]} ${code}`);
    const usage = await this.registry.check({ tenantId: ctx.tenantId, kind, code: record.code });
    return { record, ...usage };
  }

  private find(tenantId: string, kind: UsageKind, code: string): Promise<{ code: string; name: string } | null> {
    const select = { code: true, name: true } as const;
    const where = { tenantId_code: { tenantId, code } };
    switch (kind) {
      case 'ITEM':
        return this.prisma.mdmItem.findUnique({ where, select });
      case 'CUSTOMER':
        return this.prisma.mdmCustomer.findUnique({ where, select });
      case 'SUPPLIER':
        return this.prisma.mdmSupplier.findUnique({ where, select });
      case 'UOM':
        return this.prisma.mdmUom.findUnique({ where, select });
      case 'TAX_CODE': // one row per rate period: the newest names the code
        return this.prisma.mdmTaxCode.findFirst({ where: { tenantId, code }, select, orderBy: { validFrom: 'desc' } });
      case 'PRICE_LIST':
        return this.prisma.mdmPriceList.findUnique({ where, select });
      case 'WAREHOUSE':
        return this.prisma.mdmWarehouse.findUnique({ where, select });
    }
  }
}
