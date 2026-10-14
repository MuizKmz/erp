import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { ValidationFailedError } from '../../platform/http/errors';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { CreateTaxCodeDto, NewRateDto, TaxCodeVersionDto, UpdateTaxCodeDto } from './dto/tax-code.dto';
import { TAX_CODE } from './tax-codes.rules';
import { TaxCodesQuery } from './tax-codes.query';
import { TaxCodesService } from './tax-codes.service';

/** "sst10" → SST10, checked like a typed code. */
function codeOf(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!TAX_CODE.test(code)) throw ValidationFailedError.field('code', `"${raw}" is not a tax code.`);
  return code;
}

/** C10 tax codes — /api/v1/core/tax-codes, by code (a code is all its rate periods). Only the Master Data Admin changes them. */
@Controller('core/tax-codes')
export class CoreTaxCodesController {
  constructor(
    private readonly query: TaxCodesQuery,
    private readonly taxCodes: TaxCodesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.list(ctx);
  }

  @Post()
  @RequirePermission(P.TAX_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateTaxCodeDto) {
    return this.taxCodes.create(ctx, dto);
  }

  @Get(':code')
  @RequirePermission(P.VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('code') code: string) {
    return this.query.detail(ctx, codeOf(code));
  }

  @Patch(':code')
  @RequirePermission(P.TAX_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @Body() dto: UpdateTaxCodeDto) {
    return this.taxCodes.update(ctx, codeOf(code), dto);
  }

  /** New rate: a row from its date; the one before closes the day before (SRS BR-TAX-006). */
  @Post(':code/rates')
  @RequirePermission(P.TAX_EDIT)
  addRate(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @Body() dto: NewRateDto) {
    return this.taxCodes.addRate(ctx, codeOf(code), dto);
  }

  /** Only a rate that has not started, and is the latest. */
  @Delete(':code/rates/:id')
  @RequirePermission(P.TAX_EDIT)
  removeRate(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: TaxCodeVersionDto) {
    return this.taxCodes.removeRate(ctx, codeOf(code), id, q.version);
  }

  @Delete(':code')
  @RequirePermission(P.TAX_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @Query() q: TaxCodeVersionDto) {
    return this.taxCodes.remove(ctx, codeOf(code), q.version);
  }
}
