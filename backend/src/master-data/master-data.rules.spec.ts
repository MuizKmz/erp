import { latestValidByKey, validOn } from './master-data.rules';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('validOn', () => {
  it('includes the first and last day, and an open end runs forever', () => {
    expect(validOn({ validFrom: d('2026-01-01'), validTo: d('2026-12-31') }, d('2026-01-01'))).toBe(true);
    expect(validOn({ validFrom: d('2026-01-01'), validTo: d('2026-12-31') }, d('2026-12-31'))).toBe(true);
    expect(validOn({ validFrom: d('2026-01-01'), validTo: d('2026-12-31') }, d('2027-01-01'))).toBe(false);
    expect(validOn({ validFrom: d('2026-10-01') }, d('2026-09-30'))).toBe(false);
    expect(validOn({ validFrom: d('2018-09-01'), validTo: null }, d('2040-01-01'))).toBe(true);
  });
});

describe('latestValidByKey', () => {
  it('answers the tax rate in force: an old period that ended and a future one are both skipped', () => {
    const rows = [
      { code: 'SST10', rate: '0.0600', validFrom: d('2015-04-01'), validTo: d('2018-08-31') },
      { code: 'SST10', rate: '0.1000', validFrom: d('2018-09-01'), validTo: d('2026-09-30') },
      { code: 'SST10', rate: '0.0800', validFrom: d('2026-10-01'), validTo: null },
      { code: 'SVC8', rate: '0.0800', validFrom: d('2024-03-01'), validTo: null },
    ];
    const pick = (on: string) => latestValidByKey(rows, (r) => r.code, d(on)).map((r) => `${r.code} ${r.rate}`);
    expect(pick('2026-09-29')).toEqual(['SST10 0.1000', 'SVC8 0.0800']);
    expect(pick('2026-10-01')).toEqual(['SST10 0.0800', 'SVC8 0.0800']);
    expect(pick('2017-01-01')).toEqual(['SST10 0.0600']);
  });

  it('answers the newest price that has started, per item and unit; a future price waits for its date', () => {
    const rows = [
      { item: 'CH-DIN-01', uom: 'PCS', price: '250.00', validFrom: d('2026-01-01') },
      { item: 'CH-DIN-01', uom: 'PCS', price: '260.00', validFrom: d('2026-10-01') },
      { item: 'TB-DIN-06', uom: 'PCS', price: '1450.00', validFrom: d('2026-01-01') },
    ];
    const pick = (on: string) => latestValidByKey(rows, (r) => `${r.item}|${r.uom}`, d(on)).map((r) => `${r.item} ${r.price}`);
    expect(pick('2026-09-29')).toEqual(['CH-DIN-01 250.00', 'TB-DIN-06 1450.00']);
    expect(pick('2026-10-01')).toEqual(['CH-DIN-01 260.00', 'TB-DIN-06 1450.00']);
    expect(pick('2025-12-31')).toEqual([]);
  });
});
