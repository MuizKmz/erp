import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { toMoney } from '../../platform/http/decimal';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CashPurchaseListQueryDto, CashPurchaseVersionDto, CreateCashPurchaseDto, UpdateCashPurchaseDto } from './dto/cash-purchase.dto';
import { CashPurchasesQuery } from './cash-purchases.query';
import { CashPurchasesService } from './cash-purchases.service';

/** P18 list, P19 cash purchase — /api/v1/purchase/cash-purchases */
@Controller('purchase/cash-purchases')
export class CashPurchasesController {
  constructor(
    private readonly query: CashPurchasesQuery,
    private readonly cashPurchases: CashPurchasesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: CashPurchaseListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('overview')
  @RequirePermission(P.VIEW)
  overview(@CurrentContext() ctx: RequestContext) {
    return this.query.overview(ctx);
  }

  @Get('payment-methods')
  @RequirePermission(P.VIEW)
  async paymentMethods(@CurrentContext() ctx: RequestContext) {
    const rows = await this.query.paymentMethods(ctx);
    return { items: rows.map((m) => ({ code: m.code, kind: m.kind, label: m.label, branchCode: m.branchCode, holder: m.holder, floatAmount: m.floatAmount ? toMoney(m.floatAmount) : null })) };
  }

  @Post()
  @RequirePermission(P.CASH_PURCHASE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCashPurchaseDto) {
    return this.cashPurchases.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.CASH_PURCHASE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCashPurchaseDto) {
    return this.cashPurchases.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.CASH_PURCHASE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: CashPurchaseVersionDto) {
    return this.cashPurchases.remove(ctx, id, q.version);
  }

  @Post(':id/release')
  @RequirePermission(P.CASH_PURCHASE_RELEASE)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashPurchaseVersionDto) {
    return this.cashPurchases.release(ctx, id, dto.version);
  }
}
