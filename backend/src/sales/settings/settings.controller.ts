import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import {
  AddExclusionDto,
  AddOrderTypeDto,
  EnquirySourceDto,
  EnquiryTypeDto,
  ExclusionQueryDto,
  NewTemplateDto,
  PreviewTemplateDto,
  SaveCreditControlDto,
  SaveDocumentTypesDto,
  SaveTemplateDto,
} from './dto/settings.dto';
import { SalesListsService } from './lists.service';
import { SalesPoliciesService } from './policies.service';

/** Operation Policies (S29–S33) — /api/v1/sales/settings. Anyone in Sales can read; sales.settings.manage changes. */
@Controller('sales/settings')
export class SalesSettingsController {
  constructor(
    private readonly policies: SalesPoliciesService,
    private readonly lists: SalesListsService,
  ) {}

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

  // ── Enquiry types (S31) ───────────────────────────────────────────────────

  @Get('enquiry-types')
  @RequirePermission(P.VIEW)
  enquiryTypes(@CurrentContext() ctx: RequestContext) {
    return this.lists.enquiryTypes(ctx);
  }

  @Post('enquiry-types')
  @RequirePermission(P.SETTINGS_MANAGE)
  addEnquiryType(@CurrentContext() ctx: RequestContext, @Body() dto: EnquiryTypeDto) {
    return this.lists.saveEnquiryType(ctx, null, dto);
  }

  @Put('enquiry-types/:code')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveEnquiryType(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @Body() dto: EnquiryTypeDto) {
    return this.lists.saveEnquiryType(ctx, code, dto);
  }

  @Post('enquiry-sources')
  @RequirePermission(P.SETTINGS_MANAGE)
  addSource(@CurrentContext() ctx: RequestContext, @Body() dto: EnquirySourceDto) {
    return this.lists.addSource(ctx, dto);
  }

  // ── Excluded items (S32) ──────────────────────────────────────────────────

  @Get('excluded-items')
  @RequirePermission(P.VIEW)
  exclusions(@CurrentContext() ctx: RequestContext, @Query() query: ExclusionQueryDto) {
    return this.lists.exclusions(ctx, query);
  }

  @Post('excluded-items')
  @RequirePermission(P.SETTINGS_MANAGE)
  addExclusion(@CurrentContext() ctx: RequestContext, @Body() dto: AddExclusionDto) {
    return this.lists.addExclusion(ctx, dto);
  }

  @Post('excluded-items/:id/remove')
  @RequirePermission(P.SETTINGS_MANAGE)
  removeExclusion(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.lists.removeExclusion(ctx, id);
  }

  // ── Email templates (S33) ─────────────────────────────────────────────────

  @Get('email-templates')
  @RequirePermission(P.VIEW)
  templates(@CurrentContext() ctx: RequestContext) {
    return this.lists.templates(ctx);
  }

  @Post('email-templates')
  @RequirePermission(P.SETTINGS_MANAGE)
  newTemplate(@CurrentContext() ctx: RequestContext, @Body() dto: NewTemplateDto) {
    return this.lists.newTemplate(ctx, dto);
  }

  @Put('email-templates/:key')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveTemplate(@CurrentContext() ctx: RequestContext, @Param('key') key: string, @Body() dto: SaveTemplateDto) {
    return this.lists.saveTemplate(ctx, key, dto);
  }

  @Post('email-templates/:key/preview')
  @RequirePermission(P.VIEW)
  preview(@CurrentContext() ctx: RequestContext, @Param('key') key: string, @Body() dto: PreviewTemplateDto) {
    return this.lists.preview(ctx, key, dto);
  }

  @Post('email-templates/:key/test')
  @RequirePermission(P.SETTINGS_MANAGE)
  sendTest(@CurrentContext() ctx: RequestContext, @Param('key') key: string) {
    return this.lists.sendTest(ctx, key);
  }
}
