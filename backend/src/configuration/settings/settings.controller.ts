import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { UpdateSignInSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

/** A14 · Sign-in settings — /api/v1/config/settings/sign-in. */
@Controller('config/settings')
export class ConfigSettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get('sign-in')
  @RequirePermission(P.VIEW)
  view(@CurrentContext() ctx: RequestContext) {
    return this.service.view(ctx);
  }

  @Patch('sign-in')
  @RequirePermission(P.SETTINGS_MANAGE)
  update(@CurrentContext() ctx: RequestContext, @Body() dto: UpdateSignInSettingsDto) {
    return this.service.update(ctx, dto);
  }
}
