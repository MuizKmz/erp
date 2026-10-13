import { Controller, Get } from '@nestjs/common';
import { ClockService } from '../clock/clock.service';
import { CurrentContext } from './context.decorators';
import { PermissionRegistry } from './permission.registry';
import type { RequestContext } from './request-context';

/** The module launcher tiles (Launcher.html). Static until module licensing exists. */
const MODULES = [
  { code: 'core', name: 'Core', tag: 'Master Data · open', state: 'OPEN', route: '/core' },
  { code: 'purchase', name: 'Purchase', tag: 'Designed · open', state: 'OPEN', route: '/purchase' },
  { code: 'sales', name: 'Sales', tag: 'Designed · open', state: 'OPEN', route: '/sales' },
  { code: 'mes', name: 'MES', tag: 'Later', state: 'LATER', route: null },
  { code: 'wms', name: 'WMS', tag: 'Existing', state: 'EXISTING', route: null },
  { code: 'config', name: 'Configuration', tag: 'Users · settings', state: 'EXISTING', route: null },
] as const;

@Controller('me')
export class MeController {
  constructor(
    private readonly registry: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  /** Who the API thinks you are. The frontend shows this in the top bar and hides buttons from it. */
  @Get()
  me(@CurrentContext() ctx: RequestContext) {
    return {
      user: ctx.user,
      tenantId: ctx.tenantId,
      branchCode: ctx.branchCode,
      permissions: this.registry.permissionsFor(ctx.user.roles),
      today: this.clock.today(),
      now: this.clock.now().toISOString(),
      timeZone: this.clock.timeZone,
    };
  }

  /** Modules the user can open from the launcher. */
  @Get('modules')
  modules() {
    return { items: MODULES };
  }
}
