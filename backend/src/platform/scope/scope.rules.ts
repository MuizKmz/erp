/**
 * Data scopes (CLAUDE.md → Phase 4 · Data scopes; SRS FR-SEC-020 to 033; SDD 10.3.1). Pure: which rows of a table a
 * user may see, as a Prisma where. Modules describe their tables with a ScopeRule; the platform applies it on every
 * read while a user's request runs (scope.extension.ts).
 */

/** How one table is scoped. Field names are the Prisma model's own. */
export interface ScopeRule {
  /** Prisma model name, e.g. 'PurPurchaseOrder'. */
  model: string;
  /** Module that registered it, for the error when two modules claim one table. */
  module: string;
  /** Branch scope: the row's branch must be one of the user's (documents and customers). */
  branchField?: string;
  /** A row with this flag on is seen from every branch (the customer's *visible to all branches*, FR-SEC-033). */
  allBranchesField?: string;
  /**
   * Sales-agent scope (FR-SEC-030, 031):
   * - `customer`: a customer row, seen when its agent field is the user (the role's *customers* switch).
   * - `document`: a document row, seen when its customer is one of the agent's customers (the role's *documents* switch);
   *   with `ownerField`, a row without a customer (an enquiry for a prospect) is seen by the agent who owns it.
   */
  agent?: { kind: 'customer'; agentField: string } | { kind: 'document'; customerField: string; ownerField?: string };
}

/** What limits the person asking, worked out once per request. */
export interface ScopeFacts {
  /** The user's branches. */
  branches: readonly string[];
  /** The user's code, the agent of their customers. */
  userCode: string;
  /** Any role the user holds today is agent-scoped for customers / for documents (choice 8: any role counts). */
  agentCustomers: boolean;
  agentDocuments: boolean;
  /** The customers whose default agent is the user (only needed with agentDocuments). */
  agentCustomerCodes: readonly string[];
}

type Where = Record<string, unknown>;

/** The filter for one table, or null when nothing limits this user there. */
export function scopeWhere(rule: ScopeRule, facts: ScopeFacts): Where | null {
  const parts: Where[] = [];
  if (rule.branchField) {
    const inBranch = { [rule.branchField]: { in: [...facts.branches] } };
    parts.push(rule.allBranchesField ? { OR: [inBranch, { [rule.allBranchesField]: true }] } : inBranch);
  }
  if (rule.agent?.kind === 'customer' && facts.agentCustomers) {
    parts.push({ [rule.agent.agentField]: facts.userCode });
  }
  if (rule.agent?.kind === 'document' && facts.agentDocuments) {
    const ofTheirCustomers = { [rule.agent.customerField]: { in: [...facts.agentCustomerCodes] } };
    parts.push(rule.agent.ownerField ? { OR: [ofTheirCustomers, { [rule.agent.customerField]: null, [rule.agent.ownerField]: facts.userCode }] } : ofTheirCustomers);
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : { AND: parts };
}

/** Adds the scope to a query's where. Keeps the caller's unique fields at the top, so findUnique still works. */
export function withScope(where: Where | undefined, scope: Where): Where {
  if (!where) return scope;
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, scope] };
}

/** The reads a scope applies to. Writes go through a read first (a record out of scope is never found: 404). */
export const SCOPED_OPERATIONS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
