import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { DemandService } from './demand.service';

class DemandQuery {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  branch?: string;
}

/** P04 Demand · what we should buy — /api/v1/purchase/demand */
@Controller('purchase/demand')
export class DemandController {
  constructor(private readonly demand: DemandService) {}

  @Get()
  @RequirePermission(P.VIEW)
  report(@CurrentContext() ctx: RequestContext, @Query() query: DemandQuery) {
    return this.demand.report(ctx.tenantId, query.branch || undefined);
  }
}
