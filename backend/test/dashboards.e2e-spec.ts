import { reseed, startApi, type Api } from './e2e-helpers';

interface Card {
  key: string;
  title: string;
  kind: string;
  month?: string;
  note?: string;
  failed: string | null;
  data: any;
}
interface Board {
  board: string;
  cols: number;
  isDefault: boolean;
  cards: Card[];
  catalogue: { key: string; onBoard: boolean }[];
  maxCards: number;
}

/**
 * Home dashboards (SRS RPT-035 to RPT-039): each person's charts on the Purchase and Sales homes, with the seed's
 * numbers, saved per person, checked, and limited by the data scopes like every other read.
 */
describe('Home dashboards (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  const card = (b: Board, key: string) => b.cards.find((c) => c.key === key)!;
  const bars = (c: Card) => (c.data.rows as { label: string; value: string }[]).map((r) => `${r.label} ${r.value}`);

  it('starts the Sales Manager on the default charts, with the numbers the Sales screens show', async () => {
    const b = await api.get<Board>('sales/dashboard/board', 'NA');
    expect(b).toMatchObject({ board: 'sales', cols: 2, isDefault: true, maxCards: 12 });
    expect(b.cards.map((c) => c.key)).toEqual(['sales.recent_orders', 'sales.waiting_for_me', 'sales.ordered_by_agent']);
    expect(b.cards.every((c) => c.failed === null)).toBe(true);
    expect(b.catalogue).toHaveLength(8);

    const recent = card(b, 'sales.recent_orders').data.rows as { cells: { no: { text: string } } }[];
    expect(recent).toHaveLength(7);
    expect(recent[0]!.cells.no.text).toBe('SO-0008');
    const waiting = card(b, 'sales.waiting_for_me').data.items as { title: string; chip: { label: string } }[];
    expect(waiting.map((w) => `${w.title.split(' · ')[0]} ${w.chip.label}`)).toEqual(['SO-0002 Credit', 'SO-0008 Credit', 'INV-0003 Price']);
    const agents = card(b, 'sales.ordered_by_agent');
    expect(agents.month).toBe('2026-09');
    expect(bars(agents)).toEqual(['Aina Rahman 134860.00', 'Lim Wei Jie 113498.00', 'Faizal Omar 25740.00']);
  });

  it('adds charts in the order picked, in 3 columns, and the new ones agree with the reports', async () => {
    const saved = await api.call<Board>('PUT', 'sales/dashboard/board', 'NA', {
      cols: 3,
      cards: ['sales.top_customers', 'sales.receivables_aging', 'sales.open_by_status', 'sales.by_month', 'sales.top_items', 'sales.recent_orders'],
    });
    expect(saved.status).toBe(200);
    const b = saved.body;
    expect(b).toMatchObject({ cols: 3, isDefault: false });
    expect(b.cards.map((c) => c.key)).toEqual(['sales.top_customers', 'sales.receivables_aging', 'sales.open_by_status', 'sales.by_month', 'sales.top_items', 'sales.recent_orders']);
    expect(b.catalogue.filter((c) => c.onBoard)).toHaveLength(6);

    // The same as Reports › Sales by customer for September.
    expect(bars(card(b, 'sales.top_customers'))).toEqual([
      'Kedai Perabot Maju 113498.00',
      'Hotel Seri Bayu Sdn Bhd 97900.00',
      'Villa Damai Resort 36960.00',
      'Restoran Selera Kampung 13090.00',
      'Klinik Sihat Jaya 8250.00',
    ]);
    // Balance due 84,640.00, of which 36,900.00 overdue (the Invoices list).
    const aging = card(b, 'sales.receivables_aging');
    const due = (aging.data.rows as { key: string; value: string }[]).reduce((s, r) => s + Number(r.value), 0);
    expect(due.toFixed(2)).toBe('84640.00');
    expect((aging.data.rows as { key: string; value: string }[]).find((r) => r.key === 'current')!.value).toBe('47740.00');
    expect(aging.note).toMatch(/^Balance due RM 84,640\.00 on \d+ invoices/);
    // The KPI card: 7 open, 2 released, 2 partial.
    expect(bars(card(b, 'sales.open_by_status'))).toEqual(['Draft 1', 'Pending approval 2', 'Released 2', 'Partial 2']);
    // September as Sales by customer: RM 274,098.00 ordered.
    const months = card(b, 'sales.by_month').data.points as { month: string; value: string }[];
    expect(months.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(months.at(-1)!.value).toBe('274098.00');
    expect((card(b, 'sales.top_items').data.rows as unknown[]).length).toBeLessThanOrEqual(5);

    // Another person's board is untouched.
    expect((await api.get<Board>('sales/dashboard/board', 'AR')).isDefault).toBe(true);
  });

  it('refuses a chart twice, one from another module, and more than 12', async () => {
    const twice = await api.call('PUT', 'sales/dashboard/board', 'NA', { cols: 2, cards: ['sales.top_items', 'sales.top_items', 'purchase.buy_soon'] });
    expect(twice.status).toBe(400);
    expect(twice.body.errors).toEqual([
      { field: 'cards', message: 'A chart can be on the dashboard once (sales.top_items).' },
      { field: 'cards', message: 'purchase.buy_soon is not a chart you can add here.' },
    ]);
    const many = await api.call('PUT', 'sales/dashboard/board', 'NA', { cols: 2, cards: Array.from({ length: 13 }, (_, i) => `sales.x${i}`) });
    expect(many.status).toBe(400);
    expect((await api.call('PUT', 'sales/dashboard/board', 'NA', { cols: 4, cards: [] })).status).toBe(400);
  });

  it('clears every chart, then goes back to the default ones', async () => {
    const cleared = await api.call<Board>('PUT', 'sales/dashboard/board', 'NA', { cols: 2, cards: [] });
    expect(cleared.body).toMatchObject({ cards: [], isDefault: false });
    const reset = await api.call<Board>('DELETE', 'sales/dashboard/board', 'NA');
    expect(reset.status).toBe(200);
    expect(reset.body.isDefault).toBe(true);
    expect(reset.body.cards.map((c) => c.key)).toEqual(['sales.recent_orders', 'sales.waiting_for_me', 'sales.ordered_by_agent']);
  });

  it('keeps each agent to their own customers (data scopes, RPT-036)', async () => {
    for (const who of ['AR', 'LWJ']) {
      await api.call('PUT', 'sales/dashboard/board', who, { cols: 2, cards: ['sales.top_customers'] });
    }
    expect(bars(card(await api.get<Board>('sales/dashboard/board', 'AR'), 'sales.top_customers'))).toEqual(['Hotel Seri Bayu Sdn Bhd 97900.00', 'Villa Damai Resort 36960.00']);
    expect(bars(card(await api.get<Board>('sales/dashboard/board', 'LWJ'), 'sales.top_customers'))).toEqual(['Kedai Perabot Maju 113498.00']);
  });

  it('shows the Purchase home charts as the Purchase home counted them, and keeps Sales charts from a buyer', async () => {
    const b = await api.get<Board>('purchase/dashboard/board', 'LMY');
    expect(b.cards.map((c) => c.key)).toEqual(['purchase.recent_orders', 'purchase.buy_soon', 'purchase.committed_by_supplier']);
    const spend = card(b, 'purchase.committed_by_supplier');
    // As PurHome: orders released this month (PO-0002; PO-0001 and PO-0004), the migrated ones left out.
    expect(bars(spend)).toEqual(['Mesin Jahit Pro 25000.00', 'Kilang Kain Jaya 7040.00']);
    expect(spend.note).toBe('Released orders only. PO-0003 (RM 46,200.00) counts once approved.');
    const buy = card(b, 'purchase.buy_soon').data.items as { title: string; aside: string }[];
    // As PurHome: the three closest to running out, below reorder level first. TB-DIN-06 (4 of 5) can wait.
    expect(buy.map((i) => `${i.title.split(' · ')[0]} ${i.aside}`)).toEqual(['SC-WOD-08 5 left · reorder 20', 'VR-LAC-01 3 left · reorder 10', 'CH-DIN-01 0 left · SO-0001 needs 40']);

    // PurHome's third bar is PO-0005, a draft in the seed: released (Purchase handbook, journey C step 2a), it joins.
    const po5 = await api.get<{ id: string; version: number }>(`purchase/orders/${await api.idOf('purchase/orders', 'PO-0005', 'LMY')}`, 'LMY');
    expect((await api.call<{ status: string }>('POST', `purchase/orders/${po5.id}/release`, 'LMY', { version: po5.version })).body.status).toBe('RELEASED');
    expect(bars(card(await api.get<Board>('purchase/dashboard/board', 'LMY'), 'purchase.committed_by_supplier'))).toEqual([
      'Mesin Jahit Pro 25000.00',
      'Kilang Kain Jaya 7040.00',
      'Tekstil Utara 1540.00',
    ]);

    const more = await api.call<Board>('PUT', 'purchase/dashboard/board', 'LMY', { cols: 2, cards: ['purchase.payables_aging', 'purchase.orders_by_status'] });
    const owed = card(more.body, 'purchase.payables_aging');
    expect((owed.data.rows as { key: string; value: string }[]).find((r) => r.key === 'current')!.value).toBe('5434.00');
    expect(bars(card(more.body, 'purchase.orders_by_status')).reduce((s, r) => s + Number(r.split(' ').at(-1)), 0)).toBe(11);

    expect((await api.call('GET', 'sales/dashboard/board', 'LMY')).status).toBe(403);
  });
});
