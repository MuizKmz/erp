import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateUomDto, UomVersionDto, UpdateUomDto } from './dto/uom.dto';
import { UomsQuery } from './uoms.query';
import { UomsService } from './uoms.service';

/** C11 units of measure and conversions — /api/v1/core/uoms. Units belong with items, so item editors manage them. */
@Controller('core/uoms')
export class CoreUomsController {
  constructor(
    private readonly query: UomsQuery,
    private readonly uoms: UomsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.list(ctx);
  }

  @Post()
  @RequirePermission(P.ITEM_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateUomDto) {
    return this.uoms.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.ITEM_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUomDto) {
    return this.uoms.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.ITEM_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: UomVersionDto) {
    return this.uoms.remove(ctx, id, q.version);
  }
}
