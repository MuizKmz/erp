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

  describe('C2 · Items and units', () => {
    interface Item {
      id: string;
      code: string;
      name: string;
      status: string;
      version: number;
      standardCost: string | null;
      canSeeCost: boolean;
      allowedActions: string[];
      refusals: Record<string, string>;
      usage: Usage;
      prices: { priceListName: string; uomCode: string; unitPrice: string }[];
      activity: { message: string }[];
      conversions: { fromUom: string; toUom: string; factor: string }[];
    }
    const newItem = {
      code: 'ch-tst-01',
      name: 'Test stool',
      itemGroup: 'Seating',
      type: 'STOCK',
      baseUom: 'PCS',
      barcode: null,
      einvoiceClassification: '022',
      isPurchasable: true,
      isBuyToOrder: false,
      purchaseUom: null,
      purchaseTaxCode: 'SST10',
      preferredSupplierCode: 'S-0047',
      reorderLevel: '10',
      packSize: '1',
      isSellable: true,
      salesUom: 'BOX',
      salesTaxCode: 'SST10',
      standardCost: '55.00',
      conversions: [{ fromUom: 'BOX', toUom: 'PCS', factor: '4' }],
    };
    const FIELDS = Object.keys(newItem).filter((k) => k !== 'code');
    /** The fields a save sends, taken from a detail response. */
    const fieldsOf = (item: Item) => {
      const source = item as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of FIELDS) out[key] = source[key];
      out.conversions = item.conversions.map(({ fromUom, toUom, factor }) => ({ fromUom, toUom, factor }));
      return out;
    };
    let created: Item;

    it('lists the 39 items with their filters and tabs, 14 to a page', async () => {
      const page = await api.get<{ items: { code: string }[]; total: number; statusCounts: Record<string, number> }>('core/items?pageSize=14', 'FO');
      expect(page.total).toBe(39);
      expect(page.items).toHaveLength(14);
      expect(page.statusCounts).toMatchObject({ all: 39, active: 39, blocked: 0, discontinued: 0 });
      const total = async (query: string) => (await api.get<{ total: number }>(`core/items?${query}`)).total;
      expect(await total('group=Seating')).toBe(6);
      expect(await total('use=buy')).toBe(24);
      expect(await total('use=sell')).toBe(17);
      expect(await total('q=CH-DIN')).toBe(3);
    });

    it('shows CH-DIN-01 with its prices and why it can be neither blocked nor deleted', async () => {
      const id = (await api.prisma.mdmItem.findFirst({ where: { tenantId: TENANT_ID, code: 'CH-DIN-01' } }))!.id;
      const item = await api.get<Item>(`core/items/${id}`);
      expect(item.prices.map((p) => `${p.priceListName} ${p.unitPrice} ${p.uomCode}`)).toEqual(['Reseller 2026 235.00 PCS', 'Standard 2026 250.00 PCS']);
      expect(item.usage.documents).toBe(19);
      expect(item.allowedActions).toEqual(['edit']);
      expect(item.refusals.block).toBe('CH-DIN-01 is on 7 open documents (SO-0001, SO-0002, SO-0005 …). Finish or cancel them first.');
      expect(item.refusals.delete).toBe('CH-DIN-01 is used on 19 documents and in price lists (2), so it cannot be deleted. Discontinue it instead.');
      expect(item.standardCost).toBe('170.0000');
      const asAgent = await api.get<Item>(`core/items/${id}`, 'FO');
      expect(asAgent).toMatchObject({ allowedActions: [], canSeeCost: false, standardCost: null });

      expect(await api.call('POST', `core/items/${id}/block`, 'ADM', { version: item.version })).toMatchObject({ status: 409, body: { code: 'IN_USE' } });
      const rebased = await api.call('PATCH', `core/items/${id}`, 'ADM', { ...fieldsOf(item), baseUom: 'BOX', version: item.version });
      expect(rebased).toMatchObject({ status: 409, body: { message: 'CH-DIN-01 is used on 19 documents, so its base unit cannot change.' } });
    });

    it('creates an item that Purchase and Sales can use at once, with its activity and event', async () => {
      const res = await api.call('POST', 'core/items', 'ADM', newItem);
      expect(res.status).toBe(201);
      created = res.body as Item;
      expect(created).toMatchObject({ code: 'CH-TST-01', status: 'ACTIVE', usage: { documents: 0, open: [] } });
      expect(created.allowedActions).toEqual(['edit', 'block', 'discontinue', 'delete']);
      expect(created.activity.map((a) => a.message)).toEqual(['Item CH-TST-01 created']);
      const event = await api.prisma.sysOutbox.findFirst({ where: { aggregateId: created.id, name: 'mdm.item.created' } });
      expect(event?.payload).toMatchObject({ code: 'CH-TST-01', snapshot: { salesUom: 'BOX', conversions: [{ fromUom: 'BOX', toUom: 'PCS', factor: '4' }] } });

      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      expect((await port.findItems(TENANT_ID, ['CH-TST-01']))[0]).toMatchObject({ salesUomCode: 'BOX', preferredSupplierCode: 'S-0047', status: 'ACTIVE' });
      expect((await port.searchPurchasableItems(TENANT_ID, { q: 'CH-TST' })).map((i) => i.code)).toEqual(['CH-TST-01']);
      const home = await api.get<{ cards: { key: string; total: number }[] }>('core/dashboard');
      expect(home.cards.find((c) => c.key === 'items')?.total).toBe(40);
    });

    it('refuses what the rules do not allow, naming the field', async () => {
      const bad = async (patch: Record<string, unknown>) =>
        ((await api.call('POST', 'core/items', 'ADM', { ...newItem, code: 'CH-TST-02', ...patch })).body as { errors: { field: string; message: string }[] }).errors;
      expect(await bad({ code: 'CH-DIN-01' })).toContainEqual({ field: 'code', message: 'CH-DIN-01 is already the code of Dining chair, solid oak.' });
      expect(await bad({ conversions: [{ fromUom: 'BOX', toUom: 'PCS', factor: '2.5' }] })).toContainEqual({ field: 'conversions[0]', message: '1 BOX would be 2.5 PCS, but PCS allows no decimals.' });
      expect(await bad({ salesUom: 'TIN' })).toContainEqual({ field: 'salesUom', message: 'Sales unit TIN needs a conversion to the base unit (PCS).' });
      expect(await bad({ itemGroup: 'Nope' })).toContainEqual({ field: 'itemGroup', message: 'Pick the item group from the list.' });
      expect(await bad({ barcode: '9551234000011' })).toContainEqual({ field: 'barcode', message: 'Barcode 9551234000011 is already on CH-DIN-01.' });
      expect((await api.call('POST', 'core/items', 'LMY', { ...newItem, code: 'CH-TST-03' })).status).toBe(403);
    });

    it('saves a change with its before and after values, and refuses a stale save', async () => {
      const res = await api.call('PATCH', `core/items/${created.id}`, 'ADM', { ...fieldsOf(created), name: 'Test bar stool', version: created.version });
      expect(res.status).toBe(200);
      const saved = res.body as Item;
      expect(saved.version).toBe(created.version + 1);
      expect(saved.activity.map((a) => a.message)).toContain('Changed name Test stool → Test bar stool');
      const stale = await api.call('PATCH', `core/items/${created.id}`, 'ADM', { ...fieldsOf(created), name: 'Again', version: created.version });
      expect(stale).toMatchObject({ status: 409, body: { code: 'STALE_VERSION' } });
      created = saved;
    });

    it('blocks, activates and discontinues an unused item, then deletes it; its code is never used again', async () => {
      const act = async (action: string) => {
        const res = await api.call('POST', `core/items/${created.id}/${action}`, 'ADM', { version: created.version });
        expect(res.status).toBe(201);
        created = res.body as Item;
        return created.status;
      };
      expect(await act('block')).toBe('BLOCKED');
      expect(await act('activate')).toBe('ACTIVE');
      expect(await act('discontinue')).toBe('DISCONTINUED');
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      expect(await port.searchPurchasableItems(TENANT_ID, { q: 'CH-TST' })).toEqual([]);

      const gone = await api.call('DELETE', `core/items/${created.id}?version=${created.version}`, 'ADM');
      expect(gone).toMatchObject({ status: 200, body: { deleted: true, code: 'CH-TST-01' } });
      expect(await api.prisma.sysOutbox.count({ where: { aggregateId: created.id, name: 'mdm.item.deleted' } })).toBe(1);
      const again = await api.call('POST', 'core/items', 'ADM', newItem);
      expect(again.body).toMatchObject({ errors: [{ field: 'code', message: 'CH-TST-01 belonged to an item that was deleted. Codes are never used again.' }] });
    });

    it('lists units and conversions, adds and deletes an unused unit, and protects units in use', async () => {
      interface Units {
        units: { id: string; code: string; decimals: number; version: number; baseOf: number }[];
        conversions: { itemCode: string; text: string }[];
      }
      const list = await api.get<Units>('core/uoms', 'FO');
      expect(list.units).toHaveLength(9);
      expect(list.conversions).toEqual([expect.objectContaining({ itemCode: 'FB-OAK-01', text: '1 ROLL = 50 M' })]);
      const pcs = list.units.find((u) => u.code === 'PCS')!;
      const m = list.units.find((u) => u.code === 'M')!;

      const added = await api.call('POST', 'core/uoms', 'ADM', { code: 'ctn', name: 'Carton', decimals: 0 });
      expect(added.status).toBe(201);
      const ctn = (added.body as Units).units.find((u) => u.code === 'CTN')!;
      const raised = await api.call('PATCH', `core/uoms/${ctn.id}`, 'ADM', { name: 'Carton', decimals: 2, isActive: true, version: ctn.version });
      expect((raised.body as Units).units.find((u) => u.code === 'CTN')?.decimals).toBe(2);
      expect((await api.call('DELETE', `core/uoms/${ctn.id}?version=${ctn.version + 1}`, 'ADM')).status).toBe(200);

      const pcsDetail = await api.get<{ refusals: Record<string, string>; usage: Usage }>(`core/uoms/${pcs.id}`);
      expect(pcsDetail.usage.documents).toBeGreaterThan(0);
      expect(pcsDetail.refusals.delete).toMatch(/^PCS is used on \d+ documents/);
      expect(await api.call('DELETE', `core/uoms/${pcs.id}?version=${pcs.version}`, 'ADM')).toMatchObject({ status: 409, body: { code: 'IN_USE' } });
      const off = await api.call('PATCH', `core/uoms/${pcs.id}`, 'ADM', { name: 'Piece', decimals: 0, isActive: false, version: pcs.version });
      expect(off).toMatchObject({ status: 409, body: { code: 'UNIT_IN_USE' } });
      const down = await api.call('PATCH', `core/uoms/${m.id}`, 'ADM', { name: 'Metre', decimals: 0, isActive: true, version: m.version });
      expect(down).toMatchObject({ status: 409, body: { message: 'M is in use, so its decimals cannot go down (from 2 to 0). They can go up.' } });
    });
  });

  describe('C3 · Customers', () => {
    interface Customer {
      id: string;
      code: string;
      name: string;
      status: string;
      version: number;
      creditLimit: string | null;
      eInvoiceGap: string | null;
      agentName: string | null;
      branchName: string;
      priceListName: string;
      cameFromEnquiry: string | null;
      allowedActions: string[];
      refusals: Record<string, string>;
      usage: Usage;
      activity: { message: string }[];
      [key: string]: unknown;
    }
    const FIELDS = [
      'name', 'category', 'area', 'branchCode', 'defaultAgentCode', 'billingAddress', 'deliveryAddress', 'contactName', 'email', 'phone', 'tin',
      'idType', 'idNumber', 'salesTaxNo', 'serviceTaxNo', 'einvoiceEmail', 'taxMode', 'creditTermDays', 'creditLimit', 'overdueLimit', 'creditScope', 'priceListCode',
    ];
    const fieldsOf = (c: Customer) => Object.fromEntries(FIELDS.map((f) => [f, c[f]]));
    const newCustomer = {
      name: 'Taman Indah Hotel', category: 'Hospitality', area: 'Central', branchCode: 'HQ', defaultAgentCode: 'AR', contactName: 'En. Rahman', phone: '+60 3-1234 5678',
      tin: 'C25550012340', idType: 'BRN', idNumber: '202401012345', taxMode: 'EXCLUSIVE', creditTermDays: 30, creditLimit: '40000.00', overdueLimit: '5000.00', priceListCode: 'STD-2026',
    };
    const c0012 = async (user = 'ADM') => {
      const id = (await api.prisma.mdmCustomer.findFirst({ where: { tenantId: TENANT_ID, code: 'C-0012' } }))!.id;
      return api.get<Customer>(`core/customers/${id}`, user);
    };

    it('lists the 7 customers with their filters and tabs', async () => {
      const page = await api.get<{ total: number; statusCounts: Record<string, number> }>('core/customers', 'FO');
      expect(page.total).toBe(7);
      expect(page.statusCounts).toMatchObject({ all: 7, active: 7, prospect: 0, blocked: 0 });
      const codes = async (query: string) => (await api.get<{ items: { code: string }[] }>(`core/customers?${query}`)).items.map((c) => c.code);
      expect(await codes('branch=PNG')).toEqual(['C-0031', 'C-0056']);
      expect(await codes('category=Hospitality')).toEqual(['C-0012', 'C-0102']);
      expect(await codes('agent=FO')).toEqual(['C-0045', 'C-0056', 'C-0078']);
      expect(await codes('q=C2088')).toEqual(['C-0012']);
    });

    it('shows C-0012 with its names, the e-Invoice gap, and why it can be neither blocked nor deleted', async () => {
      const c = await c0012();
      expect(c).toMatchObject({ agentName: 'Aina Rahman', branchName: 'HQ Shah Alam', priceListName: 'Standard 2026', eInvoiceGap: 'No ID number yet. e-Invoices need it with the TIN.' });
      expect(c.usage.documents).toBe(23);
      expect(c.allowedActions).toEqual(['edit', 'editCredit']);
      expect(c.refusals.block).toBe('C-0012 is on 5 open documents (SO-0001, SO-0003, QT-0006 …). Finish or cancel them first.');
      expect(c.refusals.delete).toBe('C-0012 is used on 23 documents, so it cannot be deleted. Block it instead.');
      expect((await c0012('RI')).allowedActions).toEqual(['editCredit']);
      expect((await c0012('FO')).allowedActions).toEqual([]);
      expect(await api.call('POST', `core/customers/${c.id}/block`, 'ADM', { version: c.version })).toMatchObject({ status: 409, body: { code: 'IN_USE' } });
    });

    it('lets the Finance Manager change credit but nothing else, and a sales agent neither', async () => {
      const c = await c0012('RI');
      const res = await api.call('PATCH', `core/customers/${c.id}`, 'RI', { ...fieldsOf(c), creditLimit: '160000.00', version: c.version });
      expect(res.status).toBe(200);
      const saved = res.body as Customer;
      expect(saved.creditLimit).toBe('160000.00');
      expect(saved.activity.map((a) => a.message)).toContain('Changed credit limit 150000.00 → 160000.00');
      const phone = await api.call('PATCH', `core/customers/${c.id}`, 'RI', { ...fieldsOf(saved), phone: '+60 3-0000 0000', version: saved.version });
      expect(phone).toMatchObject({ status: 403, body: { message: 'Your role cannot do this. Permission needed: core.customer.edit.' } });
      const agent = await api.call('PATCH', `core/customers/${c.id}`, 'FO', { ...fieldsOf(saved), creditLimit: '999999.00', version: saved.version });
      expect(agent).toMatchObject({ status: 403, body: { message: 'Your role cannot do this. Permission needed: core.customer.credit.' } });
    });

    it('turns an enquiry prospect into customer C-0103, and Sales links the enquiry to it', async () => {
      const enquiry = await api.call('POST', 'sales/enquiries', 'AR', {
        isProspect: true, prospectName: 'Taman Indah Hotel', branchCode: 'HQ', contactName: 'En. Rahman', phone: '+60 3-1234 5678',
        enquiryTypeCode: 'HOSPITALITY', sourceCode: 'PHONE', agentCode: 'AR', details: { Rooms: '40' }, items: [],
      });
      expect(enquiry.status).toBe(201);
      const eq = enquiry.body as { id: string; docNo: string };

      const res = await api.call('POST', 'core/customers', 'ADM', { ...newCustomer, cameFromEnquiry: eq.docNo.toLowerCase() });
      expect(res.status).toBe(201);
      const created = res.body as Customer;
      expect(created).toMatchObject({ code: 'C-0103', status: 'ACTIVE', cameFromEnquiry: eq.docNo, eInvoiceGap: null });
      expect(created.activity.map((a) => a.message)).toEqual([`Customer C-0103 created from enquiry ${eq.docNo}`]);
      const event = await api.prisma.sysOutbox.findFirst({ where: { aggregateId: created.id, name: 'mdm.customer.created' } });
      expect(event?.payload).toMatchObject({ code: 'C-0103', enquiryNo: eq.docNo, snapshot: { name: 'Taman Indah Hotel', creditLimit: '40000.00' } });

      const linked = await api.until('the enquiry to get customer C-0103', async () => {
        const e = await api.get<{ customerCode: string | null; activity: { message: string }[] }>(`sales/enquiries/${eq.id}`, 'AR');
        return e.customerCode === 'C-0103' ? e : null;
      });
      expect(linked.activity.map((a) => a.message)).toContain('Taman Indah Hotel was added to Master Data as C-0103 · Taman Indah Hotel. Quotations can now be made.');
    });

    it('refuses what the rules do not allow, naming the field', async () => {
      const bad = async (patch: Record<string, unknown>) => ((await api.call('POST', 'core/customers', 'ADM', { ...newCustomer, ...patch })).body as { errors: { field: string; message: string }[] }).errors;
      expect(await bad({ cameFromEnquiry: 'EQ-L-0302' })).toContainEqual({ field: 'cameFromEnquiry', message: 'Type the enquiry number as Sales shows it, like EQ-2609-0010.' });
      expect(await bad({ category: 'Nope' })).toContainEqual({ field: 'category', message: 'Pick the category from the list.' });
      expect(await bad({ defaultAgentCode: 'LMY' })).toContainEqual({ field: 'defaultAgentCode', message: 'Pick an active sales agent.' });
      expect(await bad({ creditTermDays: 45 })).toContainEqual({ field: 'creditTermDays', message: 'Pick the credit term from the list.' });
      expect(await bad({ email: 'not-an-email' })).toContainEqual({ field: 'email', message: 'Type a valid email address.' });
      expect((await api.call('POST', 'core/customers', 'LMY', newCustomer)).status).toBe(403);
    });

    it('makes a prospect a customer, blocks and deletes it; its number is never used again', async () => {
      const res = await api.call('POST', 'core/customers', 'ADM', { ...newCustomer, name: 'Kedai Baru', status: 'PROSPECT' });
      let c = res.body as Customer;
      expect(c).toMatchObject({ code: 'C-0104', status: 'PROSPECT' });
      expect(c.allowedActions).toEqual(['edit', 'editCredit', 'activate', 'block', 'delete']);
      const act = async (action: string) => {
        const r = await api.call('POST', `core/customers/${c.id}/${action}`, 'ADM', { version: c.version });
        expect(r.status).toBe(201);
        c = r.body as Customer;
        return c.status;
      };
      expect(await act('activate')).toBe('ACTIVE');
      expect(c.activity.map((a) => a.message)).toContain('Prospect C-0104 made a customer');
      expect(await act('block')).toBe('BLOCKED');
      expect(await api.call('DELETE', `core/customers/${c.id}?version=${c.version}`, 'ADM')).toMatchObject({ status: 200, body: { deleted: true, code: 'C-0104' } });
      const next = await api.call('POST', 'core/customers', 'ADM', { ...newCustomer, name: 'Kedai Baru 2' });
      expect((next.body as Customer).code).toBe('C-0105');
    });
  });
});
