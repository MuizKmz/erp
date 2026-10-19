import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { DashboardBoardsService, SaveBoardDto } from '../../platform/indicators/dashboard-boards.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesDashboardService } from './dashboard.service';

/** S01 · Sales home — /api/v1/sales/dashboard: the KPI cards, and the person's charts (board). */
@Controller('sales/dashboard')
export class SalesDashboardController {
  constructor(
    private readonly dashboard: SalesDashboardService,
    private readonly boards: DashboardBoardsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext) {
    return this.dashboard.get(ctx);
  }

  @Get('board')
  @RequirePermission(P.VIEW)
  board(@CurrentContext() ctx: RequestContext) {
    return this.boards.view(ctx, 'sales');
  }

  @Put('board')
  @RequirePermission(P.VIEW)
  saveBoard(@CurrentContext() ctx: RequestContext, @Body() dto: SaveBoardDto) {
    return this.boards.save(ctx, 'sales', dto);
  }

  /** Back to the default charts. */
  @Delete('board')
  @RequirePermission(P.VIEW)
  resetBoard(@CurrentContext() ctx: RequestContext) {
    return this.boards.reset(ctx, 'sales');
  }
}
