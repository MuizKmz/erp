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
