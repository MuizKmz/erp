import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CreateOrderDto, OrderListQueryDto, SubmitOrderDto, UpdateOrderDto, VersionDto } from './dto/order.dto';
import { OrderFlowQuery } from './order-flow.query';
import { OrdersQuery } from './orders.query';
import { OrdersService } from './orders.service';

/** P09 list, P10 form, P11 approval check — /api/v1/purchase/orders */
@Controller('purchase/orders')
export class OrdersController {
  constructor(
    private readonly query: OrdersQuery,
    private readonly orders: OrdersService,
    private readonly clock: ClockService,
    private readonly flowQuery: OrderFlowQuery,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: OrderListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.ORDER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateOrderDto) {
    return this.orders.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.ORDER_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.ORDER_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: VersionDto) {
    return this.orders.remove(ctx, id, q.version);
  }

  /** P03 · Document flow */
  @Get(':id/flow')
  @RequirePermission(P.VIEW)
  flow(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.flowQuery.flow(ctx, id);
  }

  @Get(':id/approval-check')
  @RequirePermission(P.VIEW)
  approvalCheck(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.approvalCheck(ctx, id, this.clock.today());
  }

  @Post(':id/submit-for-approval')
  @RequirePermission(P.ORDER_EDIT)
  submit(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitOrderDto) {
    return this.orders.submitForApproval(ctx, id, dto);
  }

  @Post(':id/release')
  @RequirePermission(P.ORDER_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.orders.release(ctx, id, dto.version);
  }

  @Post(':id/email')
  @RequirePermission(P.VIEW)
  email(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.email(ctx, id);
  }
}
