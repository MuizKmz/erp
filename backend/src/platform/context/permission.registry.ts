import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasPermission, permissionsOf, type RoleGrants } from './permission.rules';

export { ADMIN_ROLE } from './permission.rules';

/** Changes made outside this server (a reseed, another server) are picked up within this time. */
const MAX_AGE_MS = 30_000;

/**
 * Which role may do what, read from the roles Configuration keeps (sys_role_permission). Cached; the auth guard calls
 * refresh() before the permission check, and a role change calls invalidate(), so it applies on the next request.
 * ADMIN holds every permission. One tenant per server for now (SDD ADR-05 leaves the topology open).
 */
@Injectable()
export class PermissionRegistry {
  private grants: RoleGrants = new Map();
  private tenantId: string | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  /** Bumped by invalidate(), so a load that started before a role change does not count as fresh. */
  private generation = 0;

  constructor(private readonly prisma: PrismaService) {}

  async refresh(tenantId: string): Promise<void> {
    if (this.tenantId === tenantId && Date.now() - this.loadedAt < MAX_AGE_MS) return;
    this.loading ??= this.load(tenantId).finally(() => (this.loading = null));
    await this.loading;
  }

  invalidate(): void {
    this.generation++;
    this.loadedAt = 0;
  }

  has(roles: string[], permission: string): boolean {
    return hasPermission(this.grants, roles, permission);
  }

  /** Sorted list for the /me endpoint. ADMIN gets ["*"]. */
  permissionsFor(roles: string[]): string[] {
    return permissionsOf(this.grants, roles);
  }

  private async load(tenantId: string): Promise<void> {
    const generation = this.generation;
    const rows = await this.prisma.sysRolePermission.findMany({ where: { tenantId }, select: { permission: true, role: { select: { code: true } } } });
    const grants = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = grants.get(row.role.code) ?? new Set<string>();
      set.add(row.permission);
      grants.set(row.role.code, set);
    }
    this.grants = grants;
    this.tenantId = tenantId;
    this.loadedAt = generation === this.generation ? Date.now() : 0;
  }
}
