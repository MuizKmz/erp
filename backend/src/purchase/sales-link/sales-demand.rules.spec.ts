import { readReleasedSalesOrder } from './buy-to-order.rules';
import { businessDate, demandRowsFromRelease, matchLines, openQty, readLineQtyEvent, toSalesDemand } from './sales-demand.rules';

const released = readReleasedSalesOrder({
  soNo: 'SO-0002', docDate: '2026-09-26', branchCode: 'HQ', customerName: 'Syarikat Delta Trading', total: '4400.00',
  deliveryWantedBy: '2026-10-10', warehouseCode: 'HQ-MAIN',
  lines: [{ lineNo: 1, itemCode: 'CH-DIN-01', uomCode: 'PCS', qty: '16.0000', isBuyToOrder: false }],
})!;

const row = (over: Partial<Parameters<typeof toSalesDemand>[0][number]> = {}) => ({
  soNo: 'SO-0001', soDate: new Date('2026-09-18T00:00:00Z'), customerName: 'Hotel Seri Bayu Sdn Bhd', soTotal: '27500.00', branchCode: 'HQ',
  itemCode: 'CH-DIN-01', orderedQty: '100', deliveredQty: '60', cancelledQty: '0', isBuyToOrder: false, neededBy: new Date('2026-10-12T00:00:00Z'),
  ...over,
});

describe('sales demand rules (P04 from Sales events)', () => {
  it('turns a released order into one demand row per line', () => {
    expect(demandRowsFromRelease(released, '2026-09-29T02:00:00.000Z')).toEqual([{
      soNo: 'SO-0002', soLineNo: 1, soDate: '2026-09-26', customerName: 'Syarikat Delta Trading', soTotal: '4400.00', branchCode: 'HQ',
      itemCode: 'CH-DIN-01', uomCode: 'PCS', orderedQty: '16.0000', isBuyToOrder: false, neededBy: '2026-10-10',
    }]);
  });

  it('falls back to the event day in Kuala Lumpur when an older event has no order date', () => {
    const old = { ...released, docDate: null, total: null };
    // 28 Sep 17:30 UTC is already 29 Sep in Kuala Lumpur.
    expect(demandRowsFromRelease(old, '2026-09-28T17:30:00.000Z')[0]).toMatchObject({ soDate: '2026-09-29', soTotal: '0.00' });
    expect(businessDate('2026-09-28T15:59:00.000Z')).toBe('2026-09-28');
  });

  it('keeps only what is still open, as DIRECT needs', () => {
    expect(openQty(row())).toEqual(openQty({ orderedQty: '40', deliveredQty: '0', cancelledQty: '0' }));
    expect(openQty(row({ deliveredQty: '100' })).toFixed(0)).toBe('0');
    expect(openQty(row({ deliveredQty: '60', cancelledQty: '50' })).toFixed(0)).toBe('0');
    expect(toSalesDemand([row(), row({ soNo: 'SO-0004', deliveredQty: '100' })])).toEqual([{
      soNo: 'SO-0001', soDate: '2026-09-18', customerName: 'Hotel Seri Bayu Sdn Bhd', soTotal: '27500.00', branchCode: 'HQ',
      itemCode: 'CH-DIN-01', qty: '40.0000', kind: 'DIRECT', isBuyToOrder: false, neededBy: '2026-10-12',
    }]);
  });

  it('matches delivery and cancel lines by order line, and reports lines it does not know', () => {
    const rows = [{ id: 'a', soLineNo: 1, itemCode: 'CH-DIN-01' }, { id: 'b', soLineNo: 2, itemCode: 'TB-DIN-06' }];
    const r = matchLines(rows, [{ lineNo: 1, itemCode: 'CH-DIN-01', qty: '40.0000' }, { lineNo: 3, itemCode: 'SF-CUS-03', qty: '1' }]);
    expect(r.updates.map((u) => [u.id, u.add.toFixed(0)])).toEqual([['a', '40']]);
    expect(r.missing).toEqual(['line 3 SF-CUS-03']);
  });

  it('reads a delivery by the order line it delivers, not the delivery order own line number', () => {
    // SO line 1 was delivered earlier, so the next DO holds only SO line 2, as its own line 1.
    const event = { doNo: 'DO-0005', soNo: 'SO-0012', lines: [{ lineNo: 1, soLineNo: 2, itemCode: 'TB-COF-01', uomCode: 'PCS', qty: '1.0000' }, { qty: '1' }] };
    const read = readLineQtyEvent(event, 'soLineNo')!;
    expect(read).toEqual({ soNo: 'SO-0012', lines: [{ lineNo: 2, itemCode: 'TB-COF-01', qty: '1.0000' }] });
    const rows = [{ id: 'a', soLineNo: 1, itemCode: 'CH-BAR-01' }, { id: 'b', soLineNo: 2, itemCode: 'TB-COF-01' }];
    expect(matchLines(rows, read.lines).updates.map((u) => u.id)).toEqual(['b']);
  });

  it('reads cancel events by their line number, and older delivery events by item', () => {
    expect(readLineQtyEvent({ cancelNo: 'CO-0002', soNo: 'SO-0006', lines: [{ lineNo: 1, itemCode: 'CH-OFF-02', qty: '15.0000' }] }, 'lineNo'))
      .toEqual({ soNo: 'SO-0006', lines: [{ lineNo: 1, itemCode: 'CH-OFF-02', qty: '15.0000' }] });
    const old = readLineQtyEvent({ doNo: 'DO-0001', soNo: 'SO-0001', lines: [{ itemCode: 'CH-DIN-01', qty: '60.0000' }] }, 'soLineNo')!;
    expect(old.lines).toEqual([{ lineNo: null, itemCode: 'CH-DIN-01', qty: '60.0000' }]);
    expect(matchLines([{ id: 'a', soLineNo: 1, itemCode: 'CH-DIN-01' }], old.lines).updates.map((u) => u.id)).toEqual(['a']);
    expect(readLineQtyEvent({ cancelNo: 'CO-0002' }, 'lineNo')).toBeNull();
  });
});
