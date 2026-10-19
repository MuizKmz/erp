import { effectiveLayout, layoutErrors, MAX_CARDS } from './dashboard.rules';

describe('home dashboard layout (RPT-039)', () => {
  const allowed = new Set(['sales.recent_orders', 'sales.waiting_for_me', 'sales.ordered_by_agent', 'sales.top_customers']);
  const defaults = { cols: 2 as const, cards: ['sales.recent_orders', 'sales.waiting_for_me', 'sales.ordered_by_agent'] };

  it('takes 2 or 3 columns and charts the person may use, each once', () => {
    expect(layoutErrors({ cols: 3, cards: ['sales.top_customers', 'sales.recent_orders'] }, allowed)).toEqual([]);
    expect(layoutErrors({ cols: 2, cards: [] }, allowed)).toEqual([]);
    expect(layoutErrors({ cols: 4 as 2, cards: ['sales.recent_orders', 'sales.recent_orders', 'purchase.buy_soon'] }, allowed)).toEqual([
      { field: 'cols', message: 'Pick 2 or 3 columns.' },
      { field: 'cards', message: 'A chart can be on the dashboard once (sales.recent_orders).' },
      { field: 'cards', message: 'purchase.buy_soon is not a chart you can add here.' },
    ]);
  });

  it(`holds at most ${MAX_CARDS} charts`, () => {
    const many = Array.from({ length: MAX_CARDS + 1 }, (_, i) => `k${i}`);
    expect(layoutErrors({ cols: 2, cards: many }, new Set(many))).toEqual([{ field: 'cards', message: `A dashboard holds at most ${MAX_CARDS} charts. Remove one first.` }]);
  });

  it('starts from the module default, without the charts the person may not see', () => {
    expect(effectiveLayout(null, defaults, allowed)).toEqual({ layout: defaults, isDefault: true });
    expect(effectiveLayout(null, defaults, new Set(['sales.recent_orders']))).toEqual({ layout: { cols: 2, cards: ['sales.recent_orders'] }, isDefault: true });
  });

  it('keeps a saved layout, quietly leaving out charts no longer offered or allowed', () => {
    expect(effectiveLayout({ cols: 3, cards: ['sales.top_customers', 'sales.gone', 42, 'sales.top_customers'] }, defaults, allowed)).toEqual({
      layout: { cols: 3, cards: ['sales.top_customers'] },
      isDefault: false,
    });
    expect(effectiveLayout({ cols: 2, cards: [] }, defaults, allowed)).toEqual({ layout: { cols: 2, cards: [] }, isDefault: false });
    expect(effectiveLayout({ cols: 9, cards: 'nonsense' }, defaults, allowed)).toEqual({ layout: { cols: 2, cards: [] }, isDefault: false });
  });
});
