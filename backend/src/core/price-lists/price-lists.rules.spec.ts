import { diffRecord } from '../shared/audit.rules';
import {
  auditLabels,
  deactivateRefusal,
  headerErrors,
  itemUnits,
  PRICE_LIST_CODE,
  priceListAudit,
  priceListMessage,
  priceItemErrors,
  priceRowErrors,
  priceStates,
  priceText,
  pricedCount,
  type PriceListRecord,
} from './price-lists.rules';

const TODAY = '2026-09-29';
const LIST = { validFrom: '2026-01-01', validTo: '2026-12-31' };

describe('price list rules', () => {
  it('takes codes like STD-2026 and refuses lower case or a leading dash', () => {
    expect(PRICE_LIST_CODE.test('STD-2026')).toBe(true);
    expect(PRICE_LIST_CODE.test('std-2026')).toBe(false);
    expect(PRICE_LIST_CODE.test('-STD')).toBe(false);
  });

  it('shows prices with at least 2 decimals and up to 4', () => {
    expect(priceText('1400')).toBe('1,400.00');
    expect(priceText('12.3456')).toBe('12.3456');
    expect(priceText('2100.5000')).toBe('2,100.50');
  });

  it('finds the current price, the waiting one and the earlier ones per item and unit', () => {
    const rows = [
      { itemCode: 'CH-DIN-01', uomCode: 'PCS', validFrom: '2026-01-01' },
      { itemCode: 'CH-DIN-01', uomCode: 'PCS', validFrom: '2026-06-01' },
      { itemCode: 'CH-DIN-01', uomCode: 'PCS', validFrom: '2026-11-01' },
      { itemCode: 'CH-DIN-01', uomCode: 'BOX', validFrom: '2026-01-01' },
    ];
    expect(priceStates(rows, TODAY)).toEqual(['earlier', 'current', 'waiting', 'current']);
    expect(pricedCount(rows)).toBe(2);
  });

  it('lets a price start today or later, inside the list, above 0 and only once per item, unit and date', () => {
    const ok = { itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: '260', validFrom: '2026-11-01' };
    expect(priceRowErrors([ok, { ...ok, validFrom: TODAY }], LIST, TODAY)).toEqual([]);
    expect(priceRowErrors([{ ...ok, unitPrice: '0' }], LIST, TODAY)[0]!.message).toBe('A price must be more than 0.');
    expect(priceRowErrors([{ ...ok, validFrom: '2026-09-01' }], LIST, TODAY)[0]!.message).toBe('A price cannot start before today (29 Sep 2026). Earlier prices are history.');
    expect(priceRowErrors([{ ...ok, validFrom: '2027-01-01' }], LIST, TODAY)[0]!.message).toBe('The list ends on 31 Dec 2026, so a price cannot start after that.');
    expect(priceRowErrors([{ ...ok, validFrom: '2027-02-01' }], { validFrom: '2027-03-01', validTo: null }, TODAY)[0]!.message).toBe(
      'The list starts on 1 Mar 2027, so a price cannot start before that.',
    );
    expect(priceRowErrors([ok, ok], LIST, TODAY)).toEqual([
      { field: 'prices[1]', message: 'CH-DIN-01 already has a price in PCS from 1 Nov 2026. Change that row instead.' },
    ]);
  });

  it('prices items Sales can sell, in the base unit or a unit with a conversion', () => {
    expect(itemUnits('M', [{ fromUom: 'ROLL', toUom: 'M' }])).toEqual(['M', 'ROLL']);
    expect(itemUnits('PCS', [])).toEqual(['PCS']);
    const items = new Map([
      ['CH-DIN-01', { status: 'ACTIVE', isSellable: true, units: ['PCS'] }],
      ['FB-OAK-01', { status: 'ACTIVE', isSellable: false, units: ['M', 'ROLL'] }],
      ['CH-OLD-01', { status: 'DISCONTINUED', isSellable: true, units: ['PCS'] }],
    ]);
    const rows = [
      { itemCode: 'CH-DIN-01', uomCode: 'PCS' },
      { itemCode: 'CH-DIN-01', uomCode: 'BOX' },
      { itemCode: 'FB-OAK-01', uomCode: 'M' },
      { itemCode: 'XX-NONE', uomCode: 'PCS' },
      { itemCode: 'CH-OLD-01', uomCode: 'PCS' },
    ];
    expect(priceItemErrors(rows, items, new Set(['CH-OLD-01']))).toEqual([
      { field: 'prices[1]', message: 'BOX is not a unit of CH-DIN-01. Pick PCS.' },
      { field: 'prices[2]', message: 'FB-OAK-01 cannot be sold, so it cannot have a price.' },
      { field: 'prices[3]', message: 'Item XX-NONE is not in Master Data.' },
    ]);
  });

  it('keeps the list dates around its prices and fixes the tax setting once a price has started', () => {
    const prices = [{ validFrom: '2026-01-01' }, { validFrom: '2026-06-01' }, { validFrom: '2026-11-01' }];
    expect(headerErrors({ ...LIST, taxInclusive: false }, { taxInclusive: false }, prices, TODAY)).toEqual([]);
    // Only history holds the dates: the waiting price of 1 Nov is a row the form sends, with its own check.
    expect(headerErrors({ validFrom: '2026-02-01', validTo: '2026-05-31', taxInclusive: true }, { taxInclusive: false }, prices, TODAY)).toEqual([
      { field: 'validFrom', message: 'A price starts on 1 Jan 2026, so the list cannot start later.' },
      { field: 'validTo', message: 'A price starts on 1 Jun 2026, so the list cannot end before it.' },
      { field: 'taxInclusive', message: 'Prices on this list have started, so whether they include tax cannot change. Start a new price list instead.' },
    ]);
    expect(headerErrors({ validFrom: '2027-01-01', validTo: '2026-12-31', taxInclusive: false }, null, [], TODAY)).toEqual([
      { field: 'validTo', message: 'The end date cannot be before the start date.' },
    ]);
    // A list whose prices all wait may still change its tax setting.
    expect(headerErrors({ ...LIST, taxInclusive: true }, { taxInclusive: false }, [{ validFrom: '2026-11-01' }], TODAY)).toEqual([]);
  });

  it('keeps a list active while customers use it', () => {
    expect(deactivateRefusal('PROMO-2027', [])).toBeNull();
    expect(deactivateRefusal('STD-2026', ['C-0012', 'C-0045', 'C-0056', 'C-0078'])).toBe(
      'STD-2026 is the price list of 4 customers (C-0012, C-0045, C-0056 …). Move them to another price list first.',
    );
    expect(deactivateRefusal('RES-2026', ['C-0031'])).toBe('RES-2026 is the price list of 1 customer (C-0031). Move it to another price list first.');
  });

  it('logs the list fields in words and each price on its own', () => {
    const list: PriceListRecord = { code: 'STD-2026', name: 'Standard 2026', currency: 'MYR', taxInclusive: false, isActive: true, ...LIST };
    const history = { itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: '250', validFrom: '2026-01-01' };
    const before = priceListAudit(list, [history, { itemCode: 'CH-DIN-02', uomCode: 'PCS', unitPrice: '280', validFrom: '2026-12-01' }]);
    const after = priceListAudit({ ...list, validTo: '2027-03-31' }, [history, { itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: '260', validFrom: '2026-11-01' }]);
    const changes = diffRecord(before.values, after.values, auditLabels(before, after));
    expect(changes.map((c) => [c.label, c.from, c.to])).toEqual([
      ['Valid to', '31 Dec 2026', '31 Mar 2027'],
      ['CH-DIN-01 PCS from 1 Nov 2026', null, '260.00'],
      ['CH-DIN-02 PCS from 1 Dec 2026', '280.00', null],
    ]);
    expect(priceListMessage(changes)).toBe(
      'Changed valid to 31 Dec 2026 → 31 Mar 2027; prices: added CH-DIN-01 PCS from 1 Nov 2026 at 260.00 and removed CH-DIN-02 PCS from 1 Dec 2026 (280.00)',
    );
    expect(priceListMessage(changes.slice(1, 2))).toBe('Prices: added CH-DIN-01 PCS from 1 Nov 2026 at 260.00');
  });
});
