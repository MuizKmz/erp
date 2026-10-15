import { ADMIN_ROLE, type ModulePermissions } from '../../platform/context/permission.rules';

export const AUDITOR_ROLE = 'AUDITOR';

/** A role the system starts with (CONFIG_SEED_DATA.md → Roles). Its permissions come from the modules' starter grants. */
export interface StarterRole {
  code: string;
  name: string;
  /** "What it is for" on the role form (A09). */
  description: string;
  /** Sees only customers whose default agent is the user, and their sales documents (A7, FR-SEC-031). */
  agentScope?: boolean;
}

/** The 16 starter roles, by name as the role list shows them (A08). */
export const STARTER_ROLES: readonly StarterRole[] = [
  { code: ADMIN_ROLE, name: 'Administrator', description: 'Everything, in every module. Holds every permission and cannot be changed.' },
  { code: 'AP_CLERK', name: 'AP clerk', description: 'Enters supplier invoices and debit notes, and matches invoices with what was received.' },
  { code: AUDITOR_ROLE, name: 'Auditor', description: 'Looks at every module, the security log and the audit trail. Changes nothing.' },
  { code: 'SALES_BILLING', name: 'Billing', description: 'Invoices, proformas and debit notes; printing and email.' },
  { code: 'BRANCH_MANAGER', name: 'Branch Manager', description: 'Approves purchase orders of their branch above the branch limit.' },
  { code: 'PURCHASE_BUYER', name: 'Buyer', description: 'Requests, RFQs, purchase orders, returns, cash purchases and debit notes; keeps suppliers up to date.' },
  { code: 'COUNTER_STAFF', name: 'Counter staff', description: 'Cash sales at the showroom counter.' },
  { code: 'FINANCE_DIRECTOR', name: 'Finance Director', description: 'Approves purchase orders over RM 50,000.' },
  { code: 'FINANCE_MANAGER', name: 'Finance Manager', description: 'Approves invoices for customers over their credit or overdue limit, and changes customer credit.' },
  { code: 'MASTER_DATA_ADMIN', name: 'Master Data Admin', description: 'Keeps all master data in Core, and imports it.' },
  { code: 'PURCHASE_MANAGER', name: 'Purchasing Manager', description: 'Approves purchase orders, releases cancel orders, and manages Purchase settings and contract prices.' },
  { code: 'REQUESTER', name: 'Requester', description: 'Asks for things to be bought, and records small cash purchases.' },
  { code: 'SALES_AGENT', name: 'Sales agent', description: 'Enquiries, quotations and sales orders for their own customers; drafts cancel orders and returns.', agentScope: true },
  { code: 'SALES_MANAGER', name: 'Sales Manager', description: 'Approves discounts, credit and prices below the list; releases cancel orders; sees margin.' },
  { code: 'SALES_STORE', name: 'Sales store', description: 'Delivery orders and confirming them; receives returned goods.' },
  { code: 'STORE', name: 'Store', description: 'Receives goods against purchase orders, and drafts purchase returns.' },
];

/**
 * The permissions a starter role starts with, in catalogue order: what each module grants it, and for the Auditor
 * every module's view permission too (choice 7). Administrator gets none: it holds every permission without rows.
 */
export function starterPermissions(modules: readonly ModulePermissions[], role: string): string[] {
  if (role === ADMIN_ROLE) return [];
  const keys = new Set(modules.flatMap((m) => m.starterGrants[role] ?? []));
  if (role === AUDITOR_ROLE) for (const m of modules) keys.add(m.viewKey);
  return modules.flatMap((m) => m.permissions.map((p) => p.key)).filter((k) => keys.has(k));
}

/** How many permissions a role gives, as the role list shows it: Administrator holds the whole catalogue. */
export function permissionCount(role: string, held: number, catalogueSize: number): number {
  return role === ADMIN_ROLE ? catalogueSize : held;
}

/** SALES_AGENT, PURCHASE_BUYER, QA_LEAD: capitals, digits and underscores. A code never changes (rule 1). */
export const ROLE_CODE = /^[A-Z][A-Z0-9_]{1,29}$/;

export const ROLE_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'What it is for',
  agentScopeCustomers: 'Customers: own only',
  agentScopeDocuments: 'Sales documents: own customers only',
  permissions: 'Permissions',
};

/** Rule 2: Administrator holds every permission and nobody changes it. */
export const ADMIN_LOCKED = 'Administrator holds every permission and cannot be changed.';

