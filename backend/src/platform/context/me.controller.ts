import { Controller, Get } from '@nestjs/common';
import { CurrentContext } from './context.decorators';
import { PermissionRegistry } from './permission.registry';
import type { RequestContext } from './request-context';

@Controller('me')
export class MeController {
  constructor(private readonly registry: PermissionRegistry) {}

  /** Who the API thinks you are. The frontend shows this in the top bar and hides buttons from it. */
  @Get()
  me(@CurrentContext() ctx: RequestContext) {
    return {
      user: ctx.user,
      tenantId: ctx.tenantId,
      branchCode: ctx.branchCode,
      permissions: this.registry.permissionsFor(ctx.user.roles),
    };
  }
}
