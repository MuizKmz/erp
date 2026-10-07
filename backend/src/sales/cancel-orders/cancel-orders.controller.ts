import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CancelOrdersQuery } from './cancel-orders.query';
import { CancelOrdersService } from './cancel-orders.service';
import { CancelListQueryDto, CancelVersionDto, CreateCancelDto, UpdateCancelDto } from './dto/cancel-order.dto';

/** S13 list and open balances, S14 cancel order balance — /api/v1/sales/cancel-orders */
@Controller('sales/cancel-orders')
export class SalesCancelOrdersController {
  constructor(
    private readonly query: CancelOrdersQuery,
    private readonly cancels: CancelOrdersService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: CancelListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('open-orders')
  @RequirePermission(P.VIEW)
  openOrders(@CurrentContext() ctx: RequestContext) {
    return this.query.openOrders(ctx);
  }

  @Get('order-lines/:orderId')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  orderLines(@CurrentContext() ctx: RequestContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.query.orderLines(ctx, orderId);
  }

  @Post()
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCancelDto) {
    return this.cancels.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCancelDto) {
    return this.cancels.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: CancelVersionDto) {
    return this.cancels.remove(ctx, id, dto.version);
  }

  @Post(':id/release')
  @RequirePermission(P.CANCEL_ORDER_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelVersionDto) {
    return this.cancels.release(ctx, id, dto.version);
  }
}
