import { Controller, Get } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesDashboardService } from './dashboard.service';

/** S01 · Sales home — /api/v1/sales/dashboard */
@Controller('sales/dashboard')
export class SalesDashboardController {
  constructor(private readonly dashboard: SalesDashboardService) {}

  @Get()
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext) {
    return this.dashboard.get(ctx);
  }
}
