import { Controller, Get } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CoreDashboardQuery } from './dashboard.query';

/** C01 · Core home — /api/v1/core/dashboard */
@Controller('core/dashboard')
export class CoreDashboardController {
  constructor(private readonly query: CoreDashboardQuery) {}

  @Get()
  @RequirePermission(P.VIEW)
  summary(@CurrentContext() ctx: RequestContext) {
    return this.query.summary(ctx);
  }
}
