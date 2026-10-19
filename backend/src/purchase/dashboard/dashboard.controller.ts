import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { DashboardBoardsService, SaveBoardDto } from '../../platform/indicators/dashboard-boards.service';
import { PURCHASE_PERMISSIONS } from '../purchase.permissions';
import { DashboardService } from './dashboard.service';

/** P01 · Purchase home — /api/v1/purchase/dashboard: the KPI cards, and the person's charts (board). */
@Controller('purchase/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly boards: DashboardBoardsService,
  ) {}

  @Get()
  @RequirePermission(PURCHASE_PERMISSIONS.VIEW)
  get(@CurrentContext() ctx: RequestContext) {
    return this.dashboard.get(ctx);
  }

  @Get('board')
  @RequirePermission(PURCHASE_PERMISSIONS.VIEW)
  board(@CurrentContext() ctx: RequestContext) {
    return this.boards.view(ctx, 'purchase');
  }

  @Put('board')
  @RequirePermission(PURCHASE_PERMISSIONS.VIEW)
  saveBoard(@CurrentContext() ctx: RequestContext, @Body() dto: SaveBoardDto) {
    return this.boards.save(ctx, 'purchase', dto);
  }

  /** Back to the default charts. */
  @Delete('board')
  @RequirePermission(PURCHASE_PERMISSIONS.VIEW)
  resetBoard(@CurrentContext() ctx: RequestContext) {
    return this.boards.reset(ctx, 'purchase');
  }
}
