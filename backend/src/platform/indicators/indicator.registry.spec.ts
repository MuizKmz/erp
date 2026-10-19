import { IndicatorRegistry } from './indicator.registry';
import type { IndicatorBoard, IndicatorDef } from './indicator.types';

const indicator = (key: string): IndicatorDef => ({
  key,
  title: key,
  description: '',
  kind: 'list',
  permission: 'sales.view',
  empty: 'Nothing to show.',
  compute: async () => ({ data: { kind: 'list', items: [] } }),
});

const board = (key: string, indicators: string[], defaults: string[]): IndicatorBoard => ({
  key,
  defaults: { cols: 2, cards: defaults },
  indicators: indicators.map(indicator),
});

describe('IndicatorRegistry', () => {
  it('keeps each module board under its own key', () => {
    const r = new IndicatorRegistry();
    r.register(board('sales', ['sales.a', 'sales.b'], ['sales.a']));
    r.register(board('purchase', ['purchase.a'], []));
    expect(r.board('sales').indicators.map((d) => d.key)).toEqual(['sales.a', 'sales.b']);
    expect(() => r.board('finance')).toThrow('Dashboard');
  });

  it('refuses a second board with the same key, an indicator declared twice and a default it does not have', () => {
    const r = new IndicatorRegistry();
    r.register(board('sales', ['sales.a'], []));
    expect(() => r.register(board('sales', ['sales.b'], []))).toThrow('already registered');
    expect(() => r.register(board('purchase', ['purchase.a', 'purchase.a'], []))).toThrow('declared twice');
    expect(() => r.register(board('core', ['core.a'], ['core.a', 'core.b']))).toThrow('unknown indicators: core.b');
  });
});
