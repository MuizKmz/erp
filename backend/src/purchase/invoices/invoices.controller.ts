import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import {
  BillableOrdersQueryDto,
  CreateInvoiceDto,
  DecideInvoiceDto,
  InvoiceListQueryDto,
  InvoiceVersionDto,
  NewInvoiceQueryDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import { InvoicesQuery } from './invoices.query';
import { InvoicesService } from './invoices.service';

/** P16 list, P17 three-way match — /api/v1/purchase/invoices */
@Controller('purchase/invoices')
export class InvoicesController {
  constructor(
    private readonly query: InvoicesQuery,
    private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: InvoiceListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('kpis')
  @RequirePermission(P.VIEW)
  kpis(@CurrentContext() ctx: RequestContext) {
    return this.query.kpis(ctx);
  }

  /** Purchase orders of a supplier with goods received and not yet billed. */
  @Get('billable-orders')
  @RequirePermission(P.INVOICE_EDIT)
  billableOrders(@CurrentContext() ctx: RequestContext, @Query() query: BillableOrdersQueryDto) {
    return this.query.billableOrders(ctx, query.supplierCode);
  }

  /** A new invoice for a PO, filled in with what was received and not yet billed (nothing is saved). */
  @Get('new')
  @RequirePermission(P.INVOICE_EDIT)
  template(@CurrentContext() ctx: RequestContext, @Query() query: NewInvoiceQueryDto) {
    return this.query.template(ctx, query.poId);
  }

  @Post()
  @RequirePermission(P.INVOICE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(ctx, dto);
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
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: InvoiceVersionDto) {
    return this.invoices.remove(ctx, id, q.version);
  }

  @Post(':id/decide')
  @RequirePermission(P.INVOICE_EDIT)
  decide(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideInvoiceDto) {
    return this.invoices.decide(ctx, id, dto);
  }
}
