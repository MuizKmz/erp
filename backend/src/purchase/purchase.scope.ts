import type { ScopeRule } from '../platform/scope/scope.rules';

/**
 * Purchase's data scope (CLAUDE.md → Phase 4 · Data scopes): every Purchase document is seen only from its own branch's
 * users (SRS FR-SEC-022, 032). Lines are read through their document. Settings and approval rules are not scoped.
 */
const byBranch = (model: string): ScopeRule => ({ model, module: 'purchase', branchField: 'branchCode' });

export const PURCHASE_SCOPE_RULES: readonly ScopeRule[] = [
  'PurRequest',
  'PurRfq',
  'PurPurchaseOrder',
  'PurGoodsReceipt',
  'PurInvoice',
  'PurCancelOrder',
  'PurCashPurchase',
  'PurDebitNote',
  'PurReturn',
  'PurSalesDemand',
].map(byBranch);
