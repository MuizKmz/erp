import { agingByCustomer, agingColumnOf, agingColumns, agingDays } from './aging.rules';

const today = '2026-09-29';

/** The 14 unpaid invoices on 29 Sep (SALES_SEED_DATA.md): RM 84,640.00, of which RM 36,900.00 overdue. */
const OPEN = [
  ['C-0012', 'Hotel Seri Bayu Sdn Bhd', '2026-09-21', '2026-10-21', '15125.00'], // INV-0001
  ['C-0056', 'Restoran Selera Kampung', '2026-09-22', '2026-10-22', '6545.00'], // INV-0002
  ['C-0012', 'Hotel Seri Bayu Sdn Bhd', '2026-08-29', '2026-09-28', '12000.00'], // INV-L-0389
  ['C-0045', 'Syarikat Delta Trading', '2026-06-18', '2026-07-18', '5000.00'], // INV-L-0376
  ['C-0045', 'Syarikat Delta Trading', '2026-09-01', '2026-10-01', '6500.00'],
  ['C-0045', 'Syarikat Delta Trading', '2026-09-10', '2026-10-10', '6500.00'],
  ['C-0031', 'Kedai Perabot Maju', '2026-08-12', '2026-09-11', '6400.00'],
  ['C-0031', 'Kedai Perabot Maju', '2026-08-20', '2026-09-19', '5600.00'],
  ['C-0031', 'Kedai Perabot Maju', '2026-09-15', '2026-10-15', '6400.00'],
  ['C-0078', 'Klinik Sihat Jaya', '2026-08-16', '2026-09-15', '4500.00'],
  ['C-0078', 'Klinik Sihat Jaya', '2026-09-14', '2026-10-14', '3300.00'],
  ['C-0078', 'Klinik Sihat Jaya', '2026-09-20', '2026-10-20', '1500.00'],
  ['C-0056', 'Restoran Selera Kampung', '2026-08-26', '2026-09-25', '3400.00'],
  ['C-0056', 'Restoran Selera Kampung', '2026-09-18', '2026-10-18', '1870.00'],
].map(([customerCode, customerName, docDate, dueDate, balance]) => ({ customerCode: customerCode!, customerName: customerName!, docDate: docDate!, dueDate: dueDate!, balance: balance! }));

describe('customer aging (S05, RPT-023)', () => {
  it('names the steps of the four, six and twelve month sets, by due date or by invoice date', () => {
    expect(agingColumns(4, 'due').map((c) => c.label)).toEqual(['Not yet due', '1–30', '31–60', '61–90', 'Over 90']);
    expect(agingColumns(4, 'invoice').map((c) => c.label)).toEqual(['0–30', '31–60', '61–90', 'Over 90']);
    expect(agingColumns(6, 'due').at(-1)!.label).toBe('Over 150');
    const twelve = agingColumns(12, 'invoice');
    expect([twelve.length, twelve.at(-1)!.label]).toEqual([12, 'Over 330']);
  });

  it('puts an invoice in its step', () => {
    const cols = agingColumns(4, 'due');
    expect(agingColumnOf(cols, 'due', { docDate: '2026-08-29', dueDate: '2026-09-28' }, today)).toBe('d0'); // 1 day overdue
    expect(agingColumnOf(cols, 'due', { docDate: '2026-06-18', dueDate: '2026-07-18' }, today)).toBe('d2'); // 73 days
    expect(agingColumnOf(cols, 'due', { docDate: '2026-09-21', dueDate: '2026-10-21' }, today)).toBe('notDue');
    expect(agingColumnOf(cols, 'due', { docDate: '2026-09-21', dueDate: null }, today)).toBe('notDue');
    const byInvoice = agingColumns(4, 'invoice');
    expect(agingColumnOf(byInvoice, 'invoice', { docDate: '2026-06-18', dueDate: '2026-07-18' }, today)).toBe('d3'); // 103 days old
    expect(agingColumnOf(byInvoice, 'invoice', { docDate: '2026-09-21', dueDate: '2026-10-21' }, today)).toBe('d0');
    expect(agingDays({ docDate: '2026-09-21', dueDate: '2026-10-21' }, 'due', today)).toBe(-22);
  });

  it('spreads what each customer owes on 29 Sep, as the Invoices list adds it up', () => {
    const r = agingByCustomer(OPEN, agingColumns(4, 'due'), 'due', today);
    expect([r.totals.balance.toFixed(2), r.totals.overdue.toFixed(2)]).toEqual(['84640.00', '36900.00']);
    expect(Object.entries(r.totals.cells).map(([k, v]) => `${k} ${v.toFixed(2)}`)).toEqual(['notDue 47740.00', 'd0 31900.00', 'd1 0.00', 'd2 5000.00', 'd3 0.00']);
    expect(r.rows.map((x) => `${x.customerName} ${x.balance.toFixed(2)} ${x.overdue.toFixed(2)} ${x.oldestDays}`)).toEqual([
      'Hotel Seri Bayu Sdn Bhd 27125.00 12000.00 1',
      'Kedai Perabot Maju 18400.00 12000.00 18',
      'Syarikat Delta Trading 18000.00 5000.00 73',
      'Restoran Selera Kampung 11815.00 3400.00 4',
      'Klinik Sihat Jaya 9300.00 4500.00 14',
    ]);
  });

  it('ages by invoice date when asked, while overdue still counts from the due date', () => {
    const r = agingByCustomer(OPEN, agingColumns(4, 'invoice'), 'invoice', today);
    expect(Object.values(r.totals.cells).map((v) => v.toFixed(2))).toEqual(['47740.00', '31900.00', '0.00', '5000.00']);
    expect(r.totals.overdue.toFixed(2)).toBe('36900.00');
    expect(r.rows.find((x) => x.customerCode === 'C-0045')!.oldestDays).toBe(103);
  });
});
