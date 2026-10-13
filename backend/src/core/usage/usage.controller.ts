import { Controller, Get, Param } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CoreUsageQuery } from './usage.query';

/**
 * Where a record is used — /api/v1/core/usage/:kind/:code, e.g. /core/usage/item/CH-DIN-01. Counts the Purchase
 * and Sales documents that use it and lists the open ones; the item, customer and supplier forms show it as *In use*.
 */
@Controller('core/usage')
export class CoreUsageController {
  constructor(private readonly query: CoreUsageQuery) {}

  @Get(':kind/:code')
  @RequirePermission(P.VIEW)
  usage(@CurrentContext() ctx: RequestContext, @Param('kind') kind: string, @Param('code') code: string) {
    return this.query.usage(ctx, kind, code);
  }
}
