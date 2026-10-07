import { allowedCashSaleActions, cashSummary, changeDue, consolidatedDue, releaseProblems } from './cash-sale.rules';

const base = { toPay: '550.00', received: '550.00', method: 'CARD' as const, ownEInvoice: false, buyerName: null, buyerTin: null, lineCount: 1 };

describe('cash sale rules', () => {
  it('gives change only on cash', () => {
    expect(changeDue('CASH', '550.00', '600.00').toFixed(2)).toBe('50.00');
    expect(changeDue('CARD', '550.00', '600.00').toFixed(2)).toBe('0.00');
  });

  it('releases only when the balance is 0 (rule 10)', () => {
    expect(releaseProblems(base)).toEqual([]);
    expect(releaseProblems({ ...base, received: '500.00' })[0]!.message).toBe('Amount received must cover the amount to pay (550.00). Balance 50.00 is still open.');
    expect(releaseProblems({ ...base, received: '600.00' })[0]!.message).toBe('Card takes exactly the amount to pay (550.00). Only cash gives change.');
    expect(releaseProblems({ ...base, method: 'CASH', received: '600.00' })).toEqual([]);
  });

  it('needs the buyer name and TIN for an own e-Invoice', () => {
    expect(releaseProblems({ ...base, ownEInvoice: true }).map((p) => p.field)).toEqual(['buyerName', 'buyerTin']);
    expect(releaseProblems({ ...base, ownEInvoice: true, buyerName: 'Encik Faizal Hakim', buyerTin: 'IG50012345080' })).toEqual([]);
  });

  it('sends the consolidated e-Invoice by the 7th of next month', () => {
    expect(consolidatedDue('2026-09-29')).toBe('2026-10-07');
    expect(consolidatedDue('2026-12-03')).toBe('2027-01-07');
  });

  it('describes the sale and allows changes only on drafts', () => {
    expect(cashSummary([{ itemName: 'Dining chair, solid oak', qty: '2' }])).toBe('Dining chair, solid oak ×2');
    expect(allowedCashSaleActions({ status: 'DRAFT', isMigrated: false, canEdit: true })).toEqual(['edit', 'delete', 'release']);
    expect(allowedCashSaleActions({ status: 'RELEASED', isMigrated: false, canEdit: true })).toEqual([]);
  });
});
