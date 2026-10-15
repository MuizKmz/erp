import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { changeMessage, diffRecord } from '../../platform/activity/audit.rules';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { CONFIG_ENTITY, CONFIG_EVENT, SECURITY_EVENT } from '../configuration.constants';
import { ConfigRecordsService } from '../shared/config-records.service';
import { SecurityEventsService } from '../shared/security-events.service';
import type { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { branchesOf, roleRows, UsersQuery, type UserRow } from './users.query';
import { branchErrors, deactivateRefusal, holdsAdminForGood, lastAdminRefusal, roleChangeText, roleRowErrors, rolesText, USER_LABELS, type RoleRow } from './users.rules';

type UserFields = Omit<CreateUserDto, 'code'>;

const day = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

/** The user as the audit, the event and the screens read it. */
interface UserView {
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  roles: RoleRow[];
  branches: string[];
  defaultBranch: string | null;
  isActive: boolean;
}

/** A06 and A07: every change in one transaction with its activity line, its config.user.* event and, for roles and status, the security log. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly records: ConfigRecordsService,
    private readonly security: SecurityEventsService,
    private readonly query: UsersQuery,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private viewOf(user: UserRow): UserView {
    const { codes, defaultBranch } = branchesOf(user);
    return { name: user.name, email: user.email, jobTitle: user.jobTitle, department: user.department, roles: roleRows(user), branches: codes, defaultBranch, isActive: user.isActive };
  }

  private viewFrom(dto: UserFields, isActive: boolean): UserView {
    return {
      name: dto.name,
      email: dto.email,
      jobTitle: dto.jobTitle ?? null,
      department: dto.department ?? null,
      roles: dto.roles.map((r) => ({ roleCode: r.roleCode, validFrom: r.validFrom ?? null, validUntil: r.validUntil ?? null })),
      branches: dto.branches,
      defaultBranch: dto.defaultBranch ?? null,
      isActive,
    };
  }

  /** The audit line reads roles with their dates and branches as codes. */
  private auditOf(v: UserView, names: ReadonlyMap<string, string>) {
    return { ...v, roles: rolesText(v.roles, names), branches: v.branches.join(', ') };
  }

  private snapshot(code: string, v: UserView) {
    return { code, ...v, roles: v.roles.map((r) => ({ ...r })) };
  }

  /** Field errors for the person, roles and branches (rules 1, 3 and 4). */
  private async check(ctx: RequestContext, dto: UserFields, before: UserRow | null): Promise<{ errors: FieldError[]; names: Map<string, string> }> {
    const tenantId = ctx.tenantId;
    const [facts, branches, emailOwner] = await Promise.all([
      this.query.roleFacts(tenantId),
      this.masterData.listBranches(tenantId),
      this.prisma.sysUser.findFirst({ where: { tenantId, email: dto.email, ...(before && { id: { not: before.id } }) }, select: { name: true } }),
    ]);
    const errors: FieldError[] = [];
    if (emailOwner) errors.push({ field: 'email', message: `${dto.email} is already the email of ${emailOwner.name}.` });
    errors.push(...roleRowErrors(this.viewFrom(dto, true).roles, facts.names));
    errors.push(...branchErrors(dto.branches, dto.defaultBranch ?? null, new Map(branches.map((b) => [b.code, b])), before ? branchesOf(before).codes : []));
    return { errors, names: facts.names };
  }

  private async writeAssignments(tx: Tx, tenantId: string, userId: string, v: UserView): Promise<void> {
    const [roles, branches] = await Promise.all([
      tx.sysRole.findMany({ where: { tenantId, code: { in: v.roles.map((r) => r.roleCode) } }, select: { id: true, code: true } }),
      tx.sysBranch.findMany({ where: { tenantId, code: { in: v.branches } }, select: { id: true, code: true } }),
    ]);
    const roleId = new Map(roles.map((r) => [r.code, r.id]));
    const branchId = new Map(branches.map((b) => [b.code, b.id]));
    await tx.sysUserRole.deleteMany({ where: { userId } });
    await tx.sysUserBranch.deleteMany({ where: { userId } });
    await tx.sysUserRole.createMany({
      data: v.roles.map((r, sortOrder) => ({ tenantId, userId, roleId: roleId.get(r.roleCode)!, validFrom: day(r.validFrom), validUntil: day(r.validUntil), sortOrder })),
    });
    await tx.sysUserBranch.createMany({ data: v.branches.map((code) => ({ tenantId, userId, branchId: branchId.get(code)!, isDefault: code === v.defaultBranch })) });
  }

  async create(ctx: RequestContext, dto: CreateUserDto) {
    const tenantId = ctx.tenantId;
    const taken = await this.prisma.sysUser.findFirst({ where: { tenantId, code: dto.code }, select: { name: true } });
    const { errors, names } = await this.check(ctx, dto, null);
    if (taken) errors.unshift({ field: 'code', message: `${dto.code} is already the code of ${taken.name}.` });
    if (errors.length) throw new ValidationFailedError(errors);

    const view = this.viewFrom(dto, true);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.sysUser.create({
        data: { tenantId, code: dto.code, name: view.name, email: view.email, jobTitle: view.jobTitle, department: view.department, createdBy: ctx.user.code, updatedBy: ctx.user.code },
      });
      await this.writeAssignments(tx, tenantId, u.id, view);
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.USER,
        entityId: u.id,
        code: u.code,
        action: 'created',
        message: `User ${u.code} created`,
        changes: diffRecord(null, this.auditOf(view, names), USER_LABELS),
        event: CONFIG_EVENT.USER_CREATED,
        snapshot: this.snapshot(u.code, view),
      });
      await this.security.record(tx, ctx, {
        kind: SECURITY_EVENT.USER_CREATED,
        user: { code: u.code, name: u.name },
        message: `${u.name} added with ${rolesText(view.roles, names)}`,
        data: { roles: view.roles.map((r) => ({ ...r })), branches: view.branches },
      });
      return u;
    });
    return this.query.detail(ctx, user.id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateUserDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.findUser(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const { errors, names } = await this.check(ctx, dto, before);
    if (errors.length) throw new ValidationFailedError(errors);

    const was = this.viewOf(before);
    const now = this.viewFrom(dto, before.isActive);
    const today = this.clock.today();
    if (before.isActive && holdsAdminForGood(was.roles, today) && !holdsAdminForGood(now.roles, today)) {
      const refusal = lastAdminRefusal(before.name, false, await this.query.otherAdmins(tenantId, id));
      if (refusal) throw new BusinessRuleError('LAST_ADMINISTRATOR', refusal);
    }
    const changes = diffRecord(this.auditOf(was, names), this.auditOf(now, names), USER_LABELS);
    if (!changes.length) return this.query.detail(ctx, id);

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.sysUser.updateMany({
        where: { id, version: before.version },
        data: { name: now.name, email: now.email, jobTitle: now.jobTitle, department: now.department, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count !== 1) throw new StaleVersionError();
      await this.writeAssignments(tx, tenantId, id, now);
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.USER,
        entityId: id,
        code: before.code,
        action: 'updated',
        message: changeMessage(changes),
        changes,
        event: CONFIG_EVENT.USER_UPDATED,
        snapshot: this.snapshot(before.code, now),
      });
      const roleChange = roleChangeText(was.roles, now.roles, names);
      if (roleChange) {
        await this.security.record(tx, ctx, {
          kind: SECURITY_EVENT.ROLES_CHANGED,
          user: { code: before.code, name: now.name },
          message: `Roles of ${now.name} changed: ${roleChange}`,
          data: { before: was.roles.map((r) => ({ ...r })), after: now.roles.map((r) => ({ ...r })) },
        });
      }
    });
    return this.query.detail(ctx, id);
  }

  /** Deactivating ends the user's sessions (rule 3); nobody deactivates themselves or the last Administrator (rule 2). */
  async setActive(ctx: RequestContext, id: string, active: boolean, version: number) {
    const tenantId = ctx.tenantId;
    const user = await this.query.findUser(ctx, id);
    if (user.version !== version) throw new StaleVersionError();
    if (user.isActive === active) return this.query.detail(ctx, id);
    const view = this.viewOf(user);
    if (!active) {
      const lastAdmin = holdsAdminForGood(view.roles, this.clock.today()) && (await this.query.otherAdmins(tenantId, id)) === 0;
      const refusal = deactivateRefusal(user.id === ctx.user.id, user.name, lastAdmin);
      if (refusal) throw new BusinessRuleError('USER_NEEDED', refusal);
    } else if (!view.roles.length || !view.branches.length) {
      throw new BusinessRuleError('USER_INCOMPLETE', `Give ${user.name} a role and a branch first.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.sysUser.updateMany({ where: { id, version }, data: { isActive: active, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count !== 1) throw new StaleVersionError();
      const ended = active ? 0 : (await tx.sysSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: this.clock.now(), revokedReason: 'DEACTIVATED' } })).count;
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.USER,
        entityId: id,
        code: user.code,
        action: active ? 'activated' : 'deactivated',
        message: `User ${user.code} ${active ? 'activated' : 'deactivated'}`,
        changes: [{ field: 'isActive', label: 'Active', from: active ? 'No' : 'Yes', to: active ? 'Yes' : 'No' }],
        event: CONFIG_EVENT.USER_UPDATED,
        snapshot: this.snapshot(user.code, { ...view, isActive: active }),
      });
      await this.security.record(tx, ctx, {
        kind: active ? SECURITY_EVENT.USER_ACTIVATED : SECURITY_EVENT.USER_DEACTIVATED,
        user: { code: user.code, name: user.name },
        message: active ? `${user.name} activated` : `${user.name} deactivated${ended ? `; ${ended} session${ended === 1 ? '' : 's'} ended` : ''}`,
      });
    });
    return this.query.detail(ctx, id);
  }
}
