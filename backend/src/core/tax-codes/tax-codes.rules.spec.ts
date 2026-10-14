import {
  dayBefore,
  deactivateTaxError,
  newRateErrors,
  percentText,
  periodState,
  rateFromPercent,
  ratesText,
  removeRateRefusal,
  shownPeriod,
  TAX_CODE,
  typeChangeError,
  type Period,
} from './tax-codes.rules';

const TODAY = '2026-09-29';
const SST: Period[] = [{ name: 'SST 10%', rate: '0.1000', validFrom: '2018-09-01', validTo: null }];
const WITH_NEXT: Period[] = [
  { name: 'SST 10%', rate: '0.1000', validFrom: '2018-09-01', validTo: '2026-12-31' },
  { name: 'SST 8%', rate: '0.0800', validFrom: '2027-01-01', validTo: null },
];

describe('tax code rules', () => {
  it('takes codes like SST10 and SVC8', () => {
    expect(TAX_CODE.test('SST10')).toBe(true);
    expect(TAX_CODE.test('8SVC')).toBe(false);
    expect(TAX_CODE.test('SST-10')).toBe(false);
  });

  it('turns percentages into stored fractions and back', () => {
    expect(rateFromPercent('10').toFixed(4)).toBe('0.1000');
    expect(rateFromPercent('6.5').toFixed(4)).toBe('0.0650');
    expect(percentText('0.1000')).toBe('10%');
    expect(percentText('0.0650')).toBe('6.5%');
    expect(percentText('0.0000')).toBe('0%');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('shows the rate valid today, with the next one waiting', () => {
    expect(shownPeriod(WITH_NEXT, TODAY).name).toBe('SST 10%');
    expect(shownPeriod(WITH_NEXT, '2027-01-01').name).toBe('SST 8%');
    expect(WITH_NEXT.map((p) => periodState(p, TODAY))).toEqual(['current', 'waiting']);
    expect(periodState(WITH_NEXT[0]!, '2027-02-01')).toBe('ended');
  });

  it('starts a new rate today or later, after the latest one, between 0% and 100%', () => {
    expect(newRateErrors({ percent: '8', validFrom: '2027-01-01' }, 'SALES_TAX', SST, TODAY)).toEqual([]);
    expect(newRateErrors({ percent: '8', validFrom: TODAY }, 'SALES_TAX', SST, TODAY)).toEqual([]);
    expect(newRateErrors({ percent: '120', validFrom: '2026-09-01' }, 'SALES_TAX', SST, TODAY)).toEqual([
      { field: 'rate', message: 'A rate is between 0% and 100%.' },
      { field: 'validFrom', message: 'A new rate cannot start before today (29 Sep 2026). Earlier rates are history.' },
    ]);
    expect(newRateErrors({ percent: '6', validFrom: '2026-12-01' }, 'SALES_TAX', WITH_NEXT, TODAY)).toEqual([
      { field: 'validFrom', message: 'The latest rate starts on 1 Jan 2027, so a new rate must start after it.' },
    ]);
    expect(newRateErrors({ percent: '5', validFrom: '2027-01-01' }, 'EXEMPT', SST, TODAY)).toEqual([{ field: 'rate', message: 'An exempt code has a 0% rate.' }]);
  });

  it('removes only the latest rate, before its date, and never the only one', () => {
    expect(removeRateRefusal(WITH_NEXT[1]!, WITH_NEXT, TODAY)).toBeNull();
    expect(removeRateRefusal(WITH_NEXT[0]!, WITH_NEXT, TODAY)).toBe('This rate has started, so it is history and stays. Add a new rate instead.');
    expect(removeRateRefusal(SST[0]!, SST, TODAY)).toBe('This is the code’s only rate. Delete the code instead.');
  });

  it('fixes the type once documents use the code, and keeps exempt codes at 0%', () => {
    expect(typeChangeError('SST10', 'SALES_TAX', 'SALES_TAX', 90, SST)).toBeNull();
    expect(typeChangeError('SST10', 'SALES_TAX', 'SERVICE_TAX', 90, SST)).toBe('SST10 is used on 90 documents, so its type cannot change. Add a new tax code instead.');
    expect(typeChangeError('NEW5', 'SALES_TAX', 'EXEMPT', 0, [{ rate: '0.05' }])).toBe('An exempt code has a 0% rate, and this code has other rates.');
  });

  it('keeps a code active while active items use it, and logs the periods as one line', () => {
    expect(deactivateTaxError('SVC8', [])).toBeNull();
    expect(deactivateTaxError('SVC8', ['SV-DEL-01', 'SV-INS-01'])).toBe('SVC8 is the tax of 2 active items (SV-DEL-01, SV-INS-01). Give them another tax code first.');
    expect(ratesText(WITH_NEXT)).toBe('10% from 1 Sep 2018 to 31 Dec 2026; 8% from 1 Jan 2027');
  });
});
