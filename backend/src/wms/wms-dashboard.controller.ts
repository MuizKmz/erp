import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../platform/context/context.decorators';
import type { RequestContext } from '../platform/context/request-context';
import { DashboardBoardsService, SaveBoardDto } from '../platform/indicators/dashboard-boards.service';
import { WMS_PERMISSIONS as P } from './wms.permissions';
import { WmsQuery } from './wms.query';

/**
 * W00 · WMS home — /api/v1/wms/dashboard: the KPI cards, and the person's charts (board). Saving a board changes only
 * that person's layout in the ERP, as on the other homes. Nothing here reaches the WMS except reads.
 */
@Controller('wms/dashboard')
export class WmsDashboardController {
  constructor(
    private readonly query: WmsQuery,
    private readonly boards: DashboardBoardsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext) {
    return this.query.dashboard(ctx);
  }

  @Get('board')
  @RequirePermission(P.VIEW)
  board(@CurrentContext() ctx: RequestContext) {
    return this.boards.view(ctx, 'wms');
  }

  @Put('board')
  @RequirePermission(P.VIEW)
  saveBoard(@CurrentContext() ctx: RequestContext, @Body() dto: SaveBoardDto) {
    return this.boards.save(ctx, 'wms', dto);
  }

  /** Back to the default charts. */
  @Delete('board')
  @RequirePermission(P.VIEW)
  resetBoard(@CurrentContext() ctx: RequestContext) {
    return this.boards.reset(ctx, 'wms');
  }
}
