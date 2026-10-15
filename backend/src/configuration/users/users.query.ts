import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionCatalogue } from '../../platform/context/permission-catalogue';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import { ADMIN_ROLE } from '../../platform/context/permission.rules';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CONFIG_ENTITY } from '../configuration.constants';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { readSignInSettings, SIGN_IN_PREFIX } from '../settings/sign-in.rules';
import type { UserListQueryDto } from './dto/user.dto';
import {
  branchNote,
  deactivateRefusal,
  effectiveText,
  holdsAdminForGood,
  roleCounts,
  rolesNote,
  STATUS_LABEL,
  TWO_FACTOR_TEXT,
  twoFactorMatches,
  twoFactorState,
  userStatus,
  userSubtitle,
  type RoleRow,
  type UserStatus,
} from './users.rules';

export const USER_INCLUDE = {
  roles: { orderBy: { sortOrder: 'asc' }, include: { role: { select: { id: true, code: true, name: true, agentScopeCustomers: true } } } },
  branches: { include: { branch: { select: { code: true, name: true, isActive: true } } } },
} satisfies Prisma.SysUserInclude;

export type UserRow = Prisma.SysUserGetPayload<{ include: typeof USER_INCLUDE }>;

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The user's roles as the rules read them. */
export function roleRows(user: UserRow): RoleRow[] {
  return user.roles.map((r) => ({ roleCode: r.role.code, validFrom: isoDay(r.validFrom), validUntil: isoDay(r.validUntil) }));
}

/** Branch codes in code order, as the screens list them, and the default one. */
export function branchesOf(user: UserRow): { codes: string[]; defaultBranch: string | null } {
  const codes = user.branches.map((b) => b.branch.code).sort((a, z) => a.localeCompare(z));
  return { codes, defaultBranch: user.branches.find((b) => b.isDefault)?.branch.code ?? codes[0] ?? null };
}

