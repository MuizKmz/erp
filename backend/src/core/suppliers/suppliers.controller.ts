import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateSupplierDto, SupplierListQueryDto, SupplierVersionDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SuppliersQuery } from './suppliers.query';
import { SuppliersService } from './suppliers.service';

/** C06 supplier list, C07 supplier — /api/v1/core/suppliers. Buyers and the Purchasing Manager maintain suppliers (SRS §3.3). */
@Controller('core/suppliers')
export class CoreSuppliersController {
  constructor(
    private readonly query: SuppliersQuery,
    private readonly suppliers: SuppliersService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: SupplierListQueryDto) {
    return this.query.list(ctx, query);
  }

  /** The "Supplies" filter of C06. */
  @Get('supplies')
  @RequirePermission(P.VIEW)
  async supplies(@CurrentContext() ctx: RequestContext) {
    return { items: await this.query.supplies(ctx.tenantId) };
  }

  @Post()
  @RequirePermission(P.SUPPLIER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  /**
   * Who may save depends on what changed: contract prices need core.supplier.contract (buyers do not have it), the rest
   * core.supplier.edit. The service checks it field by field.
   */
  @Patch(':id')
  @RequirePermission(P.VIEW)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(ctx, id, dto);
  }

  @Post(':id/block')
  @RequirePermission(P.SUPPLIER_EDIT)
  block(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierVersionDto) {
    return this.suppliers.setStatus(ctx, id, 'block', dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.SUPPLIER_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierVersionDto) {
    return this.suppliers.setStatus(ctx, id, 'activate', dto.version);
  }

  @Delete(':id')
  @RequirePermission(P.SUPPLIER_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: SupplierVersionDto) {
    return this.suppliers.remove(ctx, id, q.version);
  }
}
