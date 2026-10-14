import { deactivateUnitError, decimalsChangeError, UOM_CODE } from './uoms.rules';

describe('UOM_CODE', () => {
  it('takes short capital codes', () => {
    expect(['PCS', 'ROLL', 'M', 'CTN12'].every((c) => UOM_CODE.test(c))).toBe(true);
    expect(['pcs', '1BOX', 'TOO-LONG', 'ABCDEFGHIJK'].some((c) => UOM_CODE.test(c))).toBe(false);
  });
});

describe('decimalsChangeError', () => {
  it('lets decimals go up any time and down only while the unit is unused', () => {
    expect(decimalsChangeError('M', 2, 3, true)).toBeNull();
    expect(decimalsChangeError('CTN', 2, 0, false)).toBeNull();
    expect(decimalsChangeError('M', 2, 0, true)).toBe('M is in use, so its decimals cannot go down (from 2 to 0). They can go up.');
  });
});

describe('deactivateUnitError', () => {
  it('keeps a unit active while active items use it', () => {
    expect(deactivateUnitError('CTN', [])).toBeNull();
    expect(deactivateUnitError('PCS', ['BD-KNG-01', 'CB-SHO-01', 'CH-BAR-01', 'CH-DIN-01'])).toBe(
      'PCS is used by 4 active items (BD-KNG-01, CB-SHO-01, CH-BAR-01 …). Give them another unit first.',
    );
  });
});
