import { Prisma, type PrismaClient } from '@prisma/client';
import type { RequestContext } from '../context/request-context';
import { scopedContext } from './data-scope';
import type { ScopeRegistry } from './scope.registry';
import { SCOPED_OPERATIONS, SINGLE_RECORD_OPERATIONS, scopeWhere, viewBranchOf, withScope, type ScopeFacts } from './scope.rules';

/** The user's limits, read with the plain client (unscoped) so working them out never scopes itself. */
async function factsOf(base: PrismaClient, ctx: RequestContext, viewBranch: string | undefined): Promise<ScopeFacts> {
  const roles = await base.sysRole.findMany({
    where: { tenantId: ctx.tenantId, code: { in: ctx.user.roles } },
    select: { agentScopeCustomers: true, agentScopeDocuments: true },
  });
  const agentCustomers = roles.some((r) => r.agentScopeCustomers);
  const agentDocuments = roles.some((r) => r.agentScopeDocuments);
  const own = agentDocuments
    ? await base.mdmCustomer.findMany({ where: { tenantId: ctx.tenantId, defaultAgentCode: ctx.user.code }, select: { code: true } })
    : [];
  return { branches: ctx.user.branchCodes, viewBranch, userCode: ctx.user.code, agentCustomers, agentDocuments, agentCustomerCodes: own.map((c) => c.code) };
}

/**
 * Applies the registered scope rules on every read of a scoped table while a user's request runs (SDD 10.3.1: in the
 * data-access layer, on every route). Lists, records, look-ups, reports, exports and dashboards all read through here,
 * so a row out of scope is simply not found (404). Writes are not touched: they follow a read of the same record.
 */
export function withDataScope<T extends PrismaClient>(base: T, registry: ScopeRegistry): T {
  return base.$extends(
    Prisma.defineExtension({
      name: 'data-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const rule = SCOPED_OPERATIONS.has(operation) ? registry.ruleFor(model) : undefined;
            const scoped = rule ? scopedContext() : null;
            if (!rule || !scoped) return query(args);
            scoped.store.facts ??= factsOf(base, scoped.context, viewBranchOf(scoped.store.request));
            const facts = await scoped.store.facts;
            const extra = scopeWhere(rule, SINGLE_RECORD_OPERATIONS.has(operation) ? { ...facts, viewBranch: undefined } : facts);
            if (!extra) return query(args);
            const a = (args ?? {}) as { where?: Record<string, unknown> };
            return query({ ...a, where: withScope(a.where, extra) } as typeof args);
          },
        },
      },
    }),
  ) as unknown as T;
}