/** Keys no module declares: a role can only hold keys from the catalogue (rule 5). */
export function unknownKeys(keys: readonly string[], catalogue: ReadonlySet<string>): string[] {
  return keys.filter((k) => !catalogue.has(k));
}

/** What a save adds and takes away, in catalogue order. */
export function permissionDiff(before: readonly string[], after: readonly string[], order: readonly string[]): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return { added: order.filter((k) => now.has(k) && !was.has(k)), removed: order.filter((k) => was.has(k) && !now.has(k)) };
}

/** "added See margin (Sales); removed Edit (Sales return)": a permission as the role form labels it. */
export function permissionChangeText(added: readonly string[], removed: readonly string[], label: (key: string) => string): string | null {
  const parts = [...(added.length ? [`added ${added.map(label).join(', ')}`] : []), ...(removed.length ? [`removed ${removed.map(label).join(', ')}`] : [])];
  return parts.length ? parts.join('; ') : null;
}

/** Only a custom role nobody holds can go (rule 4); starter roles stay, so Reset to starter always has something to reset. */
export function deleteRoleRefusal(role: { code: string; name: string; isStarter: boolean }, holders: readonly string[]): string | null {
  if (role.code === ADMIN_ROLE) return ADMIN_LOCKED;
  if (role.isStarter) return `${role.name} is a starter role, so it stays. Take its permissions away or reset it instead.`;
  if (holders.length) return `${role.name} is held by ${holders.length} user${holders.length === 1 ? '' : 's'} (${holders.join(', ')}). Take it away from them first.`;
  return null;
}

/** "Own customers only" or "Their branches", as A08 shows what a role sees. */
export function scopeText(agentScopeCustomers: boolean): string {
  return agentScopeCustomers ? 'Own customers only' : 'Their branches';
}

/** "9 permissions · 3 users · own customers only" under the role title. */
export function roleSubtitle(code: string, permissions: number, users: number, agentScopeCustomers: boolean): string {
  const perms = code === ADMIN_ROLE ? 'All permissions' : `${permissions} permission${permissions === 1 ? '' : 's'}`;
  return `${perms} · ${users} user${users === 1 ? '' : 's'} · ${scopeText(agentScopeCustomers).toLowerCase()}`;
}

/** A10 · the line above two compared roles: what they share, and what each sees. */
export function compareText(a: { name: string; keys: ReadonlySet<string>; agentScope: boolean }, b: { name: string; keys: ReadonlySet<string>; agentScope: boolean }): string {
  const shared = [...a.keys].filter((k) => b.keys.has(k)).length;
  const sees = (agent: boolean) => (agent ? 'only its own customers' : 'all customers in its branches');
  const scope =
    a.agentScope === b.agentScope
      ? `Both see ${a.agentScope ? 'only their own customers' : 'all customers in their branches'}.`
      : `${a.name} sees ${sees(a.agentScope)}; ${b.name} sees ${sees(b.agentScope)}.`;
  return `Both roles give ${shared} permission${shared === 1 ? '' : 's'}. ${scope}`;
}

/** A10 · the line above a person's permissions. */
export function personText(name: string, permissions: number, roles: number, agentRoles: readonly string[]): string {
  const agent = agentRoles.length ? ` ${agentRoles.join(' and ')} ${agentRoles.length === 1 ? 'limits' : 'limit'} them to their own customers.` : '';
  return `${name} holds ${permissions} permission${permissions === 1 ? '' : 's'} from ${roles} role${roles === 1 ? '' : 's'}.${agent}`;
}

export interface CatalogueObject {
  object: string;
  actions: { key: string; action: string }[];
}

/** The catalogue as the role form lays it out: per module, per object, its actions (A09). */
export function groupCatalogue(modules: readonly ModulePermissions[]): { module: string; label: string; objects: CatalogueObject[] }[] {
  return modules.map((m) => {
    const objects: CatalogueObject[] = [];
    for (const p of m.permissions) {
      const last = objects.find((o) => o.object === p.object);
      if (last) last.actions.push({ key: p.key, action: p.action });
      else objects.push({ object: p.object, actions: [{ key: p.key, action: p.action }] });
    }
    return { module: m.module, label: m.label, objects };
  });
}

/** True when the role holds exactly its starter permissions and scope: Reset to starter would change nothing. */
export function isAsStarter(keys: readonly string[], starter: readonly string[], agentScope: { customers: boolean; documents: boolean }, starterAgent: boolean): boolean {
  const a = new Set(keys);
  return a.size === starter.length && starter.every((k) => a.has(k)) && agentScope.customers === starterAgent && agentScope.documents === starterAgent;
}
