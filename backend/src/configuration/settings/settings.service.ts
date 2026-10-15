import { Injectable } from '@nestjs/common';
import { changeMessage, diffRecord } from '../../platform/activity/audit.rules';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import { TenantService } from '../../platform/context/tenant.service';
import type { RequestContext } from '../../platform/context/request-context';
import { StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { CONFIG_ENTITY, SECURITY_EVENT } from '../configuration.constants';
import { SecurityEventsService } from '../shared/security-events.service';
import type { UpdateSignInSettingsDto } from './dto/settings.dto';
import { SignInSettingsService } from './sign-in-settings.service';
import { PASSWORD_AGE_CHOICES, SETTING_LABELS, SETTING_LIMITS, settingsErrors, SIGN_IN_PREFIX, signInKey, type SignInSettings } from './sign-in.rules';

/** A14 · Sign-in settings: one sys_setting row each. A save applies on the next request (the cache is cleared). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SignInSettingsService,
    private readonly activity: ActivityService,
    private readonly security: SecurityEventsService,
    private readonly permissions: PermissionRegistry,
    private readonly tenants: TenantService,
  ) {}

  /** The settings' rows change one by one, so the form's version is their sum: any save since loading moves it. */
  private async version(tenantId: string): Promise<number> {
    const rows = await this.prisma.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { version: true } });
    return rows.reduce((sum, r) => sum + r.version, 0);
  }

  private async roles(tenantId: string) {
    return this.prisma.sysRole.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { code: true, name: true } });
  }

  async view(ctx: RequestContext) {
    this.settings.invalidate();
    const [settings, version, roles, tenant] = await Promise.all([
      this.settings.get(ctx.tenantId),
      this.version(ctx.tenantId),
      this.roles(ctx.tenantId),
      this.tenants.name(),
    ]);
    return {
      settings,
      version,
      tenantName: tenant,
      roles: roles.map((r) => ({ code: r.code, name: r.name })),
      limits: Object.fromEntries(Object.entries(SETTING_LIMITS).map(([k, [min, max]]) => [k, { min, max }])),
      passwordAgeChoices: PASSWORD_AGE_CHOICES,
      allowedActions: this.permissions.has(ctx.user.roles, P.SETTINGS_MANAGE) ? ['edit'] : [],
    };
  }

  async update(ctx: RequestContext, dto: UpdateSignInSettingsDto) {
    const tenantId = ctx.tenantId;
    this.settings.invalidate();
    const [before, roles] = await Promise.all([this.settings.get(tenantId), this.roles(tenantId)]);
    const { version, ...given } = dto;
    // The DTO instance carries every declared field, the ones not sent as undefined: only the sent ones change.
    const fields = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) as Partial<SignInSettings>;
    const after: SignInSettings = { ...before, ...fields, twoFactorRoles: [...new Set(fields.twoFactorRoles ?? before.twoFactorRoles)] };
    const errors = settingsErrors(after, new Set(roles.map((r) => r.code)));
    if (errors.length) throw new ValidationFailedError(errors);

    const names = new Map(roles.map((r) => [r.code, r.name]));
    const readable = (s: SignInSettings) => ({ ...s, twoFactorRoles: s.twoFactorRoles.map((c) => names.get(c) ?? c).join(', ') || null, passwordMaxAgeDays: s.passwordMaxAgeDays ?? 'Never' });
    const changes = diffRecord(readable(before), readable(after), SETTING_LABELS);
    if (!changes.length) return this.view(ctx);

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { version: true } });
      if (rows.reduce((sum, r) => sum + r.version, 0) !== version) throw new StaleVersionError();
      for (const change of changes) {
        const name = change.field as keyof SignInSettings;
        const value = after[name];
        await tx.sysSetting.upsert({
          where: { tenantId_key: { tenantId, key: signInKey(name) } },
          create: { tenantId, key: signInKey(name), value: value as never, updatedBy: ctx.user.code },
          update: { value: value as never, version: { increment: 1 }, updatedBy: ctx.user.code },
        });
      }
      const message = `Sign-in settings: ${changeMessage(changes)}`;
      await this.activity.log(tx, ctx, { entityType: CONFIG_ENTITY.SETTING, entityId: tenantId, docNo: 'sign_in', action: 'updated', message, data: { changes: changes.map((c) => ({ ...c })) } });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.SETTINGS_CHANGED, user: null, message, data: { changes: changes.map((c) => ({ ...c })) } });
    });
    this.settings.invalidate();
    return this.view(ctx);
  }
}
