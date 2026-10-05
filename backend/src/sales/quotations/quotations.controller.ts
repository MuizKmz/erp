import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreateQuotationDto, DiscountApprovalDto, LostDto, QuotationListQueryDto, QuotationVersionDto, TransferDto, UpdateQuotationDto } from './dto/quotation.dto';
import { QuotationsQuery } from './quotations.query';
import { QuotationsService } from './quotations.service';

/** S08 list, S09 quotation — /api/v1/sales/quotations */
@Controller('sales/quotations')
export class SalesQuotationsController {
  constructor(
    private readonly query: QuotationsQuery,
    private readonly quotations: QuotationsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: QuotationListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.QUOTATION_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateQuotationDto) {
    return this.quotations.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.QUOTATION_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotations.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.QUOTATION_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: QuotationVersionDto) {
    return this.quotations.remove(ctx, id, q.version);
  }

  @Post(':id/request-approval')
  @RequirePermission(P.QUOTATION_EDIT)
  requestApproval(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscountApprovalDto) {
    return this.quotations.requestApproval(ctx, id, dto);
  }

  @Post(':id/release')
  @RequirePermission(P.QUOTATION_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuotationVersionDto) {
    return this.quotations.release(ctx, id, dto.version);
  }

  @Post(':id/email')
  @RequirePermission(P.VIEW)
  email(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.email(ctx, id);
  }

  @Post(':id/revise')
  @RequirePermission(P.QUOTATION_EDIT)
  revise(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuotationVersionDto) {
    return this.quotations.revise(ctx, id, dto.version);
  }

  @Post(':id/lost')
  @RequirePermission(P.QUOTATION_EDIT)
  lost(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LostDto) {
    return this.quotations.markLost(ctx, id, dto);
  }

  @Post(':id/transfer')
  @RequirePermission(P.ORDER_EDIT)
  transfer(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) {
    return this.quotations.transferToOrder(ctx, id, dto);
  }
}