/** A06 user list and A07 user form: what the screens read. */
@Injectable()
export class UsersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly catalogue: PermissionCatalogue,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private canEdit(ctx: RequestContext): boolean {
    return this.permissions.has(ctx.user.roles, P.USER_EDIT);
  }

  /** Every role with the permission keys it gives (Administrator: the whole catalogue), and the two-factor roles. */
  async roleFacts(tenantId: string) {
    const [roles, settings] = await Promise.all([
      this.prisma.sysRole.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: { permissions: { select: { permission: true } } } }),
      this.prisma.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { key: true, value: true } }),
    ]);
    const all = [...this.catalogue.keys()];
    const keys = new Map(roles.map((r) => [r.code, new Set(r.code === ADMIN_ROLE ? all : r.permissions.map((p) => p.permission))]));
    return { roles, keys, names: new Map(roles.map((r) => [r.code, r.name])), twoFactorRoles: readSignInSettings(settings).twoFactorRoles };
  }

  async findUser(ctx: RequestContext, id: string): Promise<UserRow> {
    const user = await this.prisma.sysUser.findFirst({ where: { id, tenantId: ctx.tenantId }, include: USER_INCLUDE });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  /** Active users other than this one who hold Administrator for good (rule 2). */
  async otherAdmins(tenantId: string, userId: string | null): Promise<number> {
    const today = this.clock.today();
    const users = await this.prisma.sysUser.findMany({
      where: { tenantId, isActive: true, ...(userId && { id: { not: userId } }), roles: { some: { role: { code: ADMIN_ROLE } } } },
      include: USER_INCLUDE,
    });
    return users.filter((u) => holdsAdminForGood(roleRows(u), today)).length;
  }

  private twoFactor(user: UserRow, twoFactorRoles: readonly string[], today: string) {
    const required = roleRows(user).some((r) => roleCounts(r, today) && twoFactorRoles.includes(r.roleCode));
    return twoFactorState(required, !!user.twoFactorEnabledAt);
  }

  /** A06 · filtered in memory: a company has tens or hundreds of users, not millions. */
  async list(ctx: RequestContext, query: UserListQueryDto) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const now = new Date(); // lockouts are real times, not the demo's business date
    const [users, facts] = await Promise.all([
      this.prisma.sysUser.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: USER_INCLUDE }),
      this.roleFacts(tenantId),
    ]);
    const q = query.q?.trim().toLowerCase();
    const rows = users
      .map((u) => {
        const state = this.twoFactor(u, facts.twoFactorRoles, today);
        const status = userStatus(u.isActive, u.lockedUntil, now);
        return {
          user: u,
          item: {
            id: u.id,
            code: u.code,
            name: u.name,
            jobTitle: u.jobTitle,
            email: u.email,
            roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
            branches: branchesOf(u).codes,
            twoFactor: state,
            twoFactorText: TWO_FACTOR_TEXT[state],
            lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
            status,
            statusLabel: STATUS_LABEL[status],
          },
        };
      })
      .filter(({ user, item }) => {
        if (q && ![user.code, user.name, user.email].some((v) => v.toLowerCase().includes(q))) return false;
        if (query.role && !item.roles.some((r) => r.code === query.role)) return false;
        if (query.branch && !item.branches.includes(query.branch)) return false;
        return twoFactorMatches(item.twoFactor, query.twoFactor);
      });
    const counts = { all: rows.length, active: 0, locked: 0, inactive: 0 };
    for (const { item } of rows) {
      if (item.status === 'inactive') counts.inactive++;
      else counts.active++; // a locked user is still active
      if (item.status === 'locked') counts.locked++;
    }
    const tab = query.status && query.status !== 'all' ? (query.status as UserStatus) : null;
    const shown = rows.filter(({ item }) => !tab || (tab === 'active' ? item.status !== 'inactive' : item.status === tab)).map((r) => r.item);
    const start = (query.page - 1) * query.pageSize;
    return toListResponse(shown.slice(start, start + query.pageSize), shown.length, query, counts);
  }

  /** What the A06 filters and the A07 form pick from. */
  async lookups(ctx: RequestContext) {
    const facts = await this.roleFacts(ctx.tenantId);
    const branches = await this.masterData.listBranches(ctx.tenantId);
    return {
      roles: facts.roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        permissions: facts.keys.get(r.code)?.size ?? 0,
        agentScope: r.agentScopeCustomers,
        twoFactor: facts.twoFactorRoles.includes(r.code),
      })),
      branches,
      canEdit: this.canEdit(ctx),
    };
  }

  /** A07 · the user with roles, branches, effective permissions, sign-in and activity. */
  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const user = await this.findUser(ctx, id);
    const rows = roleRows(user);
    const [facts, activity, otherAdmins] = await Promise.all([this.roleFacts(tenantId), this.activity.listFor(tenantId, CONFIG_ENTITY.USER, id), this.otherAdmins(tenantId, id)]);
    const counting = rows.filter((r) => roleCounts(r, today));
    const effective = new Set(counting.flatMap((r) => [...(facts.keys.get(r.roleCode) ?? [])]));
    const agentRoles = user.roles.filter((r) => r.role.agentScopeCustomers && roleCounts(rows.find((x) => x.roleCode === r.role.code)!, today)).map((r) => r.role.name);
    const customers = agentRoles.length ? (await this.masterData.listCustomers(tenantId)).filter((c) => c.defaultAgentCode === user.code).map((c) => c.code) : [];
    const { codes, defaultBranch } = branchesOf(user);
    const state = this.twoFactor(user, facts.twoFactorRoles, today);
    const status = userStatus(user.isActive, user.lockedUntil, new Date());
    const canEdit = this.canEdit(ctx);
    const refusal = user.isActive ? deactivateRefusal(user.id === ctx.user.id, user.name, holdsAdminForGood(rows, today) && otherAdmins === 0) : null;
    return {
      id: user.id,
      code: user.code,
      name: user.name,
      email: user.email,
      jobTitle: user.jobTitle,
      department: user.department,
      isActive: user.isActive,
      version: user.version,
      status,
      statusLabel: STATUS_LABEL[status],
      subtitle: userSubtitle(user.name, user.jobTitle, codes),
      roles: user.roles.map((r, i) => ({
        roleId: r.role.id,
        roleCode: r.role.code,
        name: r.role.name,
        validFrom: rows[i]!.validFrom,
        validUntil: rows[i]!.validUntil,
        permissions: facts.keys.get(r.role.code)?.size ?? 0,
        counts: roleCounts(rows[i]!, today),
      })),
      rolesNote: rolesNote(user.name, agentRoles, customers),
      branches: codes,
      defaultBranch,
      branchNote: branchNote(codes, defaultBranch),
      effective: { permissions: effective.size, roles: counting.length, text: effectiveText(effective.size, counting.length) },
      signIn: {
        twoFactor: state,
        twoFactorText: state === 'NOT_REQUIRED' ? 'Not required by their roles' : TWO_FACTOR_TEXT[state],
        lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
        failedSignIns: user.failedSignIns,
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
      },
      activity,
      allowedActions: canEdit ? ['edit', user.isActive ? 'deactivate' : 'activate'] : [],
      refusals: { deactivate: refusal },
    };
  }
}
