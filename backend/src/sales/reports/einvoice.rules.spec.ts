import { consolidatedByMonth, consolidatedState, eInvoiceProblem, eInvoiceState } from './einvoice.rules';

describe('e-Invoice status (S05, FR-EIV-010)', () => {
  it('reads the e-Invoice state from the release event', () => {
    expect(eInvoiceState({ isMigrated: false, eventStatus: 'PENDING' })).toBe('WAITING'); // LHDN not connected
    expect(eInvoiceState({ isMigrated: false, eventStatus: 'DISPATCHED' })).toBe('SUBMITTED');
    expect(eInvoiceState({ isMigrated: false, eventStatus: 'FAILED' })).toBe('FAILED');
    expect(eInvoiceState({ isMigrated: false, eventStatus: null })).toBeNull(); // not released yet
    expect(eInvoiceState({ isMigrated: true, eventStatus: null })).toBe('OLD_SYSTEM');
  });

  it("flags what LHDN would refuse: an e-Invoice without the buyer's TIN", () => {
    expect(eInvoiceProblem({ type: 'INVOICE', customerTin: 'C20881234050' })).toBeNull();
    expect(eInvoiceProblem({ type: 'CREDIT_NOTE', customerTin: null })).toBe('The customer has no TIN in Master Data.');
    expect(eInvoiceProblem({ type: 'CASH_SALE', customerTin: null, buyerTin: 'IG10203040506' })).toBeNull(); // CS-0003
    expect(eInvoiceProblem({ type: 'CASH_SALE', customerTin: null, buyerTin: ' ' })).toBe("The buyer's TIN is missing.");
  });

  it('dates the consolidated e-Invoice the 7th of the next month, late after that', () => {
    expect(consolidatedState('2026-09', '2026-09-29')).toEqual({ due: '2026-10-07', late: false });
    expect(consolidatedState('2026-09', '2026-10-08')).toEqual({ due: '2026-10-07', late: true });
    expect(consolidatedState('2026-12', '2026-12-31').due).toBe('2027-01-07');
  });

  it('puts the cash sales without their own e-Invoice in their month', () => {
    const sales = [
      { docDate: '2026-09-29', total: '550.00', ownEInvoice: false }, // CS-0004
      { docDate: '2026-09-28', total: '1320.00', ownEInvoice: true }, // CS-0003, its own
      { docDate: '2026-09-27', total: '440.00', ownEInvoice: false }, // CS-0002
      { docDate: '2026-08-31', total: '100.00', ownEInvoice: false },
    ];
    expect(consolidatedByMonth(sales).map((m) => `${m.month} ${m.count} ${m.amount.toFixed(2)}`)).toEqual(['2026-09 2 990.00', '2026-08 1 100.00']);
  });
});
