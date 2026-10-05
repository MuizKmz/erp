import { Controller, Get } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SalesDashboardService } from '../dashboard/dashboard.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';

/** S02 Approvals inbox (step S3) and the top-bar badge — /api/v1/sales/approvals */
@Controller('sales/approvals')
@RequirePermission(P.VIEW)
export class SalesApprovalsController {
  constructor(private readonly dashboard: SalesDashboardService) {}

  /** The badge on every Sales screen: how many Sales approvals wait for the current user. */
  @Get('count')
  async count(@CurrentContext() ctx: RequestContext) {
    return { waitingForMe: (await this.dashboard.waitingForMe(ctx)).length };
  }
}
