import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreateProformaDto, ProformaListQueryDto, ProformaVersionDto, UpdateProformaDto } from './dto/proforma.dto';
import { ProformasQuery } from './proformas.query';
import { ProformasService } from './proformas.service';

/** S21 list, S22 proforma — /api/v1/sales/proformas */
@Controller('sales/proformas')
export class SalesProformasController {
  constructor(
    private readonly query: ProformasQuery,
    private readonly proformas: ProformasService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ProformaListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('orders')
  @RequirePermission(P.PROFORMA_EDIT)
  orders(@CurrentContext() ctx: RequestContext) {
    return this.query.orders(ctx);
  }

  @Post()
  @RequirePermission(P.PROFORMA_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateProformaDto) {
    return this.proformas.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.PROFORMA_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProformaDto) {
    return this.proformas.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.PROFORMA_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: ProformaVersionDto) {
    return this.proformas.remove(ctx, id, dto.version);
  }

  @Post(':id/release')
  @RequirePermission(P.PROFORMA_EDIT)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProformaVersionDto) {
    return this.proformas.release(ctx, id, dto.version);
  }

  @Post(':id/email')
  @RequirePermission(P.PROFORMA_EDIT)
  email(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.proformas.email(ctx, id);
  }

  @Post(':id/cancel')
  @RequirePermission(P.PROFORMA_EDIT)
  cancel(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProformaVersionDto) {
    return this.proformas.cancel(ctx, id, dto.version);
  }
}
