import { registerTotals, signed } from './register.rules';

describe('invoice register (S05)', () => {
  it('shows a credit note as a negative amount', () => {
    expect(signed('CREDIT_NOTE', '1375.00').toFixed(2)).toBe('-1375.00');
    expect(signed('INVOICE', '16500.00').toFixed(2)).toBe('16500.00');
  });

  it('adds up each type and the net billed: invoices + debit notes − credit notes', () => {
    const t = registerTotals([
      { type: 'INVOICE', beforeTax: '15000.00', tax: '1500.00', total: '16500.00' }, // INV-0001
      { type: 'INVOICE', beforeTax: '11900.00', tax: '1190.00', total: '13090.00' }, // INV-0002
      { type: 'DEBIT_NOTE', beforeTax: '180.00', tax: '0.00', total: '180.00' }, // DN-L-0033
      { type: 'CREDIT_NOTE', beforeTax: '1250.00', tax: '125.00', total: '1375.00' }, // SR-0001
    ]);
    expect([t.invoiced.count, t.invoiced.amount.toFixed(2), t.debitNotes.amount.toFixed(2), t.credited.count, t.credited.amount.toFixed(2)]).toEqual([2, '29590.00', '180.00', 1, '1375.00']);
    expect([t.net.beforeTax.toFixed(2), t.net.tax.toFixed(2), t.net.total.toFixed(2)]).toEqual(['25830.00', '2565.00', '28395.00']);
  });
});
