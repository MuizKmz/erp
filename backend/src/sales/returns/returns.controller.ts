import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreateReturnDto, ReturnInvoiceSearchDto, ReturnListQueryDto, ReturnVersionDto, UpdateReturnDto } from './dto/return.dto';
import { ReturnsQuery } from './returns.query';
import { ReturnsService } from './returns.service';

/** S27 list, S28 sales return — /api/v1/sales/returns */
@Controller('sales/returns')
export class SalesReturnsController {
  constructor(
    private readonly query: ReturnsQuery,
    private readonly returns: ReturnsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ReturnListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('invoices')
  @RequirePermission(P.RETURN_EDIT)
  invoices(@CurrentContext() ctx: RequestContext, @Query() query: ReturnInvoiceSearchDto) {
    return this.query.invoices(ctx, query.q);
  }

  @Get('invoice-lines/:invoiceId')
  @RequirePermission(P.RETURN_EDIT)
  invoiceLines(@CurrentContext() ctx: RequestContext, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.query.invoiceLines(ctx, invoiceId);
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
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: ReturnVersionDto) {
    return this.returns.remove(ctx, id, dto.version);
  }

  @Post(':id/release')
  @RequirePermission(P.RETURN_RECEIVE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnVersionDto) {
    return this.returns.release(ctx, id, dto.version);
  }
}
