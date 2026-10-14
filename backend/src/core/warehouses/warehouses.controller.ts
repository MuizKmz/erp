import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateWarehouseDto, UpdateWarehouseDto, WarehouseVersionDto } from './dto/warehouse.dto';
import { WarehousesQuery } from './warehouses.query';
import { WarehousesService } from './warehouses.service';

/** C13 warehouses — /api/v1/core/warehouses. Locations come with the list, read only. */
@Controller('core/warehouses')
export class CoreWarehousesController {
  constructor(
    private readonly query: WarehousesQuery,
    private readonly warehouses: WarehousesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.list(ctx);
  }

  @Post()
  @RequirePermission(P.WAREHOUSE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.WAREHOUSE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehouses.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.WAREHOUSE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: WarehouseVersionDto) {
    return this.warehouses.remove(ctx, id, q.version);
  }
}
