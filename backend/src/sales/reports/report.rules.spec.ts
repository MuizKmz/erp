import { dec } from '../../platform/http/decimal';
import { monthRange, salesByAgent, salesByCustomer, salesByItem, salesByItemGroup, type ReportOrder } from './report.rules';

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

  it('adds up each item over the order lines, with what was invoiced and cancelled on those lines', () => {
    const lines = [
      { soLineId: 'a', docNo: 'SO-0008', itemCode: 'CH-DIN-01', itemName: 'Dining chair', uomCode: 'PCS', orderedQty: '200', deliveredQty: '0', invoicedQty: '0', value: '49115.00' },
      { soLineId: 'b', docNo: 'SO-0008', itemCode: 'TB-DIN-06', itemName: 'Dining table', uomCode: 'PCS', orderedQty: '30', deliveredQty: '0', invoicedQty: '0', value: '43263.00' },
      { soLineId: 'c', docNo: 'SO-0001', itemCode: 'CH-DIN-01', itemName: 'Dining chair', uomCode: 'PCS', orderedQty: '100', deliveredQty: '60', invoicedQty: '60', value: '27500.00' },
      { soLineId: 'd', docNo: 'SO-0006', itemCode: 'CH-OFF-02', itemName: 'Office chair', uomCode: 'PCS', orderedQty: '25', deliveredQty: '10', invoicedQty: '10', value: '8250.00' },
    ];
    const r = salesByItem(lines, new Map([['c', '16500.00'], ['d', '3300.00']]), new Map([['d', '4950.00']]));
    expect(r.rows.map((x) => [x.itemCode, x.orders, x.orderedQty.toString(), x.deliveredQty.toString(), x.ordered.toFixed(2), x.invoiced.toFixed(2), x.open.toFixed(2), x.sharePct])).toEqual([
      ['CH-DIN-01', 2, '300', '60', '76615.00', '16500.00', '60115.00', 59.8],
      ['TB-DIN-06', 1, '30', '0', '43263.00', '0.00', '43263.00', 33.8],
      ['CH-OFF-02', 1, '25', '10', '8250.00', '3300.00', '0.00', 6.4],
    ]);
    expect([r.totals.orders, r.totals.ordered.toFixed(2), r.totals.invoiced.toFixed(2), r.totals.cancelled.toFixed(2)]).toEqual([3, '128128.00', '19800.00', '4950.00']);
  });

  it('keeps quantities in different units apart', () => {
    const line = { docNo: 'SO-1', itemCode: 'SC-WOD-08', itemName: 'Wood screw', orderedQty: '2', deliveredQty: '0', invoicedQty: '0', value: '100.00' };
    const r = salesByItem([{ ...line, soLineId: 'a', uomCode: 'BOX' }, { ...line, soLineId: 'b', uomCode: 'PCS', orderedQty: '50' }], new Map(), new Map());
    expect(r.rows.map((x) => `${x.itemCode} ${x.orderedQty.toString()} ${x.uomCode}`)).toEqual(['SC-WOD-08 2 BOX', 'SC-WOD-08 50 PCS']);
  });

  it('groups items, with items that have no group last', () => {
    const rows = [
      { itemCode: 'CH-DIN-01', ordered: dec('102135.00') },
      { itemCode: 'SF-CUS-03', ordered: dec('70400.00') },
      { itemCode: 'TB-DIN-06', ordered: dec('43263.00') },
      { itemCode: 'XX-NEW-01', ordered: dec('500.00') },
    ];
    const groups: Record<string, string> = { 'CH-DIN-01': 'Chairs', 'SF-CUS-03': 'Sofas', 'TB-DIN-06': 'Tables' };
    expect(salesByItemGroup(rows, (c) => groups[c] ?? null).map((g) => `${g.group} ${g.items} ${g.ordered.toFixed(2)} ${g.sharePct}`)).toEqual([
      'Chairs 1 102135.00 47.2',
      'Sofas 1 70400.00 32.5',
      'Tables 1 43263.00 20',
      'No group 1 500.00 0.2',
    ]);
  });

  it('turns a month into its first and last day', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
