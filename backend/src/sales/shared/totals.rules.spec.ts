import { invoiceBalance, marginPct, roundTo5Sen, saleLineTotals, saleTotals } from './totals.rules';

const money = (v: { toFixed(n: number): string }) => v.toFixed(2);

describe('sales totals.rules', () => {
  it('QT-0012: two lines with 5% discount, SST 10%, total 92,378.00', () => {
    const lines = [
      saleLineTotals({ qty: 200, unitPrice: '235.00', discountPct: 5, taxRate: '0.1' }),
      saleLineTotals({ qty: 30, unitPrice: '1380.00', discountPct: 5, taxRate: '0.1' }),
    ];
    expect(lines.map((l) => money(l.amount))).toEqual(['44650.00', '39330.00']);
    const t = saleTotals(lines, 'EXCLUSIVE', true);
    expect([t.subtotal, t.discountTotal, t.taxTotal, t.rounding, t.total].map(money)).toEqual(['88400.00', '4420.00', '8398.00', '0.00', '92378.00']);
  });

  it('CS-0004: tax-inclusive cash sale, 2 × 275.00 = 550.00 of which 50.00 tax', () => {
    const t = saleTotals([saleLineTotals({ qty: 2, unitPrice: '275.00', taxRate: '0.1' }, 'INCLUSIVE')], 'INCLUSIVE', true);
    expect([t.subtotal, t.taxTotal, t.total].map(money)).toEqual(['500.00', '50.00', '550.00']);
  });

  it('rounds totals to 5 sen and keeps the adjustment apart', () => {
    expect(['10.01', '10.02', '10.03', '10.07', '10.08'].map((v) => money(roundTo5Sen(v)))).toEqual(['10.00', '10.00', '10.05', '10.05', '10.10']);
    const t = saleTotals([saleLineTotals({ qty: 1, unitPrice: '9.12', taxRate: '0.1' })], 'EXCLUSIVE', true); // 9.12 + 0.91 = 10.03
    expect([t.rounding, t.total].map(money)).toEqual(['0.02', '10.05']);
    expect(money(saleTotals([saleLineTotals({ qty: 1, unitPrice: '9.12', taxRate: '0.1' })]).total)).toBe('10.03');
  });

  it('works out the estimated margin', () => {
    expect(marginPct('83980.00', '59962.00')?.toFixed(1)).toBe('28.6');
    expect(marginPct('0', '10')).toBeNull();
    expect(marginPct('100', null)).toBeNull();
  });

  it('INV-0001 balance: 16,500.00 − 1,375.00 credited = 15,125.00; with a deposit and a debit note', () => {
    expect(money(invoiceBalance({ total: '16500', debited: 0, credited: '1375', deposit: 0, paid: 0 }))).toBe('15125.00');
    expect(money(invoiceBalance({ total: '13090', debited: 0, credited: 0, deposit: '6545', paid: 0 }))).toBe('6545.00');
    expect(money(invoiceBalance({ total: '16500', debited: '378', credited: '1375', deposit: 0, paid: 0 }))).toBe('15503.00');
  });
});
