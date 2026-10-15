import { Injectable } from '@nestjs/common';
import { changeMessage, diffRecord, type FieldChange } from '../../platform/activity/audit.rules';
import { PermissionCatalogue } from '../../platform/context/permission-catalogue';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import { ADMIN_ROLE } from '../../platform/context/permission.rules';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { CONFIG_ENTITY, CONFIG_EVENT, SECURITY_EVENT } from '../configuration.constants';
import { ConfigRecordsService } from '../shared/config-records.service';
import { SecurityEventsService } from '../shared/security-events.service';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesQuery, type RoleRow } from './roles.query';
import { ADMIN_LOCKED, deleteRoleRefusal, permissionChangeText, permissionDiff, ROLE_LABELS, STARTER_ROLES, starterPermissions, unknownKeys } from './roles.rules';

interface RoleView {
  name: string;
  description: string | null;
  agentScopeCustomers: boolean;
  agentScopeDocuments: boolean;
  permissions: string[];
}

/**
 * A08, A09: every role change in one transaction with its activity line, config.role.updated and a security-log entry;
 * afterwards the permission registry is cleared, so the change applies on the next request.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: ConfigRecordsService,
    private readonly security: SecurityEventsService,
    private readonly registry: PermissionRegistry,
    private readonly catalogue: PermissionCatalogue,
    private readonly query: RolesQuery,
  ) {}

  private viewOf(role: RoleRow): RoleView {
    return {
      name: role.name,
      description: role.description,
      agentScopeCustomers: role.agentScopeCustomers,
      agentScopeDocuments: role.agentScopeDocuments,
      permissions: this.query.keysOf(role),
    };
  }

  private snapshot(code: string, v: RoleView) {
    return { code, ...v };
  }

  /** The changed fields, and the permissions as a count with the keys added and removed kept beside it. */
  private changesOf(before: RoleView | null, after: RoleView): { changes: FieldChange[]; permissionText: string | null } {
    const fields = diffRecord(before as unknown as Record<string, unknown> | null, after as unknown as Record<string, unknown>, { name: ROLE_LABELS.name!, description: ROLE_LABELS.description!, agentScopeCustomers: ROLE_LABELS.agentScopeCustomers!, agentScopeDocuments: ROLE_LABELS.agentScopeDocuments! });
    const { added, removed } = permissionDiff(before?.permissions ?? [], after.permissions, this.query.orderedKeys());
    const permissionText = permissionChangeText(added, removed, (k) => this.query.label(k));
    const changes = [...fields, ...(permissionText ? [{ field: 'permissions', label: ROLE_LABELS.permissions!, from: String(before?.permissions.length ?? 0), to: String(after.permissions.length) }] : [])];
    return { changes, permissionText };
  }

  private message(fields: FieldChange[], permissionText: string | null): string {
    const others = fields.filter((c) => c.field !== 'permissions');
    return [others.length ? changeMessage(others) : null, permissionText ? `Permissions: ${permissionText}` : null].filter((p) => p).join('; ');
  }

  /** Name free, keys from the catalogue (rule 5). */
  private async check(ctx: RequestContext, name: string, keys: string[], selfId: string | null): Promise<FieldError[]> {
    const errors: FieldError[] = [];
    const clash = await this.prisma.sysRole.findFirst({ where: { tenantId: ctx.tenantId, name, ...(selfId && { id: { not: selfId } }) }, select: { code: true } });
    if (clash) errors.push({ field: 'name', message: `${name} is already the name of role ${clash.code}.` });
    const unknown = unknownKeys(keys, this.catalogue.keys());
    if (unknown.length) errors.push({ field: 'permissions', message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a permission' : 'are not permissions'} any module declares.` });
    return errors;
  }

  private async writePermissions(tx: Tx, tenantId: string, roleId: string, keys: string[]): Promise<void> {
    await tx.sysRolePermission.deleteMany({ where: { roleId } });
    if (keys.length) await tx.sysRolePermission.createMany({ data: keys.map((permission) => ({ tenantId, roleId, permission })) });
  }

  async create(ctx: RequestContext, dto: CreateRoleDto) {
    const tenantId = ctx.tenantId;
    const [taken, used] = await Promise.all([
      this.prisma.sysRole.findFirst({ where: { tenantId, code: dto.code }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CONFIG_ENTITY.ROLE, docNo: dto.code, action: 'deleted' } }),
    ]);
    const errors = await this.check(ctx, dto.name, dto.permissions, null);
    if (taken) errors.unshift({ field: 'code', message: `${dto.code} is already the code of ${taken.name}.` });
    else if (used) errors.unshift({ field: 'code', message: `${dto.code} was used by a deleted role. A code is never used again.` });
    if (errors.length) throw new ValidationFailedError(errors);

    const order = this.query.orderedKeys();
    const view: RoleView = {
      name: dto.name,
      description: dto.description ?? null,
      agentScopeCustomers: dto.agentScopeCustomers,
      agentScopeDocuments: dto.agentScopeDocuments,
      permissions: order.filter((k) => dto.permissions.includes(k)),
    };
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.sysRole.create({
        data: { tenantId, code: dto.code, name: view.name, description: view.description, agentScopeCustomers: view.agentScopeCustomers, agentScopeDocuments: view.agentScopeDocuments, createdBy: ctx.user.code, updatedBy: ctx.user.code },
      });
      await this.writePermissions(tx, tenantId, r.id, view.permissions);
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.ROLE,
        entityId: r.id,
        code: r.code,
        action: 'created',
        message: `Role ${r.code} created with ${view.permissions.length} permission${view.permissions.length === 1 ? '' : 's'}`,
        changes: this.changesOf(null, view).changes,
        event: CONFIG_EVENT.ROLE_UPDATED,
        snapshot: this.snapshot(r.code, view),
      });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.ROLE_CHANGED, user: { code: r.code, name: r.name }, message: `Role ${r.name} created with ${view.permissions.length} permissions` });
      return r;
    });
    this.registry.invalidate();
    return this.query.detail(ctx, role.id);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateRoleDto) {
    const before = await this.query.findRole(ctx, id);
    if (before.code === ADMIN_ROLE) throw new BusinessRuleError('ADMINISTRATOR_LOCKED', ADMIN_LOCKED);
    if (before.version !== dto.version) throw new StaleVersionError();
    const errors = await this.check(ctx, dto.name, dto.permissions, id);
    if (errors.length) throw new ValidationFailedError(errors);

    const order = this.query.orderedKeys();
    const was = this.viewOf(before);
    const now: RoleView = {
      name: dto.name,
      description: dto.description ?? null,
      agentScopeCustomers: dto.agentScopeCustomers,
      agentScopeDocuments: dto.agentScopeDocuments,
      permissions: order.filter((k) => dto.permissions.includes(k)),
    };
    await this.save(ctx, before, was, now, 'updated');
    return this.query.detail(ctx, id);
  }

  /** Back to the module grants it started with, and its starter data scope (choice 5). */
  async resetToStarter(ctx: RequestContext, id: string, version: number) {
    const before = await this.query.findRole(ctx, id);
    if (before.code === ADMIN_ROLE) throw new BusinessRuleError('ADMINISTRATOR_LOCKED', ADMIN_LOCKED);
    const starter = STARTER_ROLES.find((s) => s.code === before.code);
    if (!before.isStarter || !starter) throw new BusinessRuleError('NOT_A_STARTER_ROLE', `${before.name} is not a starter role, so there is nothing to reset it to.`);
    if (before.version !== version) throw new StaleVersionError();
    const was = this.viewOf(before);
    const now: RoleView = { ...was, agentScopeCustomers: !!starter.agentScope, agentScopeDocuments: !!starter.agentScope, permissions: starterPermissions(this.catalogue.modules(), before.code) };
    await this.save(ctx, before, was, now, 'reset');
    return this.query.detail(ctx, id);
  }

  private async save(ctx: RequestContext, before: RoleRow, was: RoleView, now: RoleView, action: 'updated' | 'reset'): Promise<void> {
    const { changes, permissionText } = this.changesOf(was, now);
    if (!changes.length) return;
    const message = this.message(changes, permissionText);
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.sysRole.updateMany({
        where: { id: before.id, version: before.version },
        data: { name: now.name, description: now.description, agentScopeCustomers: now.agentScopeCustomers, agentScopeDocuments: now.agentScopeDocuments, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count !== 1) throw new StaleVersionError();
      await this.writePermissions(tx, ctx.tenantId, before.id, now.permissions);
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.ROLE,
        entityId: before.id,
        code: before.code,
        action,
        message: action === 'reset' ? `Reset to starter: ${message}` : message,
        changes,
        event: CONFIG_EVENT.ROLE_UPDATED,
        snapshot: this.snapshot(before.code, now),
      });
      if (permissionText || was.agentScopeCustomers !== now.agentScopeCustomers || was.agentScopeDocuments !== now.agentScopeDocuments) {
        await this.security.record(tx, ctx, {
          kind: SECURITY_EVENT.ROLE_CHANGED,
          user: { code: before.code, name: now.name },
          message: `Role ${now.name} ${action === 'reset' ? 'reset to starter' : 'changed'}: ${message}`,
          data: { before: was.permissions, after: now.permissions },
        });
      }
    });
    this.registry.invalidate();
  }

  /** Only a custom role nobody holds (rule 4). Its code is never used again. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const role = await this.query.findRole(ctx, id);
    if (role.version !== version) throw new StaleVersionError();
    const refusal = deleteRoleRefusal(role, role.users.map((u) => u.user.code));
    const anyHolder = await this.prisma.sysUserRole.findMany({ where: { roleId: id }, include: { user: { select: { code: true } } } });
    const blocked = refusal ?? (anyHolder.length ? deleteRoleRefusal(role, anyHolder.map((h) => h.user.code)) : null);
    if (blocked) throw new BusinessRuleError('ROLE_IN_USE', blocked);
    const view = this.viewOf(role);
    await this.prisma.$transaction(async (tx) => {
      await tx.sysRole.delete({ where: { id } });
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.ROLE,
        entityId: id,
        code: role.code,
        action: 'deleted',
        message: `Role ${role.code} deleted (nobody held it)`,
        event: CONFIG_EVENT.ROLE_UPDATED,
        snapshot: this.snapshot(role.code, view),
      });
      await this.security.record(tx, ctx, { kind: SECURITY_EVENT.ROLE_CHANGED, user: { code: role.code, name: role.name }, message: `Role ${role.name} deleted` });
    });
    this.registry.invalidate();
    return { deleted: true, code: role.code };
  }
}
