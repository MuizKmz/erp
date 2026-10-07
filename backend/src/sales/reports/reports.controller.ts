import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesReportsQuery } from './reports.query';

export class ReportFilterDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Period must look like 2026-09.' })
  period?: string;

  @IsOptional() @IsString() @MaxLength(10) branch?: string;
  @IsOptional() @IsString() @MaxLength(20) agent?: string;
  @IsOptional() @IsString() @MaxLength(60) group?: string;
}

/** S05 · Sales reports — /api/v1/sales/reports */
@Controller('sales/reports')
export class SalesReportsController {
  constructor(private readonly reports: SalesReportsQuery) {}

  @Get('by-customer')
  @RequirePermission(P.VIEW)
  byCustomer(@CurrentContext() ctx: RequestContext, @Query() query: ReportFilterDto) {
    return this.reports.byCustomer(ctx, query);
  }
}
