import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ClockService } from '../clock/clock.service';
import { CurrentContext } from './context.decorators';
import { PermissionRegistry } from './permission.registry';
import { USER_DIRECTORY, type RequestContext, type UserDirectory } from './request-context';
import { TenantService } from './tenant.service';

/** The module launcher tiles (Launcher.html). Static until module licensing exists. */
const MODULES = [
  { code: 'core', name: 'Core', tag: 'Master Data · open', state: 'OPEN', route: '/core' },
  { code: 'purchase', name: 'Purchase', tag: 'Designed · open', state: 'OPEN', route: '/purchase' },
  { code: 'sales', name: 'Sales', tag: 'Designed · open', state: 'OPEN', route: '/sales' },
  { code: 'mes', name: 'MES', tag: 'Later', state: 'LATER', route: null },
  { code: 'wms', name: 'WMS', tag: 'Existing', state: 'EXISTING', route: null },
  { code: 'config', name: 'Configuration', tag: 'Users · settings', state: 'OPEN', route: '/config' },
] as const;

@Controller('me')
export class MeController {
  constructor(
    private readonly registry: PermissionRegistry,
    private readonly clock: ClockService,
    private readonly tenants: TenantService,
    @Inject(USER_DIRECTORY) private readonly directory: UserDirectory,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Who the API thinks you are. The frontend shows this in the top bar and hides buttons from it. */
  @Get()
  async me(@CurrentContext() ctx: RequestContext) {
    const branches = await this.directory.listBranches(ctx.tenantId);
    return {
      user: ctx.user,
      tenantId: ctx.tenantId,
      tenantName: await this.tenants.name(),
      authMode: this.config.get('AUTH_MODE', { infer: true }),
      branchCode: ctx.branchCode,
      /** The user's branches with their names, for the branch switch (default first). */
      branches: ctx.user.branchCodes.map((code) => ({ code, name: branches.find((b) => b.code === code)?.name ?? code })),
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
