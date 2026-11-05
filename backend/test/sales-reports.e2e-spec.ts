import { reseed, startApi, type Api } from './e2e-helpers';

/**
 * Sales reports (S05): the seven report tabs with the seed's numbers on 29 Sep, which agree with the screens they
 * summarise (the Sales home, the Invoices list, the Quotation list, the Cash Sales list), their filters, and the
 * check that saves nothing. The data scopes on every report are in scope.e2e-spec.ts.
 */
describe('Sales reports (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  const NA = 'NA'; // Sales Manager: sees every customer

  it('Sales by customer: September as the S05 mockup, with CO-0002 still a draft', async () => {
    const r = await api.get('sales/reports/by-customer', NA);
    expect(r.kpis).toEqual({
      ordered: { amount: '274098.00', orders: 8 },
      invoiced: { amount: '32890.00', pct: 12 },
      cancelled: { amount: '0.00', docs: [] },
      open: { amount: '241208.00' },
    });
    expect(r.rows.map((x: { customerName: string; ordered: string; sharePct: string }) => `${x.customerName} ${x.ordered} ${x.sharePct}`)).toEqual([
      'Kedai Perabot Maju 113498.00 41.4',
      'Hotel Seri Bayu Sdn Bhd 97900.00 35.7',
      'Villa Damai Resort 36960.00 13.5',
      'Restoran Selera Kampung 13090.00 4.8',
      'Klinik Sihat Jaya 8250.00 3.0',
      'Syarikat Delta Trading 4400.00 1.6',
    ]);
    expect(r.agents.map((a: { agentName: string; ordered: string }) => `${a.agentName} ${a.ordered}`)).toEqual(['Aina Rahman 134860.00', 'Lim Wei Jie 113498.00', 'Faizal Omar 25740.00']);
    expect(r.footnote).toBe('Amounts include tax. Invoiced is before returns: SR-0001 credited RM 1,375.00 on INV-0001.');
  });

  it('Sales by item: the same orders per item and item group, and the item group filter', async () => {
    const r = await api.get('sales/reports/by-item', NA);
    expect(r.kpis).toEqual({
      ordered: { amount: '274098.00', items: 7, orders: 8 },
      invoiced: { amount: '32890.00', pct: 12 },
      best: { itemCode: 'CH-DIN-01', itemName: 'Dining chair, solid oak', amount: '102135.00', sharePct: '37.3' },
      open: { amount: '241208.00' },
    });
    const chairs = r.rows.find((x: { itemCode: string }) => x.itemCode === 'CH-DIN-01');
    expect(chairs).toMatchObject({ orders: 4, orderedQty: '396.0000', deliveredQty: '60.0000', invoicedQty: '60.0000', invoiced: '16500.00', open: '85635.00' });
    expect(r.groups.map((g: { group: string; ordered: string }) => `${g.group} ${g.ordered}`)).toEqual(['Seating 110385.00', 'Sofas 76945.00', 'Tables 49808.00', 'Beds 36960.00']);
    const seating = await api.get('sales/reports/by-item?itemGroup=Seating', NA);
    expect(seating.rows.map((x: { itemCode: string }) => x.itemCode)).toEqual(['CH-DIN-01', 'CH-OFF-02']);
    expect(seating.totals.ordered).toBe('110385.00');
  });

  it('Open orders: what is left and what it waits for, as the home and the delivery list count it', async () => {
    const r = await api.get('sales/reports/open-orders', NA);
    expect(r.kpis).toEqual({
      open: { orders: 7, ordered: '261008.00', released: 2, partial: 2, approval: 2, draft: 1 },
      toDeliver: { amount: '241208.00', units: '425.0000', toInvoice: '0.0000' },
      dueSoon: { orders: 1, orderNos: ['SO-0001'], late: [] },
      approval: { orders: 2, amount: '96778.00' },
    });
    expect(r.byReason.map((x: { label: string; amount: string }) => `${x.label} ${x.amount}`)).toEqual([
      'Not released yet 21120.00',
      'Waiting for approval 96778.00',
      'Being cancelled 4950.00',
      'Waiting for purchase 70400.00',
      'Waiting for stock 11000.00',
      'Ready to deliver 36960.00',
    ]);
    const line = (docNo: string) => r.orders.find((o: { docNo: string }) => o.docNo === docNo).lines[0];
    expect(line('SO-0006')).toMatchObject({ open: '15.0000', reason: 'CANCELLING', detail: 'CO-0002 (draft)' });
    expect(line('SO-0003')).toMatchObject({ reason: 'PURCHASE', detail: 'PO-0003' });
    expect(line('SO-0007')).toMatchObject({ reason: 'READY', detail: '24 PCS in stock' });
    expect(line('SO-0001')).toMatchObject({ open: '40.0000', openValue: '11000.00', reason: 'NO_STOCK' });
    expect(r.byCustomer[0]).toEqual({ customerCode: 'C-0031', customerName: 'Kedai Perabot Maju', orders: 2, openValue: '113498.00' });

    const approval = await api.get('sales/reports/open-orders?show=approval', NA);
    expect(approval.orders.map((o: { docNo: string }) => o.docNo)).toEqual(['SO-0002', 'SO-0008']);
  });

  it('Quotation conversion: 10 sent in September, 5 turned into orders', async () => {
    const r = await api.get('sales/reports/quotation-conversion', NA);
    expect(r.kpis).toEqual({
      sent: { count: 10, amount: '196955.00' },
      won: { count: 5, amount: '152350.00', pct: 50, valuePct: 77, avgDays: '2.2' },
      lost: { count: 2, amount: '20185.00', topReason: 'Price too high' },
      open: { count: 2, amount: '15840.00', expiringSoon: ['QT-0004'], expired: 1 },
    });
    expect(r.agents.map((a: { agentName: string; won: number; sent: number; pct: number }) => `${a.agentName} ${a.won}/${a.sent} ${a.pct}%`)).toEqual([
      'Aina Rahman 3/3 100%',
      'Faizal Omar 2/6 33%',
      'Lim Wei Jie 0/1 0%',
    ]);
    // QT-0010 counts once, as revision 1; the drafts were never sent.
    expect(r.rows.filter((x: { docNo: string }) => x.docNo === 'QT-0010')).toEqual([expect.objectContaining({ revision: 1, outcome: 'OPEN' })]);
    expect(r.rows.find((x: { docNo: string }) => x.docNo === 'QT-0008')).toMatchObject({ outcome: 'WON', salesOrderNo: 'SO-0003', daysToOrder: 3 });
    expect(r.footnote).toContain('4 not sent yet (QT-0002, QT-0006, QT-0007, QT-0012, RM 120,208.00)');
    expect((await api.get('sales/reports/quotation-conversion?agent=AR', NA)).kpis.sent).toEqual({ count: 3, amount: '134860.00' });
  });

  it('Customer aging: the balances of the Invoices list, by due date or by invoice date', async () => {
    const r = await api.get('sales/reports/customer-aging', NA);
    expect(r.kpis).toEqual({
      due: { amount: '84640.00', invoices: 14 },
      overdue: { amount: '36900.00', customers: 5 },
      over60: { amount: '5000.00', customers: ['Syarikat Delta Trading'] },
      notDue: { amount: '47740.00' },
    });
    expect(r.columns.map((c: { label: string }) => c.label)).toEqual(['Not yet due', '1–30', '31–60', '61–90', 'Over 90']);
    expect(r.totals.cells).toEqual({ notDue: '47740.00', d0: '31900.00', d1: '0.00', d2: '5000.00', d3: '0.00' });
    expect(r.rows[0]).toMatchObject({ customerName: 'Hotel Seri Bayu Sdn Bhd', balance: '27125.00', overdue: '12000.00', creditLimit: '150000.00', overLimit: false });

    const byInvoice = await api.get('sales/reports/customer-aging?steps=6&basis=invoice', NA);
    expect(byInvoice.columns.map((c: { label: string }) => c.label)).toEqual(['0–30', '31–60', '61–90', '91–120', '121–150', 'Over 150']);
    expect(byInvoice.totals.cells).toEqual({ d0: '47740.00', d1: '31900.00', d2: '0.00', d3: '5000.00', d4: '0.00', d5: '0.00' });
    expect(byInvoice.kpis.overdue.amount).toBe('36900.00');

    const bad = await api.call('GET', 'sales/reports/customer-aging?steps=5', NA);
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([{ field: 'steps', message: 'Pick 4, 6 or 12 months.' }]);
  });

  it('Invoice register: what was billed in September, with credit notes taken off', async () => {
    const r = await api.get('sales/reports/invoice-register', NA);
    expect(r.kpis).toEqual({
      invoiced: { amount: '55660.00', count: 8 },
      debitNotes: { amount: '180.00', count: 1 },
      credited: { amount: '1969.00', count: 2 },
      net: { amount: '53871.00' },
    });
    expect(r.totals).toEqual({ beforeTax: '48990.00', tax: '4881.00', total: '53871.00' });
    const inv1 = r.rows.find((x: { docNo: string }) => x.docNo === 'INV-0001');
    expect(inv1).toMatchObject({ balance: '15125.00', payment: { key: 'UNPAID', label: 'Unpaid · credited' }, eInvoice: { state: 'WAITING', label: 'Waiting for LHDN' } });
    expect(r.rows.find((x: { docNo: string }) => x.docNo === 'INV-L-0424')).toMatchObject({ eInvoice: { state: 'OLD_SYSTEM' }, to: null });
    expect(r.notes).toEqual(['Not released yet, so not listed: INV-0003 (waiting for approval), DN-0001 (draft), SR-0002 (draft).']);

    const credits = await api.get('sales/reports/invoice-register?type=credit-note', NA);
    expect(credits.rows.map((x: { docNo: string; total: string }) => `${x.docNo} ${x.total}`)).toEqual(['SR-L-0019 -594.00', 'SR-0001 -1375.00']);
  });

  it('e-Invoice status: four documents waiting for LHDN and September’s consolidated e-Invoice, as the lists count them', async () => {
    const r = await api.get('sales/reports/e-invoice-status', NA);
    expect(r).toMatchObject({ period: 'all', connected: false });
    expect(r.kpis).toEqual({
      waiting: { count: 4, amount: '32285.00', oldestDays: 8 },
      submitted: { count: 0 },
      problems: { count: 0 },
      consolidated: { month: '2026-09', count: 37, amount: '17600.00', due: '2026-10-07', late: false },
    });
    expect(r.rows.map((x: { docNo: string; typeLabel: string; days: number }) => `${x.docNo} ${x.typeLabel} ${x.days}`)).toEqual([
      'INV-0001 Invoice 8',
      'INV-0002 Invoice 7',
      'SR-0001 Credit note 5',
      'CS-0003 Cash sale 1',
    ]);
    expect((await api.get('sales/reports/e-invoice-status?type=cash-sale', NA)).rows).toEqual([expect.objectContaining({ docNo: 'CS-0003', customerName: 'Encik Faizal Hakim', problem: null })]);
    expect((await api.get('sales/reports/e-invoice-status?period=2026-08', NA)).rows).toEqual([]);
    expect((await api.call('GET', 'sales/reports/e-invoice-status?period=Sept', NA)).status).toBe(400);
  });

  it('once CO-0002 is released, Sales by customer shows the mockup’s cancelled and open amounts', async () => {
    const co = await api.get(`sales/cancel-orders/${await api.idOf('sales/cancel-orders', 'CO-0002', NA)}`, NA);
    expect((await api.call('POST', `sales/cancel-orders/${co.id}/release`, NA, { version: co.version })).body.status).toBe('RELEASED');

    const r = await api.get('sales/reports/by-customer', NA);
    expect(r.kpis.cancelled).toEqual({ amount: '4950.00', docs: ['CO-0002 · SO-0006'] });
    expect(r.kpis.open).toEqual({ amount: '236258.00' });
    expect(r.rows.find((x: { customerName: string }) => x.customerName === 'Klinik Sihat Jaya').open).toBe('0.00');
    // The order is done with its balance cancelled, so it is no longer open.
    const open = await api.get('sales/reports/open-orders', NA);
    expect(open.orders.map((o: { docNo: string }) => o.docNo)).not.toContain('SO-0006');
    expect(open.kpis.toDeliver.amount).toBe('236258.00');
  });
});
