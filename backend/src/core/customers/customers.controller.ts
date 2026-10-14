import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateCustomerDto, CustomerListQueryDto, CustomerVersionDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersQuery } from './customers.query';
import { CustomersService } from './customers.service';

/** C04 customer list, C05 customer — /api/v1/core/customers */
@Controller('core/customers')
export class CoreCustomersController {
  constructor(
    private readonly query: CustomersQuery,
    private readonly customers: CustomersService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: CustomerListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Post()
  @RequirePermission(P.CUSTOMER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  /**
   * Who may save depends on what changed: credit fields need core.customer.credit (the Finance Manager has only that),
   * the rest core.customer.edit. The service checks it field by field.
   */
  @Patch(':id')
  @RequirePermission(P.VIEW)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(ctx, id, dto);
  }

  @Post(':id/block')
  @RequirePermission(P.CUSTOMER_EDIT)
  block(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerVersionDto) {
    return this.customers.setStatus(ctx, id, 'block', dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.CUSTOMER_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerVersionDto) {
    return this.customers.setStatus(ctx, id, 'activate', dto.version);
  }

  @Delete(':id')
  @RequirePermission(P.CUSTOMER_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: CustomerVersionDto) {
    return this.customers.remove(ctx, id, q.version);
  }
}
