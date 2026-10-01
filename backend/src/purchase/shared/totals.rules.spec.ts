import { toMoney } from '../../platform/http/decimal';
import { documentTotals, lineTotals } from './totals.rules';

const money = (t: { subtotal: unknown; taxTotal: unknown; total: unknown }) => ({
  subtotal: toMoney(t.subtotal as string),
  taxTotal: toMoney(t.taxTotal as string),
  total: toMoney(t.total as string),
});

describe('lineTotals / documentTotals — seed documents', () => {
  it('PO-0001: 100 × 40.00 + SST 10% = 4,400.00', () => {
    const t = documentTotals([lineTotals({ qty: '100', unitPrice: '40', taxRate: '0.1' })]);
    expect(money(t)).toEqual({ subtotal: '4000.00', taxTotal: '400.00', total: '4400.00' });
  });

  it('PI-0001 recorded: 95 × 40.00 + SST 10% = 4,180.00', () => {
    const t = documentTotals([lineTotals({ qty: '95', unitPrice: '40', taxRate: '0.1' })]);
    expect(toMoney(t.total)).toBe('4180.00');
  });

  it('CP-0002: 12 × 18.00 + SST 10% = 237.60', () => {
    const t = documentTotals([lineTotals({ qty: '12', unitPrice: '18', taxRate: '0.1' })]);
    expect(money(t)).toEqual({ subtotal: '216.00', taxTotal: '21.60', total: '237.60' });
  });

  it('PDN-0001: 1 LOT × 500.00 + service tax 8% = 540.00', () => {
    const t = documentTotals([lineTotals({ qty: '1', unitPrice: '500', taxRate: '0.08' })]);
    expect(toMoney(t.total)).toBe('540.00');
  });

  it('PRQ-0006 style: several lines are summed after rounding each line', () => {
    const t = documentTotals([
      lineTotals({ qty: '20', unitPrice: '18', taxRate: '0.1' }),
      lineTotals({ qty: '8', unitPrice: '95', taxRate: '0.1' }),
    ]);
    expect(money(t)).toEqual({ subtotal: '1120.00', taxTotal: '112.00', total: '1232.00' });
  });
});

describe('rounding', () => {
  it('rounds the line amount half-up to 2 decimals', () => {
    expect(toMoney(lineTotals({ qty: '3', unitPrice: '33.335', taxRate: '0' }).amount)).toBe('100.01');
  });

  it('rounds the tax on the rounded amount, half-up', () => {
    // amount 1.25 × 10% = 0.125 → 0.13
    expect(toMoney(lineTotals({ qty: '1', unitPrice: '1.25', taxRate: '0.1' }).taxAmount)).toBe('0.13');
  });

  it('exempt lines carry no tax', () => {
    expect(toMoney(lineTotals({ qty: '30', unitPrice: '21.6', taxRate: '0' }).taxAmount)).toBe('0.00');
  });
});
