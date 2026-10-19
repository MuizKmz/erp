import { buySoonNote, nextDueDate, pickBuySoon, stockCover, supplierLine } from './dashboard.rules';

describe('nextDueDate — "163 units · next due 30 Sep" on 29 Sep', () => {
  const waiting = [
    { docNo: 'PO-L-0879', expectedDate: '2026-09-29', beingReceived: true }, // arrived today, being counted
    { docNo: 'PO-0001', expectedDate: '2026-09-30', beingReceived: false },
    { docNo: 'PO-L-0882', expectedDate: '2026-10-02', beingReceived: false },
    { docNo: 'PO-0004', expectedDate: '2026-10-05', beingReceived: false },
    { docNo: 'PO-L-0861', expectedDate: '2026-09-17', beingReceived: false }, // late
  ];

  it('skips orders being counted and late orders', () => {
    expect(nextDueDate(waiting, '2026-09-29')).toBe('2026-09-30');
  });

  it('counts an order due today that is not being received yet', () => {
    expect(nextDueDate([{ docNo: 'X', expectedDate: '2026-09-29', beingReceived: false }], '2026-09-29')).toBe('2026-09-29');
  });

  it('is null when nothing is due', () => {
    expect(nextDueDate([{ docNo: 'X', expectedDate: null, beingReceived: false }], '2026-09-29')).toBeNull();
  });
});

describe('pickBuySoon — the Buy soon card on 29 Sep (PurHome)', () => {
  // What the demand list says must be bought on 29 Sep.
  const lines = [
    { itemCode: 'CH-DIN-01', reason: 'SALES_ORDER' as const, onHand: '0.0000', reorderLevel: '50.0000', salesNeed: '40.0000' },
    { itemCode: 'SC-WOD-08', reason: 'BELOW_REORDER' as const, onHand: '5.0000', reorderLevel: '20.0000', salesNeed: '0.0000' },
    { itemCode: 'TB-DIN-06', reason: 'BELOW_REORDER' as const, onHand: '4.0000', reorderLevel: '5.0000', salesNeed: '0.0000' },
    { itemCode: 'VR-LAC-01', reason: 'BELOW_REORDER' as const, onHand: '3.0000', reorderLevel: '10.0000', salesNeed: '0.0000' },
  ];

  it('takes the three closest to running out and lists them as PurHome does', () => {
    expect(pickBuySoon(lines).map((l) => l.itemCode)).toEqual(['SC-WOD-08', 'VR-LAC-01', 'CH-DIN-01']);
  });

  it('measures stock against the reorder level plus open sales orders', () => {
    expect(lines.map((l) => `${l.itemCode} ${stockCover(l).toString()}`)).toEqual(['CH-DIN-01 0', 'SC-WOD-08 0.25', 'TB-DIN-06 0.8', 'VR-LAC-01 0.3']);
    expect(stockCover({ itemCode: 'X', reason: 'SALES_ORDER', onHand: '30', reorderLevel: null, salesNeed: '40' }).toString()).toBe('0.75');
  });

  it('keeps a sales order waiting on an empty shelf ahead of an item one below its level', () => {
    const nearlyFull = { itemCode: 'AA-TOP-01', reason: 'BELOW_REORDER' as const, onHand: '9', reorderLevel: '10', salesNeed: '0' };
    expect(pickBuySoon([nearlyFull, ...lines], 1).map((l) => l.itemCode)).toEqual(['CH-DIN-01']);
  });

  it('breaks a tie by code and shows fewer when fewer need buying', () => {
    const same = { reason: 'BELOW_REORDER' as const, onHand: '1', reorderLevel: '4', salesNeed: '0' };
    expect(pickBuySoon([{ itemCode: 'B', ...same }, { itemCode: 'A', ...same }, { itemCode: 'C', ...same }], 2).map((l) => l.itemCode)).toEqual(['A', 'B']);
    expect(pickBuySoon(lines.slice(0, 1))).toHaveLength(1);
  });

  it('says why an item is on the buy-soon card', () => {
    expect(buySoonNote({ onHand: '5.0000', reorderLevel: '20.0000', reason: 'BELOW_REORDER', salesOrders: [] })).toBe('5 left · reorder 20');
    expect(buySoonNote({ onHand: '0', reorderLevel: '10', reason: 'SALES_ORDER', salesOrders: [{ soNo: 'SO-0001', qty: '40.0000' }] })).toBe('0 left · SO-0001 needs 40');
  });

  it('names the supplier line on the recent orders card', () => {
    expect(supplierLine({ supplierName: 'Perabot Kayu Timur', salesOrderNo: 'SO-0003', isMigrated: false })).toBe('Perabot Kayu Timur · for SO-0003');
    expect(supplierLine({ supplierName: 'Cat Warna Sdn Bhd', salesOrderNo: null, isMigrated: true })).toBe('Cat Warna Sdn Bhd · migrated');
  });
});
