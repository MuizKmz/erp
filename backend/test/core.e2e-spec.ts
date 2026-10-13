import { reseed, startApi, type Api } from './e2e-helpers';

/**
 * Core module journeys (CLAUDE.md → Phase 3), against the API on fresh demo data. Each build step adds its journey
 * here; C1 checks the module is open, counts the master data it now looks after, and who may do what.
 */
describe('Core (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  describe('C1 · Module, schema and shell', () => {
    it('opens Core from the launcher', async () => {
      const modules = await api.get<{ items: { code: string; state: string; route: string | null }[] }>('me/modules', 'LMY');
      expect(modules.items.find((m) => m.code === 'core')).toMatchObject({ state: 'OPEN', route: '/core' });
    });

    it('counts the master data Purchase and Sales already use', async () => {
      const home = await api.get<{ cards: { key: string; total: number; parts: { key: string; count: number }[]; note?: string }[]; recent: unknown[] }>('core/dashboard', 'FO');
      const card = (key: string) => home.cards.find((c) => c.key === key)!;
      expect(home.cards.map((c) => c.key)).toEqual(['items', 'customers', 'suppliers', 'price-lists', 'tax-codes', 'uoms', 'warehouses']);
      expect(card('items').total).toBe(39);
      expect(card('customers').total).toBe(7);
      expect(card('suppliers').total).toBe(10);
      expect(card('warehouses').note).toMatch(/^\d+ locations$/);
      expect(home.recent).toEqual([]);
    });

    it('lets everyone look, only the Master Data Admin edit, and the Finance Manager change credit', async () => {
      const perms = async (user: string) => (await api.get<{ permissions: string[] }>('me', user)).permissions;
      const agent = await perms('FO');
      expect(agent).toContain('core.view');
      expect(agent).not.toContain('core.edit');
      const finance = await perms('RI');
      expect(finance).toEqual(expect.arrayContaining(['core.view', 'core.customer.credit']));
      expect(finance).not.toContain('core.edit');
      expect(await perms('ADM')).toEqual(['*']);
    });
  });
});
