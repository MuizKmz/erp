import { activationGaps, conversionError, conversionErrors, conversionText, statusActions, unitChoiceError } from './items.rules';

const decimals = new Map([['ROLL', 0], ['M', 2], ['PCS', 0], ['BOX', 0]]);

describe('activationGaps', () => {
  const ready = { name: 'Dining chair', itemGroup: 'Seating', type: 'STOCK', baseUom: 'PCS', isPurchasable: true, purchaseTaxCode: 'SST10', isSellable: true, salesTaxCode: 'SST10' };

  it('lets a complete item be active', () => {
    expect(activationGaps(ready)).toEqual([]);
  });

  it('asks for the tax code of each side the item is used on', () => {
    expect(activationGaps({ ...ready, purchaseTaxCode: null, salesTaxCode: null }).map((g) => g.field)).toEqual(['purchaseTaxCode', 'salesTaxCode']);
    expect(activationGaps({ ...ready, isSellable: false, salesTaxCode: null })).toEqual([]);
  });

  it('asks for name, group, type and base unit', () => {
    expect(activationGaps({ ...ready, name: ' ', itemGroup: '', type: '', baseUom: '' }).map((g) => g.field)).toEqual(['name', 'itemGroup', 'type', 'baseUom']);
  });
});

describe('conversionError', () => {
  it('accepts the seeded conversion of FB-OAK-01: 1 ROLL = 50 M', () => {
    expect(conversionError({ fromUom: 'ROLL', toUom: 'M', factor: '50' }, 'ROLL', decimals)).toBeNull();
    expect(conversionText({ fromUom: 'ROLL', toUom: 'M', factor: '50.000000' })).toBe('1 ROLL = 50 M');
  });

  it('accepts a bigger unit made of whole base units, either way round', () => {
    expect(conversionError({ fromUom: 'BOX', toUom: 'PCS', factor: '12' }, 'PCS', decimals)).toBeNull();
    expect(conversionError({ fromUom: 'PCS', toUom: 'BOX', factor: '0.5' }, 'PCS', decimals)).toBeNull();
  });

  it('refuses a factor below 1 that gives more base decimals than the base unit allows (SRS FR-MST-017)', () => {
    expect(conversionError({ fromUom: 'PCS', toUom: 'BOX', factor: '0.3' }, 'PCS', decimals)).toBe('1 BOX would be 3.3333 PCS, but PCS allows no decimals.');
    expect(conversionError({ fromUom: 'BOX', toUom: 'PCS', factor: '2.5' }, 'PCS', decimals)).toBe('1 BOX would be 2.5 PCS, but PCS allows no decimals.');
    expect(conversionError({ fromUom: 'M', toUom: 'ROLL', factor: '0.4' }, 'M', decimals)).toBeNull(); // 1 ROLL = 2.5 M, M allows 2 decimals
  });

  it('refuses a zero factor, the same unit twice and a conversion without the base unit', () => {
    expect(conversionError({ fromUom: 'BOX', toUom: 'PCS', factor: '0' }, 'PCS', decimals)).toBe('A conversion factor must be more than 0.');
    expect(conversionError({ fromUom: 'PCS', toUom: 'PCS', factor: '1' }, 'PCS', decimals)).toBe('A conversion needs two different units.');
    expect(conversionError({ fromUom: 'BOX', toUom: 'M', factor: '3' }, 'PCS', decimals)).toBe('A conversion is to or from the base unit (PCS).');
  });
});

describe('conversionErrors', () => {
  it('allows one conversion per unit', () => {
    const errors = conversionErrors([{ fromUom: 'BOX', toUom: 'PCS', factor: '12' }, { fromUom: 'PCS', toUom: 'BOX', factor: '0.1' }], 'PCS', decimals);
    expect(errors).toEqual([{ field: 'conversions[1]', message: 'BOX already has a conversion.' }]);
  });
});

describe('unitChoiceError', () => {
  const conversions = [{ fromUom: 'ROLL', toUom: 'M', factor: '50' }];
  it('allows the base unit or a converted unit as the purchase or sales unit', () => {
    expect(unitChoiceError(null, 'ROLL', conversions, 'Sales unit')).toBeNull();
    expect(unitChoiceError('M', 'ROLL', conversions, 'Sales unit')).toBeNull();
    expect(unitChoiceError('BOX', 'ROLL', conversions, 'Purchase unit')).toBe('Purchase unit BOX needs a conversion to the base unit (ROLL).');
  });
});

describe('statusActions', () => {
  it('offers what each status can move to', () => {
    expect(statusActions('ACTIVE')).toEqual(['block', 'discontinue']);
    expect(statusActions('BLOCKED')).toEqual(['activate', 'discontinue']);
    expect(statusActions('DISCONTINUED')).toEqual(['activate']);
  });
});
