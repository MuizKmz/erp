import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { AddSupplierDto, AwardRfqDto, CloseRfqDto, CreateRfqDto, RecordReplyDto, RemindDto, RfqListQueryDto } from './dto/rfq.dto';
import { RfqsQuery } from './rfqs.query';
import { RfqsService } from './rfqs.service';

/** P07 list, P08 compare and award — /api/v1/purchase/rfqs */
@Controller('purchase/rfqs')
export class RfqsController {
  constructor(
    private readonly query: RfqsQuery,
    private readonly rfqs: RfqsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: RfqListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.RFQ_MANAGE)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateRfqDto) {
    return this.rfqs.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Post(':id/replies')
  @RequirePermission(P.RFQ_MANAGE)
  recordReply(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordReplyDto) {
    return this.rfqs.recordReply(ctx, id, dto);
  }

  @Post(':id/suppliers')
  @RequirePermission(P.RFQ_MANAGE)
  addSupplier(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddSupplierDto) {
    return this.rfqs.addSupplier(ctx, id, dto);
  }

  @Post(':id/remind')
  @RequirePermission(P.RFQ_MANAGE)
  remind(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemindDto) {
    return this.rfqs.remind(ctx, id, dto);
  }

  @Post(':id/award')
  @RequirePermission(P.RFQ_MANAGE)
  award(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AwardRfqDto) {
    return this.rfqs.award(ctx, id, dto);
  }

  @Post(':id/close')
  @RequirePermission(P.RFQ_MANAGE)
  close(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseRfqDto) {
    return this.rfqs.close(ctx, id, dto);
  }
}
