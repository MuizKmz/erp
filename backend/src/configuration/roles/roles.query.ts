import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { rolesOn } from '../../platform/context/assignment.rules';
import { PermissionCatalogue } from '../../platform/context/permission-catalogue';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import { ADMIN_ROLE } from '../../platform/context/permission.rules';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CONFIG_ENTITY } from '../configuration.constants';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { readSignInSettings, SIGN_IN_PREFIX } from '../settings/sign-in.rules';
import { joinAnd } from '../shared/text.rules';
import {
  compareText,
  deleteRoleRefusal,
  groupCatalogue,
  isAsStarter,
  personText,
  roleSubtitle,
  scopeText,
  STARTER_ROLES,
  starterPermissions,
} from './roles.rules';

const ROLE_INCLUDE = {
  permissions: { select: { permission: true } },
  users: { where: { user: { isActive: true } }, include: { user: { select: { id: true, code: true, name: true, branches: { select: { branch: { select: { code: true } } } } } } } },
} satisfies Prisma.SysRoleInclude;

export type RoleRow = Prisma.SysRoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

/** A08 roles, A09 a role, A10 who can do what: what the screens read. */
@Injectable()
export class RolesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly activity: ActivityService,
    private readonly registry: PermissionRegistry,
    private readonly catalogue: PermissionCatalogue,
  ) {}

  private canEdit(ctx: RequestContext): boolean {
    return this.registry.has(ctx.user.roles, P.ROLE_EDIT);
  }

  /** Every key in catalogue order: Purchase, Sales, Core, Configuration. */
  orderedKeys(): string[] {
    return this.catalogue.modules().flatMap((m) => m.permissions.map((p) => p.key));
  }

  /** "See margin (Sales)": how the role form labels a permission. */
  label(key: string): string {
    for (const m of this.catalogue.modules()) {
      const p = m.permissions.find((x) => x.key === key);
      if (p) return `${p.action} (${p.object})`;
    }
    return key;
  }

  /** The keys a role gives, in catalogue order. Administrator: all of them. */
  keysOf(role: { code: string; permissions: { permission: string }[] }): string[] {
    const order = this.orderedKeys();
    if (role.code === ADMIN_ROLE) return order;
    const held = new Set(role.permissions.map((p) => p.permission));
    return order.filter((k) => held.has(k));
  }

  async findRole(ctx: RequestContext, id: string): Promise<RoleRow> {
    const role = await this.prisma.sysRole.findFirst({ where: { id, tenantId: ctx.tenantId }, include: ROLE_INCLUDE });
    if (!role) throw new NotFoundError('Role');
    return role;
  }

  private async twoFactorRoles(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { key: true, value: true } });
    return readSignInSettings(rows).twoFactorRoles;
  }

  /** A08 · every role, by name. */
  async list(ctx: RequestContext) {
    const [roles, twoFactor] = await Promise.all([
      this.prisma.sysRole.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' }, include: ROLE_INCLUDE }),
      this.twoFactorRoles(ctx.tenantId),
    ]);
    return {
      items: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        users: r.users.length,
        permissions: this.keysOf(r).length,
        permissionsText: r.code === ADMIN_ROLE ? 'All' : String(this.keysOf(r).length),
        sees: scopeText(r.agentScopeCustomers),
        twoFactor: twoFactor.includes(r.code),
        isStarter: r.isStarter,
      })),
      canEdit: this.canEdit(ctx),
    };
  }

  /** The catalogue as the role form lays it out. */
  catalogueTree() {
    return { modules: groupCatalogue(this.catalogue.modules()), total: this.orderedKeys().length };
  }

  /** A09 · the role with its permissions, scope, holders and activity. */
  async detail(ctx: RequestContext, id: string) {
    const role = await this.findRole(ctx, id);
    const [twoFactor, activity] = await Promise.all([this.twoFactorRoles(ctx.tenantId), this.activity.listFor(ctx.tenantId, CONFIG_ENTITY.ROLE, id)]);
    // In the order Sign-in settings lists them.
    const named = await this.prisma.sysRole.findMany({ where: { tenantId: ctx.tenantId, code: { in: twoFactor } }, select: { code: true, name: true } });
    const twoFactorNames = twoFactor.flatMap((code) => named.filter((r) => r.code === code).map((r) => r.name));
    const keys = this.keysOf(role);
    const isAdmin = role.code === ADMIN_ROLE;
    const starter = STARTER_ROLES.find((s) => s.code === role.code);
    const holders = [...role.users].sort((a, b) => a.user.code.localeCompare(b.user.code));
    const canEdit = this.canEdit(ctx) && !isAdmin;
    const deleteRefusal = deleteRoleRefusal(role, holders.map((h) => h.user.code));
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isStarter: role.isStarter,
      isAdministrator: isAdmin,
      agentScopeCustomers: role.agentScopeCustomers,
      agentScopeDocuments: role.agentScopeDocuments,
      version: role.version,
      subtitle: roleSubtitle(role.code, keys.length, holders.length, role.agentScopeCustomers),
      permissions: keys,
      users: holders.map((h) => ({
        id: h.user.id,
        code: h.user.code,
        name: h.user.name,
        branches: h.user.branches.map((b) => b.branch.code).sort().join(', '),
      })),
      twoFactor: {
        required: twoFactor.includes(role.code),
        text: `${twoFactor.includes(role.code) ? 'Required' : 'Not required'} for this role. Required for ${joinAnd(twoFactorNames)} (Sign-in settings).`,
      },
      activity,
      asStarter: starter ? isAsStarter(keys, starterPermissions(this.catalogue.modules(), role.code), { customers: role.agentScopeCustomers, documents: role.agentScopeDocuments }, !!starter.agentScope) : null,
      allowedActions: canEdit ? ['edit', ...(role.isStarter ? ['reset' as const] : []), ...(deleteRefusal ? [] : ['delete' as const])] : [],
      refusals: { delete: role.isStarter || isAdmin ? null : deleteRefusal },
    };
  }

  /** A10 · what a person can do today, and which of their roles gives each permission. */
  async person(ctx: RequestContext, userId: string) {
    const user = await this.prisma.sysUser.findFirst({
      where: { id: userId, tenantId: ctx.tenantId },
      include: { roles: { orderBy: { sortOrder: 'asc' }, include: { role: { include: { permissions: { select: { permission: true } } } } } } },
    });
    if (!user) throw new NotFoundError('User');
    const today = this.clock.todayDate();
    const counting = new Set(rolesOn(user.roles.map((r) => ({ code: r.role.code, validFrom: r.validFrom, validUntil: r.validUntil })), today));
    const roles = user.roles.map((r) => ({ code: r.role.code, name: r.role.name, counts: counting.has(r.role.code), keys: new Set(this.keysOf(r.role)), agentScope: r.role.agentScopeCustomers }));
    const rows = this.catalogue.modules().flatMap((m) =>
      m.permissions
        .map((p) => ({ module: m.label, object: p.object, action: p.action, key: p.key, roles: roles.filter((r) => r.counts && r.keys.has(p.key)).map((r) => r.name) }))
        .filter((row) => row.roles.length),
    );
    const agentRoles = roles.filter((r) => r.counts && r.agentScope).map((r) => r.name);
    return {
      user: { id: user.id, code: user.code, name: user.name, isActive: user.isActive },
      roles: roles.map(({ code, name, counts }) => ({ code, name, counts })),
      rows,
      text: personText(user.name, rows.length, roles.filter((r) => r.counts).length, agentRoles),
    };
  }

  /** A10 · two roles side by side, over every permission either gives. */
  async compare(ctx: RequestContext, a: string, b: string) {
    const roles = await this.prisma.sysRole.findMany({ where: { tenantId: ctx.tenantId, code: { in: [a, b] } }, include: { permissions: { select: { permission: true } } } });
    const find = (code: string) => {
      const r = roles.find((x) => x.code === code);
      if (!r) throw new NotFoundError('Role');
      return { code: r.code, name: r.name, agentScope: r.agentScopeCustomers, keys: new Set(this.keysOf(r)) };
    };
    const left = find(a);
    const right = find(b);
    const rows = this.catalogue.modules().flatMap((m) =>
      m.permissions
        .filter((p) => left.keys.has(p.key) || right.keys.has(p.key))
        .map((p) => ({ module: m.label, object: p.object, action: p.action, key: p.key, a: left.keys.has(p.key), b: right.keys.has(p.key) })),
    );
    return {
      a: { code: left.code, name: left.name, permissions: left.keys.size },
      b: { code: right.code, name: right.name, permissions: right.keys.size },
      rows,
      text: compareText(left, right),
    };
  }
}
