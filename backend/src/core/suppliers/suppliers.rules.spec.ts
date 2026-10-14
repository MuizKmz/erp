import { activationGaps, contractPriceErrors, contractText, eInvoiceGap, permissionsNeeded, statusActions } from './suppliers.rules';

describe('permissionsNeeded', () => {
  it('asks the contract permission for contract prices and the edit permission for the rest', () => {
    expect(permissionsNeeded(['contractPrices'])).toEqual({ contracts: true, details: false });
    expect(permissionsNeeded(['phone', 'contractPrices'])).toEqual({ contracts: true, details: true });
    expect(permissionsNeeded(['email'])).toEqual({ contracts: false, details: true });
  });
});

describe('activationGaps', () => {
  it('asks for name, payment term and currency (rule 5)', () => {
    expect(activationGaps({ name: 'Perabot Kayu Timur', paymentTermDays: 30, currency: 'MYR' })).toEqual([]);
    expect(activationGaps({ name: '', paymentTermDays: null, currency: '' }).map((g) => g.field)).toEqual(['name', 'paymentTermDays', 'currency']);
  });
});

describe('statusActions and eInvoiceGap', () => {
  it('blocks an active supplier and activates a blocked one', () => {
    expect(statusActions('ACTIVE')).toEqual(['block']);
    expect(statusActions('BLOCKED')).toEqual(['activate']);
  });

  it('warns about a missing TIN or ID number, but not for a walk-in shop', () => {
    expect(eInvoiceGap({ isWalkIn: false, tin: null, regNo: null })).toBe('No TIN or ID number yet. e-Invoices with this supplier need both.');
    expect(eInvoiceGap({ isWalkIn: false, tin: 'C1234567890', regNo: null })).toBe('No ID number yet. e-Invoices need it with the TIN.');
    expect(eInvoiceGap({ isWalkIn: true, tin: null, regNo: null })).toBeNull();
  });
});

describe('contractPriceErrors', () => {
  const sofa = { itemCode: 'SF-CUS-03', unitPrice: '2100', validFrom: '2026-01-01', validTo: '2026-12-31' };

  it('accepts the seeded contract price and periods that follow each other', () => {
    expect(contractPriceErrors([sofa])).toEqual([]);
    expect(contractPriceErrors([sofa, { ...sofa, unitPrice: '2200', validFrom: '2027-01-01', validTo: null }])).toEqual([]);
    expect(contractText(sofa)).toBe('SF-CUS-03 at 2100.0000, 1 Jan 2026 – 31 Dec 2026');
  });

  it('refuses overlapping periods for the same item, a zero price and an end before the start', () => {
    expect(contractPriceErrors([sofa, { ...sofa, validFrom: '2026-06-01', validTo: null }])).toEqual([
      { field: 'contractPrices[1]', message: 'Two contract prices for SF-CUS-03 overlap. Let one end before the other starts.' },
    ]);
    expect(contractPriceErrors([{ ...sofa, unitPrice: '0' }])).toEqual([{ field: 'contractPrices[0]', message: 'A contract price must be more than 0.' }]);
    expect(contractPriceErrors([{ ...sofa, validTo: '2025-12-31' }])).toEqual([{ field: 'contractPrices[0]', message: 'The end date cannot be before the start date.' }]);
  });
});
