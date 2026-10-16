/**
 * A13 · Audit trail (NFR-AUD-001; choices 15, 16): every change in every module, from sys_activity. Pure: how a row's
 * entity type reads on the screen. The trail is read only (rule 9).
 */

export const AUDIT_MODULES = { purchase: 'Purchase', sales: 'Sales', core: 'Core', config: 'Configuration' } as const;
export type AuditModule = keyof typeof AUDIT_MODULES;

/** The table prefix of an entity type tells its module (PUR_ORDER → Purchase). */
const PREFIX: Record<string, AuditModule> = { PUR: 'purchase', SAL: 'sales', MDM: 'core', SYS: 'config' };

export function moduleOf(entityType: string): AuditModule | null {
  return PREFIX[entityType.split('_')[0] ?? ''] ?? null;
}

/** The entity-type prefixes that make up a module, for the Module filter. */
export function prefixOf(module: AuditModule): string {
  return Object.entries(PREFIX).find(([, m]) => m === module)![0] + '_';
}

export interface AuditChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** The before-and-after values kept with an activity line, or none. */
export function changesOf(data: unknown): AuditChange[] {
  const changes = (data as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as { field?: unknown }).field === 'string')
    .map((c) => ({ field: String(c.field), label: String(c.label ?? c.field), from: c.from == null ? null : String(c.from), to: c.to == null ? null : String(c.to) }));
}

/** "7f3c…e21": short enough for a footnote, long enough to tell requests apart. */
export function shortId(id: string | null): string | null {
  return id ? `${id.slice(0, 4)}…${id.slice(-3)}` : null;
}
