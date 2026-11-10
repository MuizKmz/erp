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
   * The person may narrow this table to one of their own branches with `?branch=` on a read (the Branch picker on the
   * homes and lists). Documents only: a customer keeps its branch scope, so its name never goes missing on a document.
   */
  viewFilter?: boolean;
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
  /** The branch the page asked to show (`?branch=` on a read), for tables with a view filter. Never widens the scope. */
  viewBranch?: string;
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
    const branches = rule.viewFilter && facts.viewBranch ? facts.branches.filter((b) => b === facts.viewBranch) : facts.branches;
    const inBranch = { [rule.branchField]: { in: [...branches] } };
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

/**
 * The branch a request asks to show: the page's own `?branch=HQ` (a list's Branch filter while the top bar shows all
 * branches), else the top bar's choice in the `x-view-branch` header. Nothing when it is not one plain code. Any method:
 * it only ever narrows, and a dashboard's save answers with its charts recalculated for the same branch.
 */
export function viewBranchOf(request: { query?: unknown; headers?: unknown } | undefined): string | undefined {
  const plain = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const fromQuery = plain((request?.query as Record<string, unknown> | undefined)?.branch);
  return fromQuery ?? plain((request?.headers as Record<string, unknown> | undefined)?.['x-view-branch'])?.toUpperCase();
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

/**
 * Reads of one record. The view branch never narrows them: a link to a document of another of the person's branches
 * still opens (their branch scope still applies).
 */
export const SINGLE_RECORD_OPERATIONS: ReadonlySet<string> = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow']);
