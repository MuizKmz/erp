import { plainQty, qtyWithUnit } from './text.rules';

describe('qtyWithUnit', () => {
  it('writes quantities the way the mockups do', () => {
    expect(qtyWithUnit('95.0000', 'ROLL')).toBe('95 rolls');
    expect(qtyWithUnit('1', 'ROLL')).toBe('1 roll');
    expect(qtyWithUnit('10', 'PACK')).toBe('10 packs');
    expect(qtyWithUnit('12', 'BOX')).toBe('12 boxes');
  });

  it('falls back to the unit code', () => {
    expect(qtyWithUnit('3', 'KG')).toBe('3 KG');
  });

  it('drops trailing zeros', () => {
    expect(plainQty('2.5000')).toBe('2.5');
  });
});
