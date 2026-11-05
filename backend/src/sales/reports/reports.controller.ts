import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CustomerAgingQuery } from './aging.query';
import { QuotationConversionQuery } from './conversion.query';
import { EInvoiceStatusQuery } from './einvoice.query';
import { OpenOrdersQuery } from './open-orders.query';
import { InvoiceRegisterQuery } from './register.query';
import { SalesReportsQuery } from './reports.query';

const PERIOD = /^\d{4}-\d{2}$/;
const PERIOD_MESSAGE = 'Period must look like 2026-09.';

/** Branch, sales agent and customer group: the filters every report has. */
export class ReportScopeDto {
  @IsOptional() @IsString() @MaxLength(10) branch?: string;
  @IsOptional() @IsString() @MaxLength(20) agent?: string;
  @IsOptional() @IsString() @MaxLength(60) group?: string;
}

export class ReportFilterDto extends ReportScopeDto {
  @IsOptional()
  @Matches(PERIOD, { message: PERIOD_MESSAGE })
  period?: string;
}

export class ItemReportFilterDto extends ReportFilterDto {
  @IsOptional() @IsString() @MaxLength(60) itemGroup?: string;
}

export class OpenOrdersFilterDto extends ReportScopeDto {
  @IsOptional() @IsIn(['all', 'released', 'approval', 'draft'], { message: 'Show all, released, approval or draft.' }) show?: string;
}

export class AgingFilterDto extends ReportScopeDto {
  @IsOptional() @IsIn(['4', '6', '12'], { message: 'Pick 4, 6 or 12 months.' }) steps?: string;
  @IsOptional() @IsIn(['due', 'invoice'], { message: 'Age by due date or by invoice date.' }) basis?: string;
}

export class RegisterFilterDto extends ReportFilterDto {
  @IsOptional() @IsIn(['invoice', 'debit-note', 'credit-note'], { message: 'Pick invoices, debit notes or credit notes.' }) type?: string;
}

export class EInvoiceFilterDto {
  @IsOptional()
  @Matches(/^(all|\d{4}-\d{2})$/, { message: 'Period must be all or look like 2026-09.' })
  period?: string;

  @IsOptional() @IsString() @MaxLength(10) branch?: string;
  @IsOptional() @IsIn(['invoice', 'debit-note', 'credit-note', 'cash-sale'], { message: 'Pick invoices, debit notes, credit notes or cash sales.' }) type?: string;
  @IsOptional() @IsIn(['waiting', 'all'], { message: 'Show waiting or all.' }) show?: string;
}

/** S05 · Sales reports — /api/v1/sales/reports. Every report reads inside the person's request, so the data scopes apply (RPT-020). */
@Controller('sales/reports')
export class SalesReportsController {
  constructor(
    private readonly reports: SalesReportsQuery,
    private readonly openOrders: OpenOrdersQuery,
    private readonly conversion: QuotationConversionQuery,
    private readonly aging: CustomerAgingQuery,
    private readonly register: InvoiceRegisterQuery,
    private readonly eInvoices: EInvoiceStatusQuery,
  ) {}

  @Get('by-customer')
  @RequirePermission(P.VIEW)
  byCustomer(@CurrentContext() ctx: RequestContext, @Query() query: ReportFilterDto) {
    return this.reports.byCustomer(ctx, query);
  }

  @Get('by-item')
  @RequirePermission(P.VIEW)
  byItem(@CurrentContext() ctx: RequestContext, @Query() query: ItemReportFilterDto) {
    return this.reports.byItem(ctx, query);
  }

  @Get('open-orders')
  @RequirePermission(P.VIEW)
  openOrdersReport(@CurrentContext() ctx: RequestContext, @Query() query: OpenOrdersFilterDto) {
    return this.openOrders.report(ctx, query);
  }

  @Get('quotation-conversion')
  @RequirePermission(P.VIEW)
  quotationConversion(@CurrentContext() ctx: RequestContext, @Query() query: ReportFilterDto) {
    return this.conversion.report(ctx, query);
  }

  @Get('customer-aging')
  @RequirePermission(P.VIEW)
  customerAging(@CurrentContext() ctx: RequestContext, @Query() query: AgingFilterDto) {
    return this.aging.report(ctx, query);
  }

  @Get('invoice-register')
  @RequirePermission(P.VIEW)
  invoiceRegister(@CurrentContext() ctx: RequestContext, @Query() query: RegisterFilterDto) {
    return this.register.report(ctx, query);
  }

  @Get('e-invoice-status')
  @RequirePermission(P.VIEW)
  eInvoiceStatus(@CurrentContext() ctx: RequestContext, @Query() query: EInvoiceFilterDto) {
    return this.eInvoices.report(ctx, query);
  }
}
