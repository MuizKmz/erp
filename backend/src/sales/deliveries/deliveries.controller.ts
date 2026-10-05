import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { DeliveriesQuery } from './deliveries.query';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto, DeliveryApprovalDto, DeliveryListQueryDto, DeliveryVersionDto, UpdateDeliveryDto } from './dto/delivery.dto';

/** S15 waiting list and DO list, S16 confirm delivery — /api/v1/sales/deliveries */
@Controller('sales/deliveries')
export class SalesDeliveriesController {
  constructor(
    private readonly query: DeliveriesQuery,
    private readonly deliveries: DeliveriesService,
  ) {}

  @Get('overview')
  @RequirePermission(P.VIEW)
  overview(@CurrentContext() ctx: RequestContext) {
    return this.query.overview(ctx);
  }

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: DeliveryListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.DELIVERY_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateDeliveryDto) {
    return this.deliveries.create(ctx, dto.salesOrderId);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.DELIVERY_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryDto) {
    return this.deliveries.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.DELIVERY_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: DeliveryVersionDto) {
    return this.deliveries.remove(ctx, id, dto.version);
  }

  @Post(':id/request-approval')
  @RequirePermission(P.DELIVERY_EDIT)
  requestApproval(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryApprovalDto) {
    return this.deliveries.requestApproval(ctx, id, dto);
  }

  @Post(':id/confirm')
  @RequirePermission(P.DELIVERY_CONFIRM)
  confirm(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryVersionDto) {
    return this.deliveries.confirm(ctx, id, dto.version);
  }
}
