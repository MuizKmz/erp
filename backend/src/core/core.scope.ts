import type { ScopeRule } from '../platform/scope/scope.rules';

/**
 * Core's data scope (CLAUDE.md → Phase 4 · Data scopes): a customer is seen from its own branch unless it is visible to
 * all branches (FR-SEC-033), and an agent-scoped user sees only the customers whose default agent they are (FR-SEC-030).
 * Suppliers, items, price lists, tax codes and warehouses are shared master data and are not scoped.
 */
export const CORE_SCOPE_RULES: readonly ScopeRule[] = [
  { model: 'MdmCustomer', module: 'core', branchField: 'branchCode', allBranchesField: 'visibleToAllBranches', agent: { kind: 'customer', agentField: 'defaultAgentCode' } },
];
