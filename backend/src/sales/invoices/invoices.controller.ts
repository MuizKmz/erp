import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import {
  CreateDirectInvoiceDto,
  CreateFromOrderDto,
  InvoiceApprovalDto,
  InvoiceCandidatesQueryDto,
  InvoiceListQueryDto,
  InvoiceVersionDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import { InvoicesQuery } from './invoices.query';
import { InvoicesService } from './invoices.service';

/** S17 list, S18 create from orders, S19 invoice, S20 print — /api/v1/sales/invoices */
@Controller('sales/invoices')
export class SalesInvoicesController {
  constructor(
    private readonly query: InvoicesQuery,
    private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: InvoiceListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('candidates')
  @RequirePermission(P.INVOICE_EDIT)
  candidates(@CurrentContext() ctx: RequestContext, @Query() query: InvoiceCandidatesQueryDto) {
    return this.query.candidates(ctx, query.customerCode);
  }

  @Post('from-order')
  @RequirePermission(P.INVOICE_EDIT)
  createFromOrder(@CurrentContext() ctx: RequestContext, @Body() dto: CreateFromOrderDto) {
    return this.invoices.createFromOrder(ctx, dto);
  }

  @Post()
  @RequirePermission(P.INVOICE_EDIT)
  createDirect(@CurrentContext() ctx: RequestContext, @Body() dto: CreateDirectInvoiceDto) {
    return this.invoices.createDirect(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.INVOICE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.INVOICE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: InvoiceVersionDto) {
    return this.invoices.remove(ctx, id, dto.version);
  }

  @Post(':id/request-approval')
  @RequirePermission(P.INVOICE_EDIT)
  requestApproval(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InvoiceApprovalDto) {
    return this.invoices.requestApproval(ctx, id, dto);
  }

  @Post(':id/release')
  @RequirePermission(P.INVOICE_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InvoiceVersionDto) {
    return this.invoices.release(ctx, id, dto.version);
  }

  @Post(':id/email')
  @RequirePermission(P.INVOICE_EDIT)
  email(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.email(ctx, id);
  }
}
