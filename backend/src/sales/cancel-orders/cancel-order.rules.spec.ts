import { allowedCancelActions, cancelProblems, cancelSummary, orderAfterCancel } from './cancel-order.rules';

describe('cancel order rules', () => {
  it('cancels only the undelivered balance (rule 8)', () => {
    expect(cancelProblems([{ qty: '16', balance: '15' }])).toEqual([{ field: 'lines[0].qty', message: 'Cancel now cannot be more than the undelivered balance (15).' }]);
    expect(cancelProblems([{ qty: '15', balance: '15' }])).toEqual([]);
    expect(cancelProblems([{ qty: '0', balance: '15' }])[0]!.field).toBe('lines');
    expect(cancelProblems([{ qty: '0', balance: '15' }], false)).toEqual([]);
  });

  it('describes what is cancelled', () => {
    expect(cancelSummary([{ itemName: 'office chairs', ordered: '25', delivered: '10', cancel: '15' }])).toBe('15 of 25 office chairs');
    expect(cancelSummary([{ itemName: 'stools', ordered: '12', delivered: '0', cancel: '12' }])).toBe('Whole order · 12 stools');
  });

  it('closes the order as Done · balance cancelled when nothing is left to deliver', () => {
    expect(orderAfterCancel('PARTIAL', [{ orderedQty: '25', deliveredQty: '10', cancelledQty: '15' }])).toEqual({ status: 'DONE', balanceCancelled: true });
    expect(orderAfterCancel('RELEASED', [{ orderedQty: '24', deliveredQty: '0', cancelledQty: '4' }])).toEqual({ status: 'RELEASED', balanceCancelled: false });
  });

  it('lets agents draft and only the release permission release', () => {
    expect(allowedCancelActions({ status: 'DRAFT', isMigrated: false, canEdit: true, canRelease: false })).toEqual(['edit', 'delete']);
    expect(allowedCancelActions({ status: 'DRAFT', isMigrated: false, canEdit: true, canRelease: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedCancelActions({ status: 'RELEASED', isMigrated: false, canEdit: true, canRelease: true })).toEqual([]);
  });
});
