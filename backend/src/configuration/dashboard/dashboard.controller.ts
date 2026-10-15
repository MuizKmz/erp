import { Controller, Get } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { ConfigDashboardQuery } from './dashboard.query';

/** A01 · Configuration home — /api/v1/config/dashboard */
@Controller('config/dashboard')
export class ConfigDashboardController {
  constructor(private readonly query: ConfigDashboardQuery) {}

  @Get()
  @RequirePermission(P.VIEW)
  summary(@CurrentContext() ctx: RequestContext) {
    return this.query.summary(ctx);
  }
}
