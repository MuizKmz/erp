import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import {
  CreateRequestDto,
  FromDemandDto,
  RejectRequestDto,
  RequestListQueryDto,
  RequestToPoDto,
  RequestVersionDto,
  UpdateRequestDto,
} from './dto/request.dto';
import { RequestsQuery } from './requests.query';
import { RequestsService } from './requests.service';

/** P05 list, P06 request, P04 "Raise request for selected" — /api/v1/purchase/requests */
@Controller('purchase/requests')
export class RequestsController {
  constructor(
    private readonly query: RequestsQuery,
    private readonly requests: RequestsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: RequestListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.REQUEST_CREATE)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateRequestDto) {
    return this.requests.create(ctx, dto);
  }

  @Post('from-demand')
  @RequirePermission(P.REQUEST_CREATE)
  fromDemand(@CurrentContext() ctx: RequestContext, @Body() dto: FromDemandDto) {
    return this.requests.fromDemand(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  async get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.requests.markOpened(ctx, id);
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.REQUEST_CREATE)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequestDto) {
    return this.requests.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.REQUEST_CREATE)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: RequestVersionDto) {
    return this.requests.remove(ctx, id, q.version);
  }

  @Post(':id/submit')
  @RequirePermission(P.REQUEST_CREATE)
  submit(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestVersionDto) {
    return this.requests.submit(ctx, id, dto.version);
  }

  @Post(':id/reject')
  @RequirePermission(P.REQUEST_PROCESS)
  reject(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectRequestDto) {
    return this.requests.reject(ctx, id, dto);
  }

  @Post(':id/to-po')
  @RequirePermission(P.REQUEST_PROCESS)
  toPo(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestToPoDto) {
    return this.requests.toPo(ctx, id, dto);
  }
}
