import { nextDueDate, pickBuySoon } from './dashboard.rules';

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

describe('pickBuySoon', () => {
  it('lists below-reorder items before sales-order needs, then takes 3', () => {
    const lines = [
      { itemCode: 'TB-DIN-06', reason: 'SALES_ORDER' as const },
      { itemCode: 'CH-DIN-01', reason: 'SALES_ORDER' as const },
      { itemCode: 'VR-LAC-01', reason: 'BELOW_REORDER' as const },
      { itemCode: 'SC-WOD-08', reason: 'BELOW_REORDER' as const },
    ];
    expect(pickBuySoon(lines).map((l) => l.itemCode)).toEqual(['SC-WOD-08', 'VR-LAC-01', 'CH-DIN-01']);
  });
});
