import { dec } from '../../platform/http/decimal';
import { byReason, isLate, openQuantities, openReason } from './open-orders.rules';

describe('open orders (S05, RPT-024)', () => {
  it('says what an open line waits for, the most blocking first', () => {
    const released = { orderStatus: 'RELEASED', openQty: '24', cancellingQty: '0', waiting: 'READY' as const };
    expect(openReason({ ...released, orderStatus: 'DRAFT' })).toBe('DRAFT'); // SO-0005
    expect(openReason({ ...released, orderStatus: 'PENDING_APPROVAL' })).toBe('APPROVAL'); // SO-0002, SO-0008
    expect(openReason(released)).toBe('READY'); // SO-0007: 24 beds in stock
    expect(openReason({ ...released, orderStatus: 'PARTIAL', openQty: '40', waiting: 'NO_STOCK' })).toBe('NO_STOCK'); // SO-0001
    expect(openReason({ ...released, waiting: 'PURCHASE' })).toBe('PURCHASE'); // SO-0003, buy to order
  });

  it('shows a balance a draft cancel order takes in full as being cancelled, and a part of it as still waiting', () => {
    const so6 = { orderStatus: 'PARTIAL', openQty: '15', waiting: 'NO_STOCK' as const };
    expect(openReason({ ...so6, cancellingQty: '15' })).toBe('CANCELLING'); // CO-0002 takes all 15
    expect(openReason({ ...so6, cancellingQty: '5' })).toBe('NO_STOCK');
  });

  it('keeps a line that is fully delivered but not invoiced, waiting for its invoice', () => {
    const done = openQuantities({ orderedQty: '12', deliveredQty: '12', invoicedQty: '0', cancelledQty: '0' });
    expect([done.open.toString(), done.toInvoice.toString()]).toEqual(['0', '12']);
    expect(openReason({ orderStatus: 'DONE', openQty: '0', cancellingQty: '0', waiting: 'READY' })).toBe('TO_INVOICE');
  });

  it('works out what is left to deliver and to invoice, never below 0', () => {
    const so1 = openQuantities({ orderedQty: '100.0000', deliveredQty: '60.0000', invoicedQty: '60.0000', cancelledQty: '0.0000' });
    expect([so1.open.toString(), so1.toInvoice.toString()]).toEqual(['40', '0']);
    const over = openQuantities({ orderedQty: '10', deliveredQty: '10', invoicedQty: '12', cancelledQty: '2' });
    expect([over.open.toString(), over.toInvoice.toString()]).toEqual(['0', '0']);
  });

  it('calls an order late once its promised date, or its wanted-by date without one, has passed', () => {
    expect(isLate({ promisedDate: '2026-10-05', wantedBy: '2026-10-12' }, '40', '2026-09-29')).toBe(false);
    expect(isLate({ promisedDate: '2026-09-20', wantedBy: null }, '40', '2026-09-29')).toBe(true);
    expect(isLate({ promisedDate: null, wantedBy: '2026-09-25' }, '40', '2026-09-29')).toBe(true);
    expect(isLate({ promisedDate: '2026-09-20', wantedBy: null }, '0', '2026-09-29')).toBe(false);
  });

  it('adds up what is still to deliver per reason, in the order of the chart', () => {
    const lines = [
      { reason: 'NO_STOCK' as const, openValue: dec('11000.00') },
      { reason: 'APPROVAL' as const, openValue: dec('49115.00') },
      { reason: 'APPROVAL' as const, openValue: dec('43263.00') },
      { reason: 'READY' as const, openValue: dec('36960.00') },
    ];
    expect(byReason(lines).map((r) => `${r.label} ${r.amount.toFixed(2)} ${r.lines}`)).toEqual([
      'Waiting for approval 92378.00 2',
      'Waiting for stock 11000.00 1',
      'Ready to deliver 36960.00 1',
    ]);
  });
});
