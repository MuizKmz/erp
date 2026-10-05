import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreateEnquiryDto, EnquiryListQueryDto, EnquiryLostDto, EnquiryVersionDto, UpdateEnquiryDto } from './dto/enquiry.dto';
import { EnquiriesQuery } from './enquiries.query';
import { EnquiriesService } from './enquiries.service';

/** S06 list, S07 enquiry — /api/v1/sales/enquiries */
@Controller('sales/enquiries')
export class SalesEnquiriesController {
  constructor(
    private readonly query: EnquiriesQuery,
    private readonly enquiries: EnquiriesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: EnquiryListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.ENQUIRY_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateEnquiryDto) {
    return this.enquiries.create(ctx, dto);
  }

  /** The "From Master Data" card while a new enquiry is typed. */
  @Get('customer-card/:code')
  @RequirePermission(P.VIEW)
  customerCard(@CurrentContext() ctx: RequestContext, @Param('code') code: string) {
    return this.query.customerCard(ctx, code);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.ENQUIRY_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnquiryDto) {
    return this.enquiries.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.ENQUIRY_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: EnquiryVersionDto) {
    return this.enquiries.remove(ctx, id, q.version);
  }

  @Post(':id/forward')
  @RequirePermission(P.ENQUIRY_EDIT)
  forward(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnquiryVersionDto) {
    return this.enquiries.forward(ctx, id, dto.version);
  }

  @Post(':id/quotation')
  @RequirePermission(P.QUOTATION_EDIT)
  createQuotation(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.enquiries.createQuotation(ctx, id);
  }

  @Post(':id/lost')
  @RequirePermission(P.ENQUIRY_EDIT)
  lost(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnquiryLostDto) {
    return this.enquiries.markLost(ctx, id, dto);
  }
}
