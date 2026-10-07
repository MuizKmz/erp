import { allocateToLines, buyToOrderStatus, purchaseReady, readBuyToOrderHandled, readPurchaseQtyEvent, type BuyToOrderLine } from './buy-to-order.rules';
import { waitingState } from '../deliveries/delivery.rules';

const line: BuyToOrderLine = {
  isBuyToOrder: true, purchaseOrderNo: 'PO-0003', purchaseProblem: null, orderedQty: '20.0000',
  purchaseReceivedQty: '0', purchaseCancelledQty: '0', uomCode: 'PCS',
};

describe('buy-to-order line status (S10)', () => {
  it('shows nothing for a normal line', () => {
    expect(buyToOrderStatus({ ...line, isBuyToOrder: false })).toBeNull();
  });

  it('follows the PO from drafted to received', () => {
    expect(buyToOrderStatus({ ...line, purchaseOrderNo: null })).toEqual({ state: 'WAITING_PO', label: 'Waiting for Purchase to draft the PO' });
    expect(buyToOrderStatus(line)).toEqual({ state: 'ON_ORDER', label: 'PO-0003' });
    expect(buyToOrderStatus({ ...line, purchaseReceivedQty: '8' })).toEqual({ state: 'PART_RECEIVED', label: 'PO-0003 · 8 of 20 received' });
    expect(buyToOrderStatus({ ...line, purchaseReceivedQty: '20' })).toEqual({ state: 'RECEIVED', label: 'PO-0003 · received' });
  });

  it('counts what the customer cancelled as no longer needed', () => {
    expect(buyToOrderStatus({ ...line, cancelledQty: '5', purchaseReceivedQty: '15' })?.state).toBe('RECEIVED');
  });

  it('says why Purchase did not draft a PO, and when Purchase cancelled the balance', () => {
    expect(buyToOrderStatus({ ...line, purchaseOrderNo: null, purchaseProblem: 'SF-CUS-03 has no preferred supplier in Master Data.' })?.label)
      .toBe('No PO yet: SF-CUS-03 has no preferred supplier in Master Data.');
    expect(buyToOrderStatus({ ...line, purchaseReceivedQty: '8', purchaseCancelledQty: '12' })).toEqual({ state: 'PO_CANCELLED', label: 'PO-0003 · Purchase cancelled 12 PCS' });
  });

  it('counts received but not yet delivered goods as ready on the waiting list', () => {
    expect(purchaseReady({ purchaseReceivedQty: '20', deliveredQty: '5' }).toFixed(0)).toBe('15');
    expect(purchaseReady({ purchaseReceivedQty: '0', deliveredQty: '5' }).toFixed(0)).toBe('0');
    const waiting = { isBuyToOrder: true, isStock: true, balance: '20', onHand: '0', unpaidProformaNo: null };
    expect(waitingState(waiting)).toBe('PURCHASE');
    expect(waitingState({ ...waiting, purchaseReady: '20' })).toBe('READY');
    expect(waitingState({ ...waiting, purchaseReady: '8' })).toBe('PURCHASE');
  });
});

describe('spreading Purchase quantities over order lines', () => {
  const lines = [
    { id: 'a', itemCode: 'SF-CUS-03', orderedQty: '20', current: '0' },
    { id: 'b', itemCode: 'SF-CUS-03', orderedQty: '5', current: '0' },
    { id: 'c', itemCode: 'TB-DIN-06', orderedQty: '4', current: '4' },
  ];
  const added = (r: ReturnType<typeof allocateToLines>) => r.map((x) => [x.id, x.add.toFixed(0)]);

  it('fills lines in order, up to what each ordered', () => {
    expect(added(allocateToLines(lines, [{ itemCode: 'SF-CUS-03', qty: '22' }]))).toEqual([['a', '20'], ['b', '2']]);
    expect(added(allocateToLines(lines, [{ itemCode: 'SF-CUS-03', qty: '8' }]))).toEqual([['a', '8']]);
  });

  it('skips lines already received or cancelled in full (Purchase cancels the rest after a part receipt)', () => {
    const afterReceipt = [
      { id: 'a', itemCode: 'SF-CUS-03', orderedQty: '2', current: '2' },
      { id: 'b', itemCode: 'SF-CUS-03', orderedQty: '3', current: '1' },
    ];
    expect(added(allocateToLines(afterReceipt, [{ itemCode: 'SF-CUS-03', qty: '2' }]))).toEqual([['b', '2']]);
  });

  it('puts anything over on the last line and ignores items not on the order', () => {
    expect(added(allocateToLines(lines, [{ itemCode: 'TB-DIN-06', qty: '1' }, { itemCode: 'XX', qty: '3' }]))).toEqual([['c', '1']]);
    expect(added(allocateToLines(lines, [{ itemCode: 'SF-CUS-03', qty: '30' }]))).toEqual([['a', '20'], ['b', '10']]);
  });

  it('reads Purchase event payloads', () => {
    expect(readBuyToOrderHandled({ soNo: 'SO-0009', lines: [{ soLineNo: 1, itemCode: 'SF-CUS-03', poNo: 'PO-0007', problem: null }, { bad: 1 }] }))
      .toEqual({ soNo: 'SO-0009', lines: [{ soLineNo: 1, itemCode: 'SF-CUS-03', poNo: 'PO-0007', problem: null }] });
    expect(readPurchaseQtyEvent({ grnNo: 'GRN-0005', poNo: 'PO-0007', lines: [{ itemCode: 'SF-CUS-03', uomCode: 'PCS', qty: '20.0000' }] }, 'grnNo'))
      .toEqual({ poNo: 'PO-0007', docNo: 'GRN-0005', lines: [{ itemCode: 'SF-CUS-03', uomCode: 'PCS', qty: '20.0000' }] });
    expect(readPurchaseQtyEvent({ poNo: 'PO-0007' }, 'pcoNo')).toBeNull();
  });
});
