import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateItemDto, ItemListQueryDto, ItemVersionDto, UpdateItemDto } from './dto/item.dto';
import { ItemsQuery } from './items.query';
import { ItemsService } from './items.service';

/** C02 item list, C03 item — /api/v1/core/items */
@Controller('core/items')
export class CoreItemsController {
  constructor(
    private readonly query: ItemsQuery,
    private readonly items: ItemsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ItemListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.ITEM_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateItemDto) {
    return this.items.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.ITEM_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(ctx, id, dto);
  }

  @Post(':id/block')
  @RequirePermission(P.ITEM_EDIT)
  block(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemVersionDto) {
    return this.items.setStatus(ctx, id, 'block', dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.ITEM_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemVersionDto) {
    return this.items.setStatus(ctx, id, 'activate', dto.version);
  }

  @Post(':id/discontinue')
  @RequirePermission(P.ITEM_EDIT)
  discontinue(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemVersionDto) {
    return this.items.setStatus(ctx, id, 'discontinue', dto.version);
  }

  @Delete(':id')
  @RequirePermission(P.ITEM_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: ItemVersionDto) {
    return this.items.remove(ctx, id, q.version);
  }
}
