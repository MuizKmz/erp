import { allowedCancelOrderActions, cancelQtyProblems, poAfterCancel } from './cancel-order.rules';

describe('cancel-order.rules', () => {
  describe('rule 8: buyers draft, only the Purchasing Manager releases', () => {
    const base = { status: 'DRAFT' as const, isMigrated: false, canEdit: true, canRelease: false };
    it('lets a buyer edit and delete but not release', () => {
      expect(allowedCancelOrderActions(base)).toEqual(['edit', 'delete']);
    });
    it('lets the Purchasing Manager release', () => {
      expect(allowedCancelOrderActions({ ...base, canRelease: true })).toEqual(['edit', 'delete', 'release']);
    });
    it('locks released and migrated cancellations', () => {
      expect(allowedCancelOrderActions({ ...base, status: 'RELEASED', canRelease: true })).toEqual([]);
      expect(allowedCancelOrderActions({ ...base, isMigrated: true, canRelease: true })).toEqual([]);
    });
  });

  describe('cancel quantity', () => {
    it('allows up to the open balance (PCO-0001: 10 of 10)', () => {
      expect(cancelQtyProblems([{ index: 0, open: '10', cancel: '10' }])).toEqual([]);
    });
    it('refuses more than open, naming it', () => {
      expect(cancelQtyProblems([{ index: 0, open: '10', cancel: '11' }])).toEqual([
        { field: 'lines[0].cancelQty', message: 'Only the part not yet received can be cancelled (10 open).' },
      ]);
    });
    it('needs something to cancel', () => {
      expect(cancelQtyProblems([{ index: 0, open: '10', cancel: '0' }])[0]?.field).toBe('lines');
    });
  });

  describe('PO after release', () => {
    it('closes as Done · balance cancelled when part was received (PO-L-0861)', () => {
      expect(poAfterCancel('PARTIAL', [{ orderedQty: '30', receivedQty: '20', cancelledQty: '10' }])).toEqual({ status: 'DONE', balanceCancelled: true });
    });
    it('is Cancelled when nothing was ever received (whole order)', () => {
      expect(poAfterCancel('RELEASED', [{ orderedQty: '50', receivedQty: '0', cancelledQty: '50' }])).toEqual({ status: 'CANCELLED', balanceCancelled: false });
    });
    it('keeps its status when something is still open', () => {
      expect(poAfterCancel('PARTIAL', [{ orderedQty: '100', receivedQty: '95', cancelledQty: '2' }])).toEqual({ status: 'PARTIAL', balanceCancelled: false });
    });
  });
});
