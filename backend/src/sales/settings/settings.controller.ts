import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { AddOrderTypeDto, SaveCreditControlDto, SaveDocumentTypesDto } from './dto/settings.dto';
import { SalesPoliciesService } from './policies.service';

/** Operation Policies (S29–S33) — /api/v1/sales/settings. Anyone in Sales can read; sales.settings.manage changes. */
@Controller('sales/settings')
export class SalesSettingsController {
  constructor(private readonly policies: SalesPoliciesService) {}

  @Get('credit-control')
  @RequirePermission(P.VIEW)
  creditControl(@CurrentContext() ctx: RequestContext) {
    return this.policies.creditControl(ctx);
  }

  @Put('credit-control')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveCreditControl(@CurrentContext() ctx: RequestContext, @Body() dto: SaveCreditControlDto) {
    return this.policies.saveCreditControl(ctx, dto);
  }

  @Get('document-types')
  @RequirePermission(P.VIEW)
  documentTypes(@CurrentContext() ctx: RequestContext) {
    return this.policies.documentTypes(ctx);
  }

  @Put('document-types')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveDocumentTypes(@CurrentContext() ctx: RequestContext, @Body() dto: SaveDocumentTypesDto) {
    return this.policies.saveDocumentTypes(ctx, dto);
  }

  @Post('order-types')
  @RequirePermission(P.SETTINGS_MANAGE)
  addOrderType(@CurrentContext() ctx: RequestContext, @Body() dto: AddOrderTypeDto) {
    return this.policies.addOrderType(ctx, dto);
  }
}
