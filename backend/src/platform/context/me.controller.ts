import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ClockService } from '../clock/clock.service';
import { CurrentContext } from './context.decorators';
import { PermissionCatalogue } from './permission-catalogue';
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
    private readonly catalogue: PermissionCatalogue,
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
      /** Every permission in words ("Purchase · View"), so a page can say which one a person is missing. */
      permissionLabels: Object.fromEntries(this.catalogue.modules().flatMap((m) => m.permissions.map((p) => [p.key, `${p.object} · ${p.action}`]))),
      today: this.clock.today(),
      now: this.clock.now().toISOString(),
      timeZone: this.clock.timeZone,
    };
  }

  /**
   * The launcher tiles for this person. A module they cannot view reads NO_ACCESS with no route, so its tile never opens
   * a module that would only refuse them. The WMS tile exists only where a WMS is connected.
   */
  @Get('modules')
  modules(@CurrentContext() ctx: RequestContext) {
    const viewKey = new Map(this.catalogue.modules().map((m) => [m.module, m.viewKey]));
    const canView = (code: string) => {
      const key = viewKey.get(code);
      return !key || this.registry.has(ctx.user.roles, key);
    };
    const wmsConnected = !!this.config.get('WMS', { infer: true });
    return {
      items: MODULES.map((m) => {
        const tile = m.code === 'wms' && wmsConnected ? { ...m, tag: 'Read only', state: 'OPEN', route: '/wms' } : m;
        if (tile.state !== 'OPEN' || canView(tile.code)) return tile;
        return { ...tile, tag: 'No access', state: 'NO_ACCESS', route: null };
      }),
    };
  }
}
