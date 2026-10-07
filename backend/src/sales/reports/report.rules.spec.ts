import { monthRange, salesByAgent, salesByCustomer, type ReportOrder } from './report.rules';

const orders: ReportOrder[] = [
  { docNo: 'SO-0008', customerCode: 'C-0031', customerName: 'Kedai Perabot Maju', agentCode: 'LWJ', agentName: 'Lim Wei Jie', total: '92378.00' },
  { docNo: 'SO-0005', customerCode: 'C-0031', customerName: 'Kedai Perabot Maju', agentCode: 'LWJ', agentName: 'Lim Wei Jie', total: '21120.00' },
  { docNo: 'SO-0006', customerCode: 'C-0078', customerName: 'Klinik Sihat Jaya', agentCode: 'FO', agentName: 'Faizal Omar', total: '8250.00' },
];

describe('sales report rules', () => {
  it('adds up ordered, invoiced, cancelled and open per customer (S05)', () => {
    const r = salesByCustomer(orders, new Map([['SO-0006', '3300.00']]), new Map([['SO-0006', '4950.00']]));
    expect(r.rows.map((x) => [x.customerName, x.orders, x.ordered.toFixed(2), x.invoiced.toFixed(2), x.open.toFixed(2)])).toEqual([
      ['Kedai Perabot Maju', 2, '113498.00', '0.00', '113498.00'],
      ['Klinik Sihat Jaya', 1, '8250.00', '3300.00', '0.00'],
    ]);
    expect(r.totals.ordered.toFixed(2)).toBe('121748.00');
    expect(r.totals.cancelled.toFixed(2)).toBe('4950.00');
    expect(r.rows[0]!.sharePct).toBe(93.2);
  });

  it('groups by sales agent', () => {
    expect(salesByAgent(orders).map((a) => [a.agentName, a.orders, a.ordered.toFixed(2)])).toEqual([
      ['Lim Wei Jie', 2, '113498.00'],
      ['Faizal Omar', 1, '8250.00'],
    ]);
  });

  it('turns a month into its first and last day', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
