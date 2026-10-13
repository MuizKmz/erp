import { draftRemark, planBuyToOrder, readReleasedSalesOrder, type PlanItem, type ReleasedSalesOrder } from './buy-to-order.rules';

const order: ReleasedSalesOrder = {
  soNo: 'SO-0009',
  branchCode: 'HQ',
  customerName: 'Hotel Seri Bayu Sdn Bhd',
  warehouseCode: 'HQ-MAIN',
  docDate: '2026-09-29',
  total: '70400.00',
  deliveryWantedBy: '2026-10-30',
  lines: [
    { lineNo: 1, itemCode: 'SF-CUS-03', uomCode: 'PCS', qty: '20.0000', isBuyToOrder: true },
    { lineNo: 2, itemCode: 'CH-DIN-01', uomCode: 'PCS', qty: '40.0000', isBuyToOrder: false },
  ],
};
const items: PlanItem[] = [
  { code: 'SF-CUS-03', status: 'ACTIVE', isPurchasable: true, preferredSupplierCode: 'S-0047', uomCode: 'PCS' },
  { code: 'TB-DIN-06', status: 'ACTIVE', isPurchasable: true, preferredSupplierCode: 'S-0021', uomCode: 'PCS' },
  { code: 'XX-NOSUP', status: 'ACTIVE', isPurchasable: true, preferredSupplierCode: null, uomCode: 'PCS' },
  { code: 'XX-OLD', status: 'DISCONTINUED', isPurchasable: true, preferredSupplierCode: 'S-0047', uomCode: 'PCS' },
  { code: 'XX-BOX', status: 'ACTIVE', isPurchasable: true, preferredSupplierCode: 'S-0047', uomCode: 'BOX' },
];
const suppliers = [
  { code: 'S-0047', name: 'Perabot Kayu Timur', status: 'ACTIVE' },
  { code: 'S-0021', name: 'Kilang Kayu Jati', status: 'BLOCKED' },
];
const base = {
  order,
  items,
  suppliers,
  onlyActiveSuppliers: true,
  contracts: [{ itemCode: 'SF-CUS-03', supplierCode: 'S-0047', unitPrice: '2100.0000' }],
  lastPrices: new Map<string, string>(),
  existing: new Map<string, string>(),
};

describe('buy-to-order rules (S10)', () => {
  it('drafts only the buy-to-order lines, at the contract price', () => {
    const plan = planBuyToOrder(base);
    expect(plan.drafts).toEqual([
      { supplierCode: 'S-0047', lines: [{ soLineNo: 1, itemCode: 'SF-CUS-03', qty: '20.0000', unitPrice: '2100.0000', priceFrom: 'CONTRACT' }] },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('falls back to the last price paid, then to none', () => {
    const last = planBuyToOrder({ ...base, contracts: [], lastPrices: new Map([['SF-CUS-03', '2050.0000']]) });
    expect(last.drafts[0]!.lines[0]).toMatchObject({ unitPrice: '2050.0000', priceFrom: 'LAST' });
    const none = planBuyToOrder({ ...base, contracts: [] });
    expect(none.drafts[0]!.lines[0]).toMatchObject({ unitPrice: '0', priceFrom: 'NONE' });
  });

  it('groups lines of the same supplier into one PO', () => {
    const two = { ...order, lines: [order.lines[0]!, { lineNo: 3, itemCode: 'SF-CUS-03', uomCode: 'PCS', qty: '5.0000', isBuyToOrder: true }] };
    const plan = planBuyToOrder({ ...base, order: two });
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]!.lines.map((l) => l.soLineNo)).toEqual([1, 3]);
  });

  it('skips lines it cannot draft, with the reason', () => {
    const bad = {
      ...order,
      lines: [
        { lineNo: 1, itemCode: 'XX-NOSUP', uomCode: 'PCS', qty: '1.0000', isBuyToOrder: true },
        { lineNo: 2, itemCode: 'XX-OLD', uomCode: 'PCS', qty: '1.0000', isBuyToOrder: true },
        { lineNo: 3, itemCode: 'TB-DIN-06', uomCode: 'PCS', qty: '1.0000', isBuyToOrder: true },
        { lineNo: 4, itemCode: 'NOT-IN-MDM', uomCode: 'PCS', qty: '1.0000', isBuyToOrder: true },
      ],
    };
    expect(planBuyToOrder({ ...base, order: bad }).skipped.map((s) => s.reason)).toEqual([
      'XX-NOSUP has no preferred supplier in Master Data.',
      'XX-OLD is not an active purchasable item in Master Data.',
      'Kilang Kayu Jati is blocked in Master Data. Only active suppliers can be used.',
      'NOT-IN-MDM is not an active purchasable item in Master Data.',
    ]);
    // With the "only active suppliers" switch off, the blocked supplier can be used.
    expect(planBuyToOrder({ ...base, order: bad, onlyActiveSuppliers: false }).drafts.map((d) => d.supplierCode)).toEqual(['S-0021']);
  });

  it('leaves a line sold in another unit to the buyer, instead of drafting the wrong quantity', () => {
    const boxes = { ...order, lines: [{ lineNo: 1, itemCode: 'XX-BOX', uomCode: 'PCS', qty: '24.0000', isBuyToOrder: true }] };
    const plan = planBuyToOrder({ ...base, order: boxes });
    expect(plan.drafts).toEqual([]);
    expect(plan.skipped).toEqual([{ soLineNo: 1, itemCode: 'XX-BOX', reason: 'XX-BOX is sold in PCS but bought in BOX. The buyer raises this PO by hand.' }]);
    // An older event without the unit is drafted as before.
    expect(planBuyToOrder({ ...base, order: { ...boxes, lines: [{ ...boxes.lines[0]!, uomCode: '' }] } }).drafts).toHaveLength(1);
  });

  it('never drafts a second PO for a line already ordered for this sales order', () => {
    const plan = planBuyToOrder({ ...base, existing: new Map([['SF-CUS-03', 'PO-0003']]) });
    expect(plan.drafts).toEqual([]);
    expect(plan.alreadyOrdered).toEqual([{ soLineNo: 1, itemCode: 'SF-CUS-03', poNo: 'PO-0003' }]);
  });

  it('reads the event payload and ignores anything unusable', () => {
    expect(readReleasedSalesOrder({ ...order, lines: [...order.lines, { lineNo: 'x' }] })).toEqual(order);
    expect(readReleasedSalesOrder({ soNo: 'SO-0009' })).toBeNull();
    expect(readReleasedSalesOrder(null)).toBeNull();
    // Older events carry no warehouse, order date or total.
    const { warehouseCode: _w, docDate: _d, total: _t, ...old } = order;
    expect(readReleasedSalesOrder(old)).toMatchObject({ warehouseCode: null, docDate: null, total: null });
  });

  it('tells the buyer where the prices came from', () => {
    const plan = planBuyToOrder(base);
    expect(draftRemark('SO-0009', plan.drafts[0]!.lines)).toBe('Buy to order for SO-0009. Contract price, no RFQ needed.');
    const none = planBuyToOrder({ ...base, contracts: [] });
    expect(draftRemark('SO-0009', none.drafts[0]!.lines)).toBe('Buy to order for SO-0009. No contract or last price for SF-CUS-03: enter the price before submitting.');
  });
});
