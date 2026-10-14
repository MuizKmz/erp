import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { ListQueryDto } from '../../platform/http/list-query.dto';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreatePriceListDto, PriceListVersionDto, UpdatePriceListDto } from './dto/price-list.dto';
import { PriceListsQuery } from './price-lists.query';
import { PriceListsService } from './price-lists.service';

/** C08 price lists, C09 price list — /api/v1/core/price-lists. Only the Master Data Admin changes them (decision 2). */
@Controller('core/price-lists')
export class CorePriceListsController {
  constructor(
    private readonly query: PriceListsQuery,
    private readonly priceLists: PriceListsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.PRICE_LIST_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreatePriceListDto) {
    return this.priceLists.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.PRICE_LIST_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceListDto) {
    return this.priceLists.update(ctx, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermission(P.PRICE_LIST_EDIT)
  deactivate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceListVersionDto) {
    return this.priceLists.setStatus(ctx, id, 'deactivate', dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.PRICE_LIST_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceListVersionDto) {
    return this.priceLists.setStatus(ctx, id, 'activate', dto.version);
  }

  @Delete(':id')
  @RequirePermission(P.PRICE_LIST_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: PriceListVersionDto) {
    return this.priceLists.remove(ctx, id, q.version);
  }
}
