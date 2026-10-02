import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CancelOrderListQueryDto, CancelOrderVersionDto, CreateCancelOrderDto, NewCancelOrderQueryDto, UpdateCancelOrderDto } from './dto/cancel-order.dto';
import { CancelOrdersQuery } from './cancel-orders.query';
import { CancelOrdersService } from './cancel-orders.service';

/** P12 list and orders with an open balance, P13 cancel PO balance — /api/v1/purchase/cancel-orders */
@Controller('purchase/cancel-orders')
export class CancelOrdersController {
  constructor(
    private readonly query: CancelOrdersQuery,
    private readonly cancelOrders: CancelOrdersService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: CancelOrderListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('open-balances')
  @RequirePermission(P.VIEW)
  openBalances(@CurrentContext() ctx: RequestContext) {
    return this.query.openBalances(ctx);
  }

  @Get('cancellable-orders')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  cancellableOrders(@CurrentContext() ctx: RequestContext) {
    return this.query.cancellableOrders(ctx);
  }

  /** A new cancellation for a PO, filled in with what is still open (nothing is saved). */
  @Get('new')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  template(@CurrentContext() ctx: RequestContext, @Query() query: NewCancelOrderQueryDto) {
    return this.query.template(ctx, query.poId);
  }

  @Post()
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCancelOrderDto) {
    return this.cancelOrders.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCancelOrderDto) {
    return this.cancelOrders.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.CANCEL_ORDER_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: CancelOrderVersionDto) {
    return this.cancelOrders.remove(ctx, id, q.version);
  }

  @Post(':id/release')
  @RequirePermission(P.CANCEL_ORDER_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderVersionDto) {
    return this.cancelOrders.release(ctx, id, dto.version);
  }
}
