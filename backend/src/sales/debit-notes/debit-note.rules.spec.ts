import { allowedDebitActions, debitSummary, invoiceProblem } from './debit-note.rules';

describe('debit note rules', () => {
  it('always points to one released invoice (rule 11)', () => {
    expect(invoiceProblem(null)).toBe('Pick the released invoice the charge belongs to.');
    expect(invoiceProblem({ status: 'DRAFT', docNo: 'INV-0004' })).toBe('INV-0004 is not released. A debit note can only add to a released invoice.');
    expect(invoiceProblem({ status: 'RELEASED', docNo: 'INV-0001' })).toBeNull();
  });

  it('names the charge', () => {
    expect(debitSummary([{ itemName: 'Delivery trip, Klang Valley' }])).toBe('Delivery trip, Klang Valley');
    expect(debitSummary([{ itemName: 'Delivery trip' }, { itemName: 'Installation' }])).toBe('Delivery trip and 1 more');
  });

  it('allows changes only on drafts', () => {
    expect(allowedDebitActions({ status: 'DRAFT', isMigrated: false, canEdit: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedDebitActions({ status: 'RELEASED', isMigrated: false, canEdit: true })).toEqual([]);
    expect(allowedDebitActions({ status: 'DRAFT', isMigrated: false, canEdit: false })).toEqual([]);
  });
});
