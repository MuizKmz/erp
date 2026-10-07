import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CashSalesQuery } from './cash-sales.query';
import { CashSalesService } from './cash-sales.service';
import { CashListQueryDto, CashSaleDto, CashVersionDto, UpdateCashSaleDto } from './dto/cash-sale.dto';

/** S23 list, S24 cash sale — /api/v1/sales/cash-sales */
@Controller('sales/cash-sales')
export class SalesCashSalesController {
  constructor(
    private readonly query: CashSalesQuery,
    private readonly sales: CashSalesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: CashListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.CASH_SALE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CashSaleDto) {
    return this.sales.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.CASH_SALE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCashSaleDto) {
    return this.sales.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.CASH_SALE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: CashVersionDto) {
    return this.sales.remove(ctx, id, dto.version);
  }

  @Post(':id/release')
  @RequirePermission(P.CASH_SALE_EDIT)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashVersionDto) {
    return this.sales.release(ctx, id, dto.version);
  }
}
