import { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../src/master-data/master-data.port';
import { TENANT_ID } from '../prisma/seed/util';
import { reseed, startApi, type Api } from './e2e-helpers';

interface Usage {
  record: { code: string; name: string };
  documents: number;
  open: { module: string; docNo: string; docTypeLabel: string; statusLabel: string }[];
  references: { label: string; count: number }[];
  modules: { module: string; documents: number; open: number }[];
}

/**
 * Core module journeys (CLAUDE.md → Phase 3), against the API on fresh demo data. Each build step adds its journey
 * here; C1 checks the module is open, the home's numbers, who may do what, the record-usage check, and that dated
 * tax rates and prices leave Purchase and Sales with the same answers.
 */
describe('Core (end to end)', () => {
  let api: Api;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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
      expect(card('tax-codes').total).toBe(3);
      expect(card('warehouses').note).toMatch(/^\d+ locations$/);
      expect(home.recent).toEqual([]);
    });

    it('lists what needs attention, as the C01 mockup does', async () => {
      const home = await api.get<{ attention: { lead: string; text: string; to: string }[] }>('core/dashboard', 'FO');
      expect(home.attention.map((a) => `${a.lead} ${a.text}`)).toEqual([
        '39 items have no e-Invoice classification code yet. LHDN needs it on every e-Invoice line.',
        '8 suppliers have no TIN or ID number (walk-in shops left out). e-Invoices with them need both.',
        '6 customers have no ID number yet (the cash customer left out). e-Invoices need it with the TIN.',
        '3 purchasable items have no preferred supplier: OF-DSK-01, OF-TNR-01, SV-FRT-01. Buyers pick one each time.',
        'Item groups “Service” and “Services” look like the same group.',
      ]);
    });

    it('lets everyone look; buyers change suppliers, only the Purchasing Manager contract prices; Finance changes credit', async () => {
      const perms = async (user: string) => (await api.get<{ permissions: string[] }>('me', user)).permissions;
      expect(await perms('FO')).toEqual(expect.arrayContaining(['core.view']));
      expect((await perms('FO')).filter((p) => p.startsWith('core.'))).toEqual(['core.view']);
      const buyer = await perms('LMY');
      expect(buyer).toEqual(expect.arrayContaining(['core.view', 'core.supplier.edit']));
      expect(buyer).not.toContain('core.supplier.contract');
      expect(buyer).not.toContain('core.item.edit');
      expect(await perms('AZ')).toEqual(expect.arrayContaining(['core.supplier.edit', 'core.supplier.contract']));
      const finance = await perms('RI');
      expect(finance).toEqual(expect.arrayContaining(['core.view', 'core.customer.credit']));
      expect(finance).not.toContain('core.customer.edit');
      expect(await perms('ADM')).toEqual(['*']);
    });

    it('says where an item is used: CH-DIN-01 on 19 Sales documents, 7 still open', async () => {
      const usage = await api.get<Usage>('core/usage/item/CH-DIN-01', 'FO');
      expect(usage.record).toEqual({ code: 'CH-DIN-01', name: 'Dining chair, solid oak' });
      expect(usage.documents).toBe(19);
      expect(usage.open.map((o) => `${o.docNo} ${o.statusLabel}`)).toEqual([
        'SO-0001 Partial',
        'SO-0002 Pending approval',
        'SO-0005 Draft',
        'SO-0008 Pending approval',
        'QT-0010 Released',
        'QT-0012 Draft',
        'CS-0004 Draft',
      ]);
      expect(usage.modules).toEqual([
        { module: 'purchase', documents: 0, open: 0 },
        { module: 'sales', documents: 19, open: 7 },
      ]);
    });

    it('says where a customer and a supplier are used', async () => {
      const customer = await api.get<Usage>('core/usage/customer/C-0012');
      expect(customer.documents).toBe(23);
      expect(customer.open.map((o) => o.docNo)).toEqual(['SO-0001', 'SO-0003', 'QT-0006', 'DN-0001', 'EQ-L-0307']);
      const supplier = await api.get<Usage>('core/usage/supplier/S-0047');
      expect(supplier.documents).toBe(6);
      expect(supplier.open.map((o) => `${o.docNo} ${o.docTypeLabel} ${o.statusLabel}`)).toEqual([
        'PO-0003 Purchase order Pending approval',
        'RFQ-0003 RFQ Waiting',
        'RFQ-0004 RFQ Waiting',
      ]);
    });

    it('finds a tax code in both modules, an excluded item in Sales settings, and refuses unknown records', async () => {
      const tax = await api.get<Usage>('core/usage/tax-code/SST10');
      expect(tax.modules.every((m) => m.documents > 0)).toBe(true);
      const excluded = await api.prisma.salExcludedItem.findFirst({ where: { tenantId: TENANT_ID }, select: { itemCode: true } });
      const item = await api.get<Usage>(`core/usage/item/${excluded!.itemCode}`);
      expect(item.references).toEqual([expect.objectContaining({ label: 'Excluded items' })]);
      expect((await api.call('GET', 'core/usage/items/CH-DIN-01', 'ADM')).status).toBe(400);
      expect((await api.call('GET', 'core/usage/item/XX-NONE-01', 'ADM')).body).toMatchObject({ code: 'NOT_FOUND', message: 'Item XX-NONE-01 not found.' });
    });

    it('keeps today’s rate and price for Purchase and Sales when a future rate and price are added', async () => {
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      const today = '2026-09-29';
      const price = async (onDate: string) => (await port.listPrices(TENANT_ID, { priceListCode: 'STD-2026', itemCodes: ['CH-DIN-01'], onDate })).map((p) => p.unitPrice);
      const sst = async () => (await port.listTaxCodes(TENANT_ID)).find((t) => t.code === 'SST10')?.rate;

      expect(await price(today)).toEqual(['250.0000']);
      expect(await sst()).toBe('0.1000');

      const futurePrice = await api.prisma.mdmPriceListItem.create({
        data: { tenantId: TENANT_ID, priceListCode: 'STD-2026', itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: new Prisma.Decimal('260.00'), validFrom: day('2026-10-01') },
      });
      await api.prisma.mdmTaxCode.updateMany({ where: { tenantId: TENANT_ID, code: 'SST10' }, data: { validTo: day('2026-09-30') } });
      const futureRate = await api.prisma.mdmTaxCode.create({
        data: { tenantId: TENANT_ID, code: 'SST10', name: 'SST 8%', type: 'SALES_TAX', rate: new Prisma.Decimal('0.08'), validFrom: day('2026-10-01') },
      });
      try {
        expect(await price(today)).toEqual(['250.0000']);
        expect(await price('2026-10-01')).toEqual(['260.0000']);
        expect(await sst()).toBe('0.1000');
        const home = await api.get<{ cards: { key: string; total: number }[] }>('core/dashboard');
        expect(home.cards.find((c) => c.key === 'tax-codes')?.total).toBe(3);
      } finally {
        await api.prisma.mdmPriceListItem.delete({ where: { id: futurePrice.id } });
        await api.prisma.mdmTaxCode.delete({ where: { id: futureRate.id } });
        await api.prisma.mdmTaxCode.updateMany({ where: { tenantId: TENANT_ID, code: 'SST10' }, data: { validTo: null } });
      }
    });
  });
});
