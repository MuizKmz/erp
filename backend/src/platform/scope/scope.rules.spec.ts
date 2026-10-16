import { scopeWhere, withScope, type ScopeFacts, type ScopeRule } from './scope.rules';

describe('data scope rules (FR-SEC-020 to 033)', () => {
  const po: ScopeRule = { model: 'PurPurchaseOrder', module: 'purchase', branchField: 'branchCode' };
  const customer: ScopeRule = { model: 'MdmCustomer', module: 'core', branchField: 'branchCode', allBranchesField: 'visibleToAllBranches', agent: { kind: 'customer', agentField: 'defaultAgentCode' } };
  const enquiry: ScopeRule = { model: 'SalEnquiry', module: 'sales', branchField: 'branchCode', agent: { kind: 'document', customerField: 'customerCode', ownerField: 'agentCode' } };
  const invoice: ScopeRule = { model: 'SalInvoice', module: 'sales', branchField: 'branchCode', agent: { kind: 'document', customerField: 'customerCode' } };

  const lmy: ScopeFacts = { branches: ['HQ', 'PNG'], userCode: 'LMY', agentCustomers: false, agentDocuments: false, agentCustomerCodes: [] };
  const aina: ScopeFacts = { branches: ['HQ'], userCode: 'AR', agentCustomers: true, agentDocuments: true, agentCustomerCodes: ['C-0012', 'C-0102'] };

  it('limits documents to the user’s branches', () => {
    expect(scopeWhere(po, lmy)).toEqual({ branchCode: { in: ['HQ', 'PNG'] } });
    expect(scopeWhere(po, aina)).toEqual({ branchCode: { in: ['HQ'] } });
  });

  it('shows a customer of another branch when it is visible to all branches, and only an agent’s own customers', () => {
    expect(scopeWhere(customer, lmy)).toEqual({ OR: [{ branchCode: { in: ['HQ', 'PNG'] } }, { visibleToAllBranches: true }] });
    expect(scopeWhere(customer, aina)).toEqual({ AND: [{ OR: [{ branchCode: { in: ['HQ'] } }, { visibleToAllBranches: true }] }, { defaultAgentCode: 'AR' }] });
  });

  it('limits an agent’s sales documents to their customers; an enquiry for a prospect stays with its agent', () => {
    expect(scopeWhere(invoice, aina)).toEqual({ AND: [{ branchCode: { in: ['HQ'] } }, { customerCode: { in: ['C-0012', 'C-0102'] } }] });
    expect(scopeWhere(enquiry, aina)).toEqual({
      AND: [{ branchCode: { in: ['HQ'] } }, { OR: [{ customerCode: { in: ['C-0012', 'C-0102'] } }, { customerCode: null, agentCode: 'AR' }] }],
    });
  });

  it('keeps the two role switches apart (FR-SEC-031)', () => {
    const customersOnly = { ...aina, agentDocuments: false };
    expect(scopeWhere(invoice, customersOnly)).toEqual({ branchCode: { in: ['HQ'] } });
    expect(scopeWhere(customer, { ...aina, agentCustomers: false })).toEqual({ OR: [{ branchCode: { in: ['HQ'] } }, { visibleToAllBranches: true }] });
  });

  it('says nothing for a table without a branch or agent rule', () => {
    expect(scopeWhere({ model: 'X', module: 'm' }, aina)).toBeNull();
  });

  it('adds the scope next to the caller’s where, keeping unique fields on top', () => {
    const scope = { branchCode: { in: ['HQ'] } };
    expect(withScope(undefined, scope)).toEqual(scope);
    expect(withScope({ id: 'x' }, scope)).toEqual({ id: 'x', AND: [scope] });
    expect(withScope({ id: 'x', AND: { status: 'DRAFT' } }, scope)).toEqual({ id: 'x', AND: [{ status: 'DRAFT' }, scope] });
    expect(withScope({ AND: [{ a: 1 }] }, scope)).toEqual({ AND: [{ a: 1 }, scope] });
  });
});
