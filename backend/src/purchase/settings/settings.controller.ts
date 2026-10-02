import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { SaveApprovalRulesDto, SaveDocumentTypesDto, SaveEmailTemplateDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

/** P24 Approval Rules, P25 Document Types, P26 Email Templates — /api/v1/purchase/settings */
@Controller('purchase/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('approval-rules')
  @RequirePermission(P.VIEW)
  approvalRules(@CurrentContext() ctx: RequestContext) {
    return this.settings.approvalRules(ctx);
  }

  @Put('approval-rules')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveApprovalRules(@CurrentContext() ctx: RequestContext, @Body() dto: SaveApprovalRulesDto) {
    return this.settings.saveApprovalRules(ctx, dto);
  }

  @Get('document-types')
  @RequirePermission(P.VIEW)
  documentTypes(@CurrentContext() ctx: RequestContext) {
    return this.settings.documentTypes(ctx);
  }

  @Put('document-types')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveDocumentTypes(@CurrentContext() ctx: RequestContext, @Body() dto: SaveDocumentTypesDto) {
    return this.settings.saveDocumentTypes(ctx, dto);
  }

  @Get('email-templates')
  @RequirePermission(P.VIEW)
  emailTemplates(@CurrentContext() ctx: RequestContext) {
    return this.settings.emailTemplates(ctx);
  }

  @Get('email-templates/:key')
  @RequirePermission(P.VIEW)
  emailTemplate(@CurrentContext() ctx: RequestContext, @Param('key') key: string) {
    return this.settings.emailTemplate(ctx, key);
  }

  @Put('email-templates/:key')
  @RequirePermission(P.SETTINGS_MANAGE)
  saveEmailTemplate(@CurrentContext() ctx: RequestContext, @Param('key') key: string, @Body() dto: SaveEmailTemplateDto) {
    return this.settings.saveEmailTemplate(ctx, key, dto);
  }

  @Post('email-templates/:key/test')
  @RequirePermission(P.SETTINGS_MANAGE)
  sendTest(@CurrentContext() ctx: RequestContext, @Param('key') key: string) {
    return this.settings.sendTest(ctx, key);
  }
}
