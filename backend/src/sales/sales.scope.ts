import type { ScopeRule } from '../platform/scope/scope.rules';

/**
 * Sales' data scope (CLAUDE.md → Phase 4 · Data scopes): every Sales document by its branch (FR-SEC-022, 032) and, for a
 * user whose role is agent-scoped for documents, only the documents of their own customers (FR-SEC-030, 031). An
 * enquiry for a prospect has no customer yet and stays with the agent who owns it. Settings are not scoped.
 */
const document = (model: string, ownerField?: string): ScopeRule => ({
  model,
  module: 'sales',
  branchField: 'branchCode',
  viewFilter: true,
  agent: { kind: 'document', customerField: 'customerCode', ...(ownerField && { ownerField }) },
});

export const SALES_SCOPE_RULES: readonly ScopeRule[] = [
  document('SalEnquiry', 'agentCode'),
  ...['SalQuotation', 'SalSalesOrder', 'SalDelivery', 'SalInvoice', 'SalProforma', 'SalCashSale', 'SalDebitNote', 'SalReturn', 'SalCancelOrder'].map((m) => document(m)),
];
