/** Holds every permission without any rows, and cannot be changed (CLAUDE.md → Phase 4, rule 2). */
export const ADMIN_ROLE = 'ADMIN';

/** Role code → the permission keys it gives. */
export type RoleGrants = ReadonlyMap<string, ReadonlySet<string>>;

/** One permission a module declares, with the labels the role editor shows: "Purchase order" · "Release". */
export interface PermissionDef {
  key: string;
  object: string;
  action: string;
}

/** What a module declares about its permissions (SRS FR-SEC-010). The platform aggregates them; it knows no business rules. */
export interface ModulePermissions {
  /** purchase, sales, core, config: every key starts with it */
  module: string;
  label: string;
  /** The permission that opens the module. The Auditor starter role gets every module's. */
  viewKey: string;
  permissions: PermissionDef[];
  /** Role code → keys of this module the starter role gets. */
  starterGrants: Record<string, string[]>;
}

/** The user's roles together give the permission. Administrator gives all. */
export function hasPermission(grants: RoleGrants, roles: readonly string[], permission: string): boolean {
  if (roles.includes(ADMIN_ROLE)) return true;
  return roles.some((role) => grants.get(role)?.has(permission) ?? false);
}

/** Sorted sum of the roles' permissions, for /me. Administrator gets ["*"]. */
export function permissionsOf(grants: RoleGrants, roles: readonly string[]): string[] {
  if (roles.includes(ADMIN_ROLE)) return ['*'];
  const all = new Set<string>();
  for (const role of roles) for (const p of grants.get(role) ?? []) all.add(p);
  return [...all].sort();
}

/** Merges role → keys tables into one RoleGrants (rows from the database, or starter grants). */
export function toRoleGrants(...tables: Record<string, readonly string[]>[]): RoleGrants {
  const grants = new Map<string, Set<string>>();
  for (const table of tables) {
    for (const [role, keys] of Object.entries(table)) {
      const set = grants.get(role) ?? new Set<string>();
      for (const key of keys) set.add(key);
      grants.set(role, set);
    }
  }
  return grants;
}

/** Why a module's declaration cannot be accepted, or null. Checked at start-up so a typo fails loudly. */
export function catalogueError(declared: readonly ModulePermissions[], next: ModulePermissions): string | null {
  if (declared.some((m) => m.module === next.module)) return `Permissions for "${next.module}" are already declared`;
  const own = new Set<string>();
  for (const p of next.permissions) {
    if (!p.key.startsWith(`${next.module}.`)) return `${p.key} does not start with "${next.module}."`;
    if (own.has(p.key)) return `${p.key} is declared twice`;
    if (!p.object.trim() || !p.action.trim()) return `${p.key} needs an object and an action label`;
    own.add(p.key);
  }
  if (!own.has(next.viewKey)) return `The view permission ${next.viewKey} is not in the "${next.module}" catalogue`;
  for (const [role, keys] of Object.entries(next.starterGrants)) {
    if (role === ADMIN_ROLE) return `${ADMIN_ROLE} holds every permission already; it takes no starter grants`;
    const unknown = keys.find((k) => !own.has(k));
    if (unknown) return `${role} is granted ${unknown}, which "${next.module}" does not declare`;
  }
  return null;
}
