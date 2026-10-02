import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CreateReturnDto, CreditNoteDto, NewReturnQueryDto, ReplacementDto, ReturnListQueryDto, ReturnVersionDto, UpdateReturnDto } from './dto/return.dto';
import { ReturnsQuery } from './returns.query';
import { ReturnsService } from './returns.service';

/** P22 list and credit notes to chase, P23 purchase return — /api/v1/purchase/returns */
@Controller('purchase/returns')
export class ReturnsController {
  constructor(
    private readonly query: ReturnsQuery,
    private readonly returns: ReturnsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ReturnListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('overview')
  @RequirePermission(P.VIEW)
  overview(@CurrentContext() ctx: RequestContext) {
    return this.query.overview(ctx);
  }

  @Get('returnable-receipts')
  @RequirePermission(P.RETURN_EDIT)
  returnableReceipts(@CurrentContext() ctx: RequestContext) {
    return this.query.returnableReceipts(ctx);
  }

  /** A new return from a goods receipt, filled in with what can still go back (nothing is saved). */
  @Get('new')
  @RequirePermission(P.RETURN_EDIT)
  template(@CurrentContext() ctx: RequestContext, @Query() query: NewReturnQueryDto) {
    return this.query.template(ctx, query.grnId);
  }

  @Post()
  @RequirePermission(P.RETURN_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateReturnDto) {
    return this.returns.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.RETURN_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReturnDto) {
    return this.returns.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.RETURN_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: ReturnVersionDto) {
    return this.returns.remove(ctx, id, q.version);
  }

  @Post(':id/release')
  @RequirePermission(P.RETURN_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnVersionDto) {
    return this.returns.release(ctx, id, dto.version);
  }

  @Post(':id/remind')
  @RequirePermission(P.VIEW)
  remind(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.remind(ctx, id);
  }

  @Post(':id/credit-note')
  @RequirePermission(P.VIEW)
  creditNote(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditNoteDto) {
    return this.returns.creditNote(ctx, id, dto);
  }

  @Post(':id/replacement')
  @RequirePermission(P.VIEW)
  replacement(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacementDto) {
    return this.returns.replacement(ctx, id, dto);
  }
}
