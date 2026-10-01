import { Injectable } from '@nestjs/common';

export const ADMIN_ROLE = 'ADMIN';

/**
 * Which role may do what. Each module grants its own permissions at start-up
 * (e.g. Purchase: PURCHASE_MANAGER → purchase.cancel_order.release), so the platform knows no business rules.
 * ADMIN holds every permission.
 */
@Injectable()
export class PermissionRegistry {
  private readonly grants = new Map<string, Set<string>>();

  grant(role: string, permissions: string[]): void {
    const set = this.grants.get(role) ?? new Set<string>();
    for (const permission of permissions) set.add(permission);
    this.grants.set(role, set);
  }

  has(roles: string[], permission: string): boolean {
    if (roles.includes(ADMIN_ROLE)) return true;
    return roles.some((role) => this.grants.get(role)?.has(permission) ?? false);
  }

  /** Sorted list for the /me endpoint. ADMIN gets ["*"]. */
  permissionsFor(roles: string[]): string[] {
    if (roles.includes(ADMIN_ROLE)) return ['*'];
    const all = new Set<string>();
    for (const role of roles) for (const p of this.grants.get(role) ?? []) all.add(p);
    return [...all].sort();
  }
}
