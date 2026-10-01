import { Controller, Get } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS } from '../purchase.permissions';
import { DashboardService } from './dashboard.service';

@Controller('purchase/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission(PURCHASE_PERMISSIONS.VIEW)
  get(@CurrentContext() ctx: RequestContext) {
    return this.dashboard.get(ctx);
  }
}
