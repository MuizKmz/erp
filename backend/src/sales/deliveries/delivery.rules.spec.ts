import {
  allowedDeliveryActions,
  deliveredPct,
  deliverProblems,
  dueWithin,
  openToDeliver,
  orderStatusAfterDelivery,
  waitingState,
} from './delivery.rules';

const base = { status: 'DRAFT' as const, isMigrated: false, approvalPending: false, creditNeedsApproval: false, approved: false, canEdit: true, canConfirm: true };

describe('delivery rules', () => {
  it('never lets deliver now go over the balance (rule 1)', () => {
    expect(deliverProblems([{ qty: '101', balance: '100' }])).toEqual([{ field: 'lines[0].qty', message: 'Deliver now cannot be more than the balance (100).' }]);
    expect(deliverProblems([{ qty: '60', balance: '100' }])).toEqual([]);
    expect(deliverProblems([{ qty: '0', balance: '100' }])[0]!.field).toBe('lines');
  });

  it('works out the open quantity and the order status after delivery', () => {
    expect(openToDeliver({ orderedQty: '25', deliveredQty: '10', cancelledQty: '15' }).toString()).toBe('0');
    expect(orderStatusAfterDelivery([{ orderedQty: '100', deliveredQty: '60', cancelledQty: '0' }])).toBe('PARTIAL');
    expect(orderStatusAfterDelivery([{ orderedQty: '24', deliveredQty: '24', cancelledQty: '0' }])).toBe('DONE');
  });

  it('offers Create DO only when nothing holds the line (S15)', () => {
    const line = { isBuyToOrder: false, isStock: true, balance: '24', onHand: '24', unpaidProformaNo: null };
    expect(waitingState(line)).toBe('READY');
    expect(waitingState({ ...line, onHand: '0' })).toBe('NO_STOCK');
    expect(waitingState({ ...line, isBuyToOrder: true, onHand: '0' })).toBe('PURCHASE');
    expect(waitingState({ ...line, unpaidProformaNo: 'PF-0004' })).toBe('DEPOSIT');
  });

  it('locks a draft while its credit approval is pending, and needs approval before confirm', () => {
    expect(allowedDeliveryActions(base)).toEqual(['edit', 'delete', 'attach', 'confirm']);
    expect(allowedDeliveryActions({ ...base, creditNeedsApproval: true })).toEqual(['edit', 'delete', 'attach', 'requestApproval']);
    expect(allowedDeliveryActions({ ...base, creditNeedsApproval: true, approved: true })).toContain('confirm');
    expect(allowedDeliveryActions({ ...base, approvalPending: true })).toEqual(['attach']);
    expect(allowedDeliveryActions({ ...base, status: 'CONFIRMED' })).toEqual(['attach']);
    expect(allowedDeliveryActions({ ...base, isMigrated: true })).toEqual([]);
  });

  it('shows progress and due dates', () => {
    expect(deliveredPct('60', '100')).toBe(60);
    expect(dueWithin('2026-10-12', '2026-09-29', 14)).toBe(true);
    expect(dueWithin('2026-10-30', '2026-09-29', 14)).toBe(false);
  });
});
