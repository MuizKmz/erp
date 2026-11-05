import { levelsFromTags, type WmsTag } from './wms-stock.rules';

const tag = (sku: string | null, warehouse: string | null, status = 'INBOUND'): WmsTag => ({
  status,
  product: { skuCode: sku },
  warehouse: warehouse ? { warehouseCode: warehouse } : null,
});
const AS_OF = '2026-11-05T00:00:00.000Z';

describe('levelsFromTags', () => {
  it('counts one unit per tag, by item and warehouse', () => {
    expect(levelsFromTags([tag('ITEM-A', 'WH-002'), tag('ITEM-A', 'WH-001'), tag('ITEM-A', 'WH-001'), tag('ITEM-B', 'WH-001')], AS_OF)).toEqual([
      { itemCode: 'ITEM-B', warehouseCode: 'WH-001', onHand: '1.0000', usedLast30Days: '0.0000', asOf: AS_OF },
      { itemCode: 'ITEM-A', warehouseCode: 'WH-001', onHand: '2.0000', usedLast30Days: '0.0000', asOf: AS_OF },
      { itemCode: 'ITEM-A', warehouseCode: 'WH-002', onHand: '1.0000', usedLast30Days: '0.0000', asOf: AS_OF },
    ]);
  });

  it.each(['GENERATED', 'ALLOCATED', 'OUTBOUND', 'QUARANTINE', 'DISPOSED', 'MISSING'])('leaves out a %s tag', (status) => {
    expect(levelsFromTags([tag('ITEM-A', 'WH-001', status)], AS_OF)).toEqual([]);
  });

  it('leaves out a tag with no product or warehouse', () => {
    expect(levelsFromTags([tag(null, 'WH-001'), tag('ITEM-A', null)], AS_OF)).toEqual([]);
  });

  it('answers only for the items asked about', () => {
    expect(levelsFromTags([tag('ITEM-A', 'WH-001'), tag('ITEM-B', 'WH-001')], AS_OF, ['ITEM-B']).map((l) => l.itemCode)).toEqual(['ITEM-B']);
  });
});
