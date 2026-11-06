import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../platform/context/context.decorators';
import type { RequestContext } from '../platform/context/request-context';
import { ListQueryDto } from '../platform/http/list-query.dto';
import { WMS_PERMISSIONS as P } from './wms.permissions';
import { WmsQuery } from './wms.query';

export class WmsListDto extends ListQueryDto {
  @IsOptional() @IsString() @MaxLength(50) warehouse?: string;
  @IsOptional() @IsString() @MaxLength(50) location?: string;
  @IsOptional() @IsString() @MaxLength(50) rack?: string;
  @IsOptional() @IsString() @MaxLength(100) group?: string;
  @IsOptional() @IsString() @MaxLength(20) show?: string;
  @IsOptional() @IsString() @MaxLength(50) supplier?: string;
  @IsOptional() @IsString() @MaxLength(50) customer?: string;
}

/** W01–W05 — /api/v1/wms. Read only: there are GET routes here and nothing else, and a test keeps it so. */
@Controller('wms')
export class WmsController {
  constructor(private readonly query: WmsQuery) {}

  @Get('inventory')
  @RequirePermission(P.VIEW)
  inventory(@CurrentContext() ctx: RequestContext, @Query() q: WmsListDto) {
    return this.query.inventory(ctx, q);
  }

  @Get('stock-locations')
  @RequirePermission(P.VIEW)
  stockLocations(@Query() q: WmsListDto) {
    return this.query.stockLocations(q);
  }

  @Get('epc/:code')
  @RequirePermission(P.VIEW)
  epc(@Param('code') code: string) {
    return this.query.epc(code);
  }

  @Get('receiving')
  @RequirePermission(P.VIEW)
  receiving(@Query() q: WmsListDto) {
    return this.query.receiving(q);
  }

  @Get('shipping')
  @RequirePermission(P.VIEW)
  shipping(@Query() q: WmsListDto) {
    return this.query.shipping(q);
  }
}
