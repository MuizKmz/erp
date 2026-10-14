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

  describe('C4 · Suppliers', () => {
    interface Supplier {
      id: string;
      code: string;
      status: string;
      version: number;
      eInvoiceGap: string | null;
      contractPrices: { itemCode: string; unitPrice: string; validFrom: string; validTo: string | null; isCurrent: boolean }[];
      allowedActions: string[];
      refusals: Record<string, string>;
      usage: Usage;
      activity: { message: string }[];
      [key: string]: unknown;
    }
    const FIELDS = ['name', 'shortName', 'category', 'isWalkIn', 'contactName', 'email', 'phone', 'address', 'tin', 'idType', 'regNo', 'sstNo', 'serviceTaxNo', 'einvoiceEmail', 'paymentTermDays', 'currency'];
    const fieldsOf = (s: Supplier) => ({
      ...Object.fromEntries(FIELDS.map((f) => [f, s[f]])),
      contractPrices: s.contractPrices.map(({ itemCode, unitPrice, validFrom, validTo }) => ({ itemCode, unitPrice, validFrom, validTo })),
    });
    const newSupplier = {
      name: 'Kayu Jati Enterprise', shortName: 'Kayu Jati', category: 'Timber', isWalkIn: false, email: 'sales@kayujati.my', tin: 'C26660012340', idType: 'BRN', regNo: '202301054321',
      paymentTermDays: 30, currency: 'MYR', contractPrices: [] as unknown[],
    };
    const s0047 = async (user = 'ADM') => {
      const id = (await api.prisma.mdmSupplier.findFirst({ where: { tenantId: TENANT_ID, code: 'S-0047' } }))!.id;
      return api.get<Supplier>(`core/suppliers/${id}`, user);
    };

    it('lists the 10 suppliers with their filters and tabs', async () => {
      const page = await api.get<{ total: number; statusCounts: Record<string, number> }>('core/suppliers', 'FO');
      expect(page.total).toBe(10);
      expect(page.statusCounts).toMatchObject({ all: 10, active: 10, blocked: 0 });
      const codes = async (query: string) => (await api.get<{ items: { code: string }[] }>(`core/suppliers?${query}`)).items.map((s) => s.code);
      expect(await codes('walkIn=hidden')).toHaveLength(8);
      expect(await codes('walkIn=only')).toEqual(['S-0070', 'S-0071']);
      expect(await codes('supplies=Fabric')).toEqual(['S-0021']);
      expect(await codes('q=Kilang')).toEqual(['S-0021', 'S-0061']);
    });

    it('shows S-0047 with its contract price, and why it can be neither blocked nor deleted', async () => {
      const s = await s0047();
      expect(s.contractPrices).toEqual([{ itemId: expect.any(String), itemCode: 'SF-CUS-03', itemName: 'Custom 3-seater sofa, grey linen', uomCode: 'PCS', unitPrice: '2100.0000', validFrom: '2026-01-01', validTo: '2026-12-31', isCurrent: true }]);
      expect(s.eInvoiceGap).toBe('No TIN or ID number yet. e-Invoices with this supplier need both.');
      expect(s.allowedActions).toEqual(['edit', 'editContracts']);
      expect(s.refusals.block).toBe('S-0047 is on 3 open documents (PO-0003, RFQ-0003, RFQ-0004). Finish or cancel them first.');
      expect(s.refusals.delete).toBe('S-0047 is used on 6 documents and in items as preferred supplier (4), so it cannot be deleted. Block it instead.');
      expect((await s0047('LMY')).allowedActions).toEqual(['edit']);
      expect((await s0047('AZ')).allowedActions).toEqual(['edit', 'editContracts']);
      expect((await s0047('FO')).allowedActions).toEqual([]);
    });

    it('lets a buyer change the supplier but not its contract prices; the Purchasing Manager changes those and Purchase sees them', async () => {
      const s = await s0047('LMY');
      const phone = await api.call('PATCH', `core/suppliers/${s.id}`, 'LMY', { ...fieldsOf(s), phone: '+60 9-123 4567', version: s.version });
      expect(phone.status).toBe(200);
      const saved = phone.body as Supplier;
      expect(saved.activity.map((a) => a.message)).toContain('Changed phone (blank) → +60 9-123 4567');

      const cheaper = { ...fieldsOf(saved), contractPrices: [{ itemCode: 'SF-CUS-03', unitPrice: '2050.0000', validFrom: '2026-01-01', validTo: '2026-12-31' }], version: saved.version };
      expect(await api.call('PATCH', `core/suppliers/${s.id}`, 'LMY', cheaper)).toMatchObject({ status: 403, body: { message: 'Your role cannot do this. Permission needed: core.supplier.contract.' } });
      const byManager = await api.call('PATCH', `core/suppliers/${s.id}`, 'AZ', cheaper);
      expect(byManager.status).toBe(200);
      expect((byManager.body as Supplier).activity.map((a) => a.message)).toContain(
        'Changed contract prices SF-CUS-03 at 2100.0000, 1 Jan 2026 – 31 Dec 2026 → SF-CUS-03 at 2050.0000, 1 Jan 2026 – 31 Dec 2026',
      );
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      expect((await port.listContractPrices(TENANT_ID, { itemCodes: ['SF-CUS-03'], onDate: '2026-09-29' }))[0]?.unitPrice).toBe('2050.0000');
      expect((await api.call('PATCH', `core/suppliers/${s.id}`, 'FO', { ...fieldsOf(saved), phone: '1', version: saved.version + 1 })).status).toBe(403);
    });

    it('refuses what the rules do not allow, naming the field', async () => {
      const bad = async (patch: Record<string, unknown>) => ((await api.call('POST', 'core/suppliers', 'ADM', { ...newSupplier, ...patch })).body as { errors: { field: string; message: string }[] }).errors;
      expect(await bad({ paymentTermDays: 45 })).toContainEqual({ field: 'paymentTermDays', message: 'Pick the payment term from the list.' });
      expect(await bad({ currency: 'USD' })).toContainEqual({ field: 'currency', message: 'Only MYR for now: buying in another currency comes later.' });
      expect(await bad({ contractPrices: [{ itemCode: 'CH-DIN-02', unitPrice: '150', validFrom: '2026-10-01', validTo: null }] })).toContainEqual({
        field: 'contractPrices[0]',
        message: 'CH-DIN-02 cannot be bought, so it cannot have a contract price.',
      });
      const overlap = [
        { itemCode: 'TM-OAK-01', unitPrice: '80', validFrom: '2026-10-01', validTo: null },
        { itemCode: 'TM-OAK-01', unitPrice: '78', validFrom: '2027-01-01', validTo: null },
      ];
      expect(await bad({ contractPrices: overlap })).toContainEqual({ field: 'contractPrices[1]', message: 'Two contract prices for TM-OAK-01 overlap. Let one end before the other starts.' });
      expect((await api.call('POST', 'core/suppliers', 'LMY', { ...newSupplier, contractPrices: [overlap[0]] })).status).toBe(403);
    });

    it('lets a buyer add a supplier; it is blocked, activated and deleted, and its number is never used again', async () => {
      const res = await api.call('POST', 'core/suppliers', 'LMY', newSupplier);
      expect(res.status).toBe(201);
      let s = res.body as Supplier;
      expect(s).toMatchObject({ code: 'S-0072', status: 'ACTIVE', eInvoiceGap: null });
      expect(s.allowedActions).toEqual(['edit', 'block', 'delete']);
      const act = async (action: string) => {
        const r = await api.call('POST', `core/suppliers/${s.id}/${action}`, 'LMY', { version: s.version });
        expect(r.status).toBe(201);
        s = r.body as Supplier;
        return s.status;
      };
      expect(await act('block')).toBe('BLOCKED');
      expect(await act('activate')).toBe('ACTIVE');
      expect(await api.call('DELETE', `core/suppliers/${s.id}?version=${s.version}`, 'LMY')).toMatchObject({ status: 200, body: { deleted: true, code: 'S-0072' } });
      expect(((await api.call('POST', 'core/suppliers', 'LMY', newSupplier)).body as Supplier).code).toBe('S-0073');
    });
  });

  describe('C5 · Price lists', () => {
    interface PriceRow {
      itemCode: string;
      itemName: string;
      uomCode: string;
      unitPrice: string;
      validFrom: string;
      state: string;
      locked: boolean;
    }
    interface PriceList {
      id: string;
      code: string;
      name: string;
      currency: string;
      taxInclusive: boolean;
      validFrom: string;
      validTo: string | null;
      isActive: boolean;
      status: string;
      version: number;
      priceCount: number;
      prices: PriceRow[];
      customers: { code: string; name: string }[];
      documents: number;
      allowedActions: string[];
      refusals: Record<string, string>;
      activity: { message: string }[];
    }
    type Errors = { errors: { field: string; message: string }[] };
    type NewRow = { itemCode: string; uomCode: string; unitPrice: string; validFrom: string };
    const std = async (user = 'ADM') => {
      const id = (await api.prisma.mdmPriceList.findFirst({ where: { tenantId: TENANT_ID, code: 'STD-2026' } }))!.id;
      return api.get<PriceList>(`core/price-lists/${id}`, user);
    };
    /** What the form sends back: the list's fields and its prices from today on (history stays on the server). */
    const bodyOf = (l: PriceList, prices: NewRow[] = l.prices.filter((p) => !p.locked)) => ({
      name: l.name,
      currency: l.currency,
      taxInclusive: l.taxInclusive,
      validFrom: l.validFrom,
      validTo: l.validTo,
      prices: prices.map(({ itemCode, uomCode, unitPrice, validFrom }) => ({ itemCode, uomCode, unitPrice, validFrom })),
      version: l.version,
    });
    const row = (p: Partial<NewRow> = {}): NewRow => ({ itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: '260', validFrom: '2026-11-01', ...p });
    const newList = { code: 'PROMO-2027', name: 'Promotion 2027', currency: 'MYR', taxInclusive: false, validFrom: '2026-11-01', validTo: null, isActive: true, prices: [] as NewRow[] };

    /** Seeded: 6 customers on STD-2026. The C3 journey above adds its new customers to it too. */
    const stdCustomers = () => api.prisma.mdmCustomer.count({ where: { tenantId: TENANT_ID, priceListCode: 'STD-2026' } });

    it('lists the two price lists as C08 shows them', async () => {
      const page = await api.get<{ total: number; items: Record<string, unknown>[] }>('core/price-lists', 'AR');
      const n = await stdCustomers();
      expect(page.total).toBe(2);
      expect(page.items.map((l) => [l.code, l.name, l.currency, l.prices, l.taxText, l.validFrom, l.validTo, l.usedBy, l.statusLabel])).toEqual([
        ['RES-2026', 'Reseller 2026', 'MYR', 6, 'Exclude tax', '2026-01-01', '2026-12-31', '1 customer', 'Active'],
        ['STD-2026', 'Standard 2026', 'MYR', 17, 'Exclude tax', '2026-01-01', '2026-12-31', `${n} customers`, 'Active'],
      ]);
    });

    it('shows STD-2026 with its 17 prices as history, its customers, and why it can be neither deactivated nor deleted', async () => {
      const l = await std();
      expect(l.priceCount).toBe(17);
      expect(l.prices[0]).toEqual({
        itemId: expect.any(String),
        itemCode: 'BD-KNG-01',
        itemName: 'King bed frame, teak',
        uomCode: 'PCS',
        unitPrice: '1400.0000',
        validFrom: '2026-01-01',
        state: 'current',
        locked: true,
      });
      expect(l.prices.every((p) => p.locked && p.state === 'current')).toBe(true);
      const n = await stdCustomers();
      expect(l.customers).toHaveLength(n);
      expect(l.customers.map((c) => c.code)).toEqual(expect.arrayContaining(['C-0012', 'C-0045', 'C-0056', 'C-0078', 'C-0102', 'C-CASH']));
      expect(l.documents).toBe(24);
      expect(l.allowedActions).toEqual(['edit']);
      expect(l.refusals).toEqual({
        deactivate: `STD-2026 is the price list of ${n} customers (C-0012, C-0045, C-0056 …). Move them to another price list first.`,
        delete: `STD-2026 is used on 24 documents and in customers (${n}), so it cannot be deleted. Deactivate it instead.`,
      });
      expect((await std('LMY')).allowedActions).toEqual([]);
      expect((await api.call('POST', `core/price-lists/${l.id}/deactivate`, 'ADM', { version: l.version })).status).toBe(409);
    });

    it('adds a price that waits for its date; Sales keeps today’s price until then', async () => {
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      const price = async (onDate: string) => (await port.listPrices(TENANT_ID, { priceListCode: 'STD-2026', itemCodes: ['CH-DIN-01'], onDate })).map((p) => p.unitPrice);
      const l = await std();
      const res = await api.call('PATCH', `core/price-lists/${l.id}`, 'ADM', bodyOf(l, [row()]));
      expect(res.status).toBe(200);
      const saved = res.body as PriceList;
      expect(saved.priceCount).toBe(17);
      expect(saved.prices.filter((p) => p.itemCode === 'CH-DIN-01').map((p) => [p.unitPrice, p.validFrom, p.state, p.locked])).toEqual([
        ['250.0000', '2026-01-01', 'current', true],
        ['260.0000', '2026-11-01', 'waiting', false],
      ]);
      expect(saved.activity[0]?.message).toBe('Prices: added CH-DIN-01 PCS from 1 Nov 2026 at 260.00');
      expect(await price('2026-09-29')).toEqual(['250.0000']);
      expect(await price('2026-11-01')).toEqual(['260.0000']);
      const event = await api.prisma.sysOutbox.findFirst({ where: { aggregateId: l.id, name: 'mdm.price_list.updated' }, orderBy: { seq: 'desc' } });
      expect(event?.payload).toMatchObject({ code: 'STD-2026', changedFields: ['price:CH-DIN-01|PCS|2026-11-01'] });

      // Sending no rows never touches history: removing the waiting price leaves the 17 seeded ones.
      const back = await api.call('PATCH', `core/price-lists/${l.id}`, 'ADM', bodyOf(saved, []));
      expect((back.body as PriceList).prices).toHaveLength(17);
      expect((back.body as PriceList).activity[0]?.message).toBe('Prices: removed CH-DIN-01 PCS from 1 Nov 2026 (260.00)');
    });

    it('refuses what the rules do not allow, naming the field', async () => {
      const l = await std();
      const errors = async (patch: Record<string, unknown>, user = 'ADM') => {
        const r = await api.call('PATCH', `core/price-lists/${l.id}`, user, { ...bodyOf(l), ...patch });
        return r.status === 400 ? (r.body as Errors).errors : r.status;
      };
      expect(await errors({ prices: [row({ validFrom: '2026-09-01' })] })).toEqual([{ field: 'prices[0]', message: 'A price cannot start before today (29 Sep 2026). Earlier prices are history.' }]);
      expect(await errors({ prices: [row({ unitPrice: '0' })] })).toEqual([{ field: 'prices[0]', message: 'A price must be more than 0.' }]);
      expect(await errors({ prices: [row({ uomCode: 'BOX' })] })).toEqual([{ field: 'prices[0]', message: 'BOX is not a unit of CH-DIN-01. Pick PCS.' }]);
      expect(await errors({ prices: [row({ itemCode: 'TM-OAK-01' })] })).toEqual([{ field: 'prices[0]', message: 'TM-OAK-01 cannot be sold, so it cannot have a price.' }]);
      expect(await errors({ prices: [row(), row({ unitPrice: '255' })] })).toEqual([
        { field: 'prices[1]', message: 'CH-DIN-01 already has a price in PCS from 1 Nov 2026. Change that row instead.' },
      ]);
      expect(await errors({ prices: [row({ validFrom: '2027-01-04' })] })).toEqual([{ field: 'prices[0]', message: 'The list ends on 31 Dec 2026, so a price cannot start after that.' }]);
      expect(await errors({ validFrom: '2026-02-01' })).toEqual([{ field: 'validFrom', message: 'A price starts on 1 Jan 2026, so the list cannot start later.' }]);
      expect(await errors({ taxInclusive: true })).toEqual([
        { field: 'taxInclusive', message: 'Prices on this list have started, so whether they include tax cannot change. Start a new price list instead.' },
      ]);
      expect(await errors({ name: 'Standard' }, 'LMY')).toBe(403);
      expect(await errors({ name: 'Standard', version: l.version + 1 })).toBe(409);
    });

    it('creates a price list that is deactivated, activated and deleted, and its code is never used again', async () => {
      const res = await api.call('POST', 'core/price-lists', 'ADM', { ...newList, code: 'promo-2027', prices: [row({ unitPrice: '229.90' })] });
      expect(res.status).toBe(201);
      let l = res.body as PriceList;
      expect(l).toMatchObject({ code: 'PROMO-2027', status: 'ACTIVE', priceCount: 1, customers: [], documents: 0 });
      expect(l.allowedActions).toEqual(['edit', 'deactivate', 'delete']);
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      const act = async (action: string) => {
        const r = await api.call('POST', `core/price-lists/${l.id}/${action}`, 'ADM', { version: l.version });
        expect(r.status).toBe(201);
        l = r.body as PriceList;
        return (await port.listPriceLists(TENANT_ID)).map((p) => p.code);
      };
      expect(await act('deactivate')).toEqual(['RES-2026', 'STD-2026']);
      expect(await act('activate')).toEqual(['PROMO-2027', 'RES-2026', 'STD-2026']);
      expect(await api.call('DELETE', `core/price-lists/${l.id}?version=${l.version}`, 'ADM')).toMatchObject({ status: 200, body: { deleted: true, code: 'PROMO-2027' } });
      expect(await api.prisma.mdmPriceListItem.count({ where: { tenantId: TENANT_ID, priceListCode: 'PROMO-2027' } })).toBe(0);
      expect(((await api.call('POST', 'core/price-lists', 'ADM', newList)).body as Errors).errors).toEqual([
        { field: 'code', message: 'PROMO-2027 belonged to a price list that was deleted. Codes are never used again.' },
      ]);
      expect(((await api.call('POST', 'core/price-lists', 'ADM', { ...newList, code: 'STD-2026' })).body as Errors).errors).toEqual([
        { field: 'code', message: 'STD-2026 is already the code of Standard 2026.' },
      ]);
    });

    it('offers sellable items with the units they can be priced in', async () => {
      const found = await api.get<{ items: { code: string; units: string[] }[] }>('core/lookups/sellable-items?q=CH-DIN', 'ADM');
      expect(found.items.map((i) => [i.code, i.units])).toEqual([
        ['CH-DIN-01', ['PCS']],
        ['CH-DIN-02', ['PCS']],
        ['CH-DIN-09', ['PCS']],
      ]);
    });
  });

  describe('C6 · Tax codes, reference lists, warehouses', () => {
    type Errors = { errors: { field: string; message: string }[] };
    const errorsOf = (r: { status: number; body: unknown }) => (r.status === 400 ? (r.body as Errors).errors : r.status);

    describe('tax codes (C10)', () => {
      interface TaxPeriod {
        id: string;
        name: string;
        rate: string;
        validFrom: string;
        validTo: string | null;
        state: string;
        removable: boolean;
      }
      interface TaxCode {
        code: string;
        name: string;
        type: string;
        isActive: boolean;
        version: number;
        periods: TaxPeriod[];
        documents: number;
        allowedActions: string[];
        refusals: Record<string, string>;
        activity: { message: string }[];
      }
      const tax = (code: string, user = 'ADM') => api.get<TaxCode>(`core/tax-codes/${code}`, user);
      const port = () => api.app.get<MasterDataPort>(MASTER_DATA_PORT);

      it('lists the three codes as C10 shows them', async () => {
        const page = await api.get<{ codes: Record<string, unknown>[]; canEdit: boolean }>('core/tax-codes', 'AR');
        expect(page.canEdit).toBe(false);
        expect(page.codes.map((c) => [c.code, c.name, c.typeLabel, c.rate, c.country, c.validFrom, c.validTo, `${c.buying as number} buying · ${c.selling as number} selling`, c.isActive])).toEqual([
          ['EXEMPT', 'Exempt', 'Exempt', '0%', 'MY', '2018-09-01', null, '6 buying · 0 selling', true],
          ['SST10', 'SST 10%', 'Sales tax', '10%', 'MY', '2018-09-01', null, '31 buying · 17 selling', true],
          ['SVC8', 'Service tax 8%', 'Service tax', '8%', 'MY', '2024-03-01', null, '2 buying · 1 selling', true],
        ]);
      });

      it('adds a rate that waits for its date, closing the old one the day before, and removes it again', async () => {
        const before = await tax('SST10');
        expect(before.refusals).toEqual({
          delete: 'SST10 is used on 90 documents and in items (31), so it cannot be deleted. Make it inactive instead.',
          deactivate: 'SST10 is the tax of 31 active items (BD-KNG-01, CB-SHO-01, CH-BAR-01 …). Give them another tax code first.',
        });
        const res = await api.call('POST', 'core/tax-codes/SST10/rates', 'ADM', { rate: '8', validFrom: '2027-01-01', name: 'SST 8%', version: before.version });
        expect(res.status).toBe(201);
        const after = res.body as TaxCode;
        expect(after.periods.map((p) => [p.rate, p.validFrom, p.validTo, p.state, p.removable])).toEqual([
          ['10%', '2018-09-01', '2026-12-31', 'current', false],
          ['8%', '2027-01-01', null, 'waiting', true],
        ]);
        expect(after.name).toBe('SST 8%');
        expect(after.activity[0]?.message).toBe('New rate for SST10: 8% from 1 Jan 2027');
        // Purchase and Sales still get today's rate and name.
        expect((await port().listTaxCodes(TENANT_ID)).find((t) => t.code === 'SST10')).toEqual({ code: 'SST10', name: 'SST 10%', rate: '0.1000' });
        const listed = (await api.get<{ codes: { code: string; rate: string; validTo: string | null; next: unknown }[] }>('core/tax-codes')).codes.find((c) => c.code === 'SST10');
        expect(listed).toMatchObject({ rate: '10%', validTo: '2026-12-31', next: { rate: '8%', validFrom: '2027-01-01' } });
        const event = await api.prisma.sysOutbox.findFirst({ where: { aggregateId: before.periods[0]!.id, name: 'mdm.tax_code.updated' }, orderBy: { seq: 'desc' } });
        expect(event?.payload).toMatchObject({ code: 'SST10', changedFields: ['name', 'rates'] });

        const waiting = after.periods[1]!;
        const removed = await api.call('DELETE', `core/tax-codes/SST10/rates/${waiting.id}?version=${after.version}`, 'ADM');
        expect(removed.status).toBe(200);
        expect((removed.body as TaxCode).periods.map((p) => [p.rate, p.validTo])).toEqual([['10%', null]]);
        expect((removed.body as TaxCode).name).toBe('SST 10%');
      });

      it('refuses what the rules do not allow', async () => {
        const sst = await tax('SST10');
        const rate = (body: Record<string, unknown>, code = 'SST10', user = 'ADM') => api.call('POST', `core/tax-codes/${code}/rates`, user, { rate: '8', validFrom: '2027-01-01', name: 'SST 8%', version: sst.version, ...body });
        expect(errorsOf(await rate({ validFrom: '2026-09-01' }))).toEqual([{ field: 'validFrom', message: 'A new rate cannot start before today (29 Sep 2026). Earlier rates are history.' }]);
        expect(errorsOf(await rate({ rate: '120' }))).toEqual([{ field: 'rate', message: 'A rate is between 0% and 100%.' }]);
        const exempt = await tax('EXEMPT');
        expect(errorsOf(await rate({ rate: '5', version: exempt.version }, 'EXEMPT'))).toEqual([{ field: 'rate', message: 'An exempt code has a 0% rate.' }]);
        expect(errorsOf(await rate({}, 'SST10', 'LMY'))).toBe(403);
        expect(errorsOf(await rate({ version: sst.version + 1 }))).toBe(409);

        const patch = (code: string, t: TaxCode, body: Record<string, unknown>) => api.call('PATCH', `core/tax-codes/${code}`, 'ADM', { name: t.name, type: t.type, isActive: t.isActive, version: t.version, ...body });
        expect(errorsOf(await patch('SST10', sst, { type: 'SERVICE_TAX' }))).toEqual([
          { field: 'type', message: 'SST10 is used on 90 documents, so its type cannot change. Add a new tax code instead.' },
        ]);
        const svc = await tax('SVC8');
        expect(await patch('SVC8', svc, { isActive: false })).toMatchObject({ status: 409, body: { message: 'SVC8 is the tax of 2 active items (SV-DEL-01, SV-INS-01). Give them another tax code first.' } });
        expect((await api.call('DELETE', `core/tax-codes/${sst.code}/rates/${sst.periods[0]!.id}?version=${sst.version}`, 'ADM')).body).toMatchObject({
          message: 'This is the code’s only rate. Delete the code instead.',
        });
      });

      it('adds a code that is renamed, made inactive, activated and deleted, and its code is never used again', async () => {
        const res = await api.call('POST', 'core/tax-codes', 'ADM', { code: 'zero', name: 'Zero rated', type: 'EXEMPT', rate: '0', validFrom: '2026-10-01' });
        expect(res.status).toBe(201);
        let t = res.body as TaxCode;
        expect(t).toMatchObject({ code: 'ZERO', type: 'EXEMPT', documents: 0, allowedActions: ['edit', 'newRate', 'delete'] });
        const patch = async (body: Record<string, unknown>) => {
          const r = await api.call('PATCH', 'core/tax-codes/ZERO', 'ADM', { name: t.name, type: t.type, isActive: t.isActive, version: t.version, ...body });
          expect(r.status).toBe(200);
          t = r.body as TaxCode;
        };
        await patch({ name: 'Zero-rated supply' });
        expect(t.activity[0]?.message).toBe('Tax code ZERO: changed name Zero rated → Zero-rated supply');
        await patch({ isActive: false });
        expect(t.isActive).toBe(false);
        await patch({ isActive: true });
        expect(await api.call('DELETE', `core/tax-codes/ZERO?version=${t.version}`, 'ADM')).toMatchObject({ status: 200, body: { deleted: true, code: 'ZERO' } });
        expect(errorsOf(await api.call('POST', 'core/tax-codes', 'ADM', { code: 'ZERO', name: 'Zero', type: 'EXEMPT', rate: '0', validFrom: '2026-10-01' }))).toEqual([
          { field: 'code', message: 'ZERO belonged to a tax code that was deleted. Codes are never used again.' },
        ]);
        expect(errorsOf(await api.call('POST', 'core/tax-codes', 'ADM', { code: 'SST10', name: 'Again', type: 'SALES_TAX', rate: '10', validFrom: '2026-10-01' }))).toEqual([
          { field: 'code', message: 'SST10 is already the code of SST 10%.' },
        ]);
      });
    });

    describe('reference lists (C12)', () => {
      interface Entry {
        id: string;
        name: string;
        days?: number;
        isActive: boolean;
        version: number;
        usedBy: string;
        refusals: Record<string, string>;
      }
      type Lists = { lists: Record<string, Entry[]>; lookAlike: string | null; canEdit: boolean };
      const lists = (user = 'ADM') => api.get<Lists>('core/reference', user);
      const entry = async (list: string, name: string) => (await lists()).lists[list]!.find((e) => e.name === name)!;
      const patch = (list: string, e: Entry, body: Record<string, unknown>, user = 'ADM') =>
        api.call('PATCH', `core/reference/${list}/${e.id}`, user, { name: e.name, days: e.days, isActive: e.isActive, version: e.version, ...body });

      it('shows the four lists with who uses each entry, and the look-alike groups', async () => {
        const all = await lists('AR');
        expect(all.canEdit).toBe(false);
        expect(Object.fromEntries(Object.entries(all.lists).map(([k, v]) => [k, v.length]))).toEqual({ 'item-groups': 19, 'customer-categories': 6, areas: 2, 'credit-terms': 2 });
        expect(all.lists['item-groups']!.slice(0, 4).map((e) => [e.name, e.usedBy])).toEqual([
          ['Beds', '1 item'],
          ['Cabinets', '1 item'],
          ['Electrical', '1 item'],
          ['Fabric', '2 items'],
        ]);
        expect(all.lists['credit-terms']!.map((e) => [e.name, e.days])).toEqual([
          ['Cash', 0],
          ['30 days', 30],
        ]);
        expect(all.lookAlike).toBe('“Service” and “Services” look like the same group. Moving SV-DEL-01 to “Service” would leave one: change the group on the item, then make “Services” inactive.');
      });

      it('keeps a name in use, makes it inactive so new records cannot pick it, and adds, renames and deletes an unused one', async () => {
        const sofas = await entry('item-groups', 'Sofas');
        expect(errorsOf(await patch('item-groups', sofas, { name: 'Sofa' }))).toEqual([
          { field: 'name', message: '“Sofas” is used by 2 items, so its name cannot change. Add the new name, move them to it, then make “Sofas” inactive.' },
        ]);
        expect(await api.call('DELETE', `core/reference/item-groups/${sofas.id}?version=${sofas.version}`, 'ADM')).toMatchObject({
          status: 409,
          body: { message: '“Sofas” is used by 2 items, so it cannot be deleted. Make it inactive instead.' },
        });
        expect((await patch('item-groups', sofas, { isActive: false })).status).toBe(200);
        expect((await api.get<{ itemGroups: string[] }>('core/lookups/item-form')).itemGroups).not.toContain('Sofas');
        expect((await patch('item-groups', await entry('item-groups', 'Sofas'), { isActive: true })).status).toBe(200);

        expect((await api.call('POST', 'core/reference/item-groups', 'ADM', { name: 'Outdoor' })).status).toBe(201);
        const outdoor = await entry('item-groups', 'Outdoor');
        expect(outdoor).toMatchObject({ usedBy: 'Not used', refusals: {} });
        expect((await patch('item-groups', outdoor, { name: 'Outdoor furniture' })).status).toBe(200);
        const renamed = await entry('item-groups', 'Outdoor furniture');
        expect(await api.call('DELETE', `core/reference/item-groups/${renamed.id}?version=${renamed.version}`, 'ADM')).toMatchObject({ status: 200 });
        expect(errorsOf(await api.call('POST', 'core/reference/item-groups', 'ADM', { name: 'beds' }))).toEqual([{ field: 'name', message: '“Beds” is already on the list.' }]);
        expect(errorsOf(await api.call('POST', 'core/reference/areas', 'LMY', { name: 'Southern' }))).toBe(403);
      });

      it('adds a credit term that customers and suppliers can pick; days in use never change', async () => {
        expect((await api.call('POST', 'core/reference/credit-terms', 'ADM', { name: '60 days', days: 60 })).status).toBe(201);
        expect((await api.get<{ creditTerms: { days: number }[] }>('core/lookups/customer-form')).creditTerms.map((t) => t.days)).toEqual([0, 30, 60]);
        expect((await api.get<{ paymentTerms: { days: number }[] }>('core/lookups/supplier-form')).paymentTerms.map((t) => t.days)).toEqual([0, 30, 60]);
        expect(errorsOf(await api.call('POST', 'core/reference/credit-terms', 'ADM', { name: 'Net 60', days: 60 }))).toEqual([{ field: 'days', message: '60 days already gives 60 days.' }]);
        expect(errorsOf(await api.call('POST', 'core/reference/credit-terms', 'ADM', { name: 'Net 45' }))).toEqual([{ field: 'days', message: 'Give the days to pay, 0 for cash.' }]);
        const thirty = await entry('credit-terms', '30 days');
        expect((errorsOf(await patch('credit-terms', thirty, { days: 45 })) as Errors['errors'])[0]).toMatchObject({ field: 'days', message: expect.stringMatching(/^30 days is used by \d+ customers · \d+ suppliers, so its days cannot change\./) });
        expect((await patch('credit-terms', thirty, { name: 'Net 30' })).status).toBe(200);
      });
    });

    describe('warehouses (C13)', () => {
      interface WarehouseRow {
        id: string;
        code: string;
        name: string;
        branchCode: string;
        branch: string;
        isActive: boolean;
        version: number;
        locations: { code: string; name: string; isActive: boolean }[];
      }
      type Warehouses = { warehouses: WarehouseRow[]; branches: { code: string; name: string }[]; canEdit: boolean };
      const list = (user = 'ADM') => api.get<Warehouses>('core/warehouses', user);
      const row = async (code: string) => (await list()).warehouses.find((w) => w.code === code)!;
      const patch = (w: WarehouseRow, body: Record<string, unknown>, user = 'ADM') =>
        api.call('PATCH', `core/warehouses/${w.id}`, user, { name: w.name, branchCode: w.branchCode, isActive: w.isActive, version: w.version, ...body });

      it('lists the three warehouses with their locations, read only', async () => {
        const all = await list('AR');
        expect(all.canEdit).toBe(false);
        expect(all.warehouses.map((w) => [w.code, w.name, w.branch, w.locations.length, w.isActive])).toEqual([
          ['HQ-DMG', 'HQ Shah Alam · damaged goods', 'HQ · HQ Shah Alam', 1, true],
          ['HQ-MAIN', 'HQ Shah Alam · main', 'HQ · HQ Shah Alam', 5, true],
          ['PNG-MAIN', 'Penang · main', 'PNG · Penang Branch', 2, true],
        ]);
        expect(all.warehouses[1]!.locations.map((l) => [l.code, l.name])).toEqual([
          ['HQ-MAIN/B-01', 'Rack B-01'],
          ['HQ-MAIN/B-02', 'Rack B-02'],
          ['HQ-MAIN/B-03', 'Rack B-03'],
          ['HQ-MAIN/B-04', 'Rack B-04'],
          ['HQ-MAIN/B-05', 'Rack B-05'],
        ]);
      });

      it('keeps HQ-MAIN’s branch and status while documents use it', async () => {
        const hq = await row('HQ-MAIN');
        const detail = await api.get<{ allowedActions: string[]; refusals: Record<string, string> }>(`core/warehouses/${hq.id}`);
        expect(detail.allowedActions).toEqual(['edit']);
        expect(detail.refusals).toMatchObject({
          delete: 'HQ-MAIN is used on 73 documents and in locations (5), so it cannot be deleted. Make it inactive instead.',
          deactivate: 'HQ-MAIN is on 18 open documents (PO-0001, PO-0003, PO-0005 …). Finish or cancel them first.',
        });
        expect(errorsOf(await patch(hq, { branchCode: 'PNG' }))).toEqual([
          { field: 'branchCode', message: 'HQ-MAIN is used on 73 documents, so its branch cannot change. Add a new warehouse for the other branch instead.' },
        ]);
        expect((await patch(hq, { isActive: false })).status).toBe(409);
        expect((await patch(hq, { name: 'HQ Shah Alam · main store' }, 'LMY')).status).toBe(403);
      });

      it('adds a warehouse with no locations, changes its branch while unused, makes it inactive and deletes it', async () => {
        expect((await api.call('POST', 'core/warehouses', 'ADM', { code: 'kl-main', name: 'Kuala Lumpur · main', branchCode: 'HQ' })).status).toBe(201);
        let kl = await row('KL-MAIN');
        expect(kl).toMatchObject({ branch: 'HQ · HQ Shah Alam', locations: [], isActive: true });
        expect((await patch(kl, { branchCode: 'PNG' })).status).toBe(200);
        kl = await row('KL-MAIN');
        expect((await patch(kl, { isActive: false })).status).toBe(200);
        kl = await row('KL-MAIN');
        expect((await api.app.get<MasterDataPort>(MASTER_DATA_PORT).listWarehouses(TENANT_ID, 'PNG')).map((w) => [w.code, w.isActive])).toEqual([
          ['KL-MAIN', false],
          ['PNG-MAIN', true],
        ]);
        expect(await api.call('DELETE', `core/warehouses/${kl.id}?version=${kl.version}`, 'ADM')).toMatchObject({ status: 200 });
        expect(errorsOf(await api.call('POST', 'core/warehouses', 'ADM', { code: 'KL-MAIN', name: 'Again', branchCode: 'HQ' }))).toEqual([
          { field: 'code', message: 'KL-MAIN belonged to a warehouse that was deleted. Codes are never used again.' },
        ]);
        expect(errorsOf(await api.call('POST', 'core/warehouses', 'ADM', { code: 'JB-MAIN', name: 'Johor', branchCode: 'JB' }))).toEqual([{ field: 'branchCode', message: 'Pick the branch from the list.' }]);
      });
    });
  });

  describe('C7 · Import', () => {
    interface ImportRow {
      row: number;
      status: string;
      code: string | null;
      display: Record<string, string>;
      result: string;
    }
    interface ImportAnswer {
      rows: ImportRow[];
      counts: Record<string, number>;
      summary: string;
      notices: string[];
      problems: { headers: string[]; rows: string[][] };
    }
    /** Posts a CSV the way C14 does: multipart with the file and what to import. */
    const upload = async (step: 'check' | 'load', kind: string, csv: string, user = 'ADM', name = `${kind}.csv`) => {
      const base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', new Blob([csv], { type: 'text/csv' }), name);
      const res = await fetch(`${base}/core/imports/${step}`, { method: 'POST', headers: { 'x-dev-user': user }, body: form });
      return { status: res.status, body: (await res.json()) as ImportAnswer & { errors?: { message: string }[] } };
    };
    const results = (a: ImportAnswer) => a.rows.map((r) => [r.status, r.result]);

    it('offers customers, suppliers, items and price-list prices, with their template columns', async () => {
      const { kinds } = await api.get<{ kinds: { kind: string; label: string; columns: string[] }[] }>('core/imports/kinds', 'AR');
      expect(kinds.map((k) => k.label)).toEqual(['Customers', 'Suppliers', 'Items', 'Price-list prices']);
      expect(kinds[3]!.columns).toEqual(['Price list', 'Item', 'Unit', 'Price', 'From']);
    });

    it('checks customers without saving anything, then loads the ready rows, each on its own', async () => {
      const csv = [
        'Code,Name,Branch,Price list,Credit term,Credit limit,Phone,Colour',
        ',Taman Indah Hotel,HQ,Standard 2026,30 days,"40,000.00",,blue',
        'C-0045,,,,,,+60 3-5510 9999,',
        ',Kedai Baru,KL,Standard 2026,30 days,10000,,',
      ].join('\r\n');
      const count = () => api.prisma.mdmCustomer.count({ where: { tenantId: TENANT_ID } });
      const before = await count();
      const check = await upload('check', 'customers', csv);
      expect(check.status).toBe(201);
      expect(results(check.body)).toEqual([
        ['new', 'New customer'],
        ['update', 'Update: phone'],
        ['problem', 'Branch KL is not in Master Data'],
      ]);
      const next = check.body.rows[0]!.display.code;
      expect(next).toMatch(/^New · C-\d{4}$/);
      expect(check.body.rows[0]!.display).toMatchObject({ name: 'Taman Indah Hotel', branch: 'HQ', priceList: 'Standard 2026', creditTerm: (await api.prisma.mdmCreditTerm.findFirst({ where: { tenantId: TENANT_ID, days: 30 } }))!.name, creditLimit: '40,000.00' });
      expect(check.body.rows[2]!.display.code).toBe('New');
      expect(check.body.summary).toBe(
        '2 rows are ready and 1 has a problem. Load saves the 2 ready rows, each on its own. The row with a problem is left out: download it, fix it and upload it again.',
      );
      expect(check.body.notices).toEqual(['Columns a customers import does not read are left out: Colour.']);
      expect(check.body.problems).toEqual({
        headers: ['Code', 'Name', 'Branch', 'Price list', 'Credit term', 'Credit limit', 'Phone', 'Colour', 'Problem'],
        rows: [['', 'Kedai Baru', 'KL', 'Standard 2026', '30 days', '10000', '', '', 'Branch KL is not in Master Data']],
      });
      expect(await count()).toBe(before);
      expect((await api.prisma.mdmCustomer.findFirst({ where: { tenantId: TENANT_ID, code: 'C-0045' } }))?.phone).toBe('+60 3-5510 4471');

      const load = await upload('load', 'customers', csv);
      expect(load.status).toBe(201);
      const added = next.replace('New · ', '');
      expect(results(load.body)).toEqual([
        ['added', `Added ${added}`],
        ['updated', 'Updated: phone'],
        ['problem', 'Branch KL is not in Master Data'],
      ]);
      expect(load.body.summary).toBe('2 rows saved: 1 added, 1 updated. 1 row with a problem was left out: download it, fix it and upload it again.');
      expect(await api.prisma.mdmCustomer.findFirst({ where: { tenantId: TENANT_ID, code: added } })).toMatchObject({ name: 'Taman Indah Hotel', branchCode: 'HQ', creditTermDays: 30 });
      const delta = await api.prisma.mdmCustomer.findFirst({ where: { tenantId: TENANT_ID, code: 'C-0045' } });
      expect(delta?.phone).toBe('+60 3-5510 9999');
      expect(await api.prisma.sysOutbox.count({ where: { aggregateId: delta!.id, name: 'mdm.customer.updated' } })).toBe(1);
    });

    it('updates suppliers by code and names what it cannot use', async () => {
      const csv = 'Code,TIN,Payment term,Walk-in shop\nS-0047,C26660012340,30 days,No\nS-0009,,45 days,\nS-9999,,,\n';
      const check = await upload('check', 'suppliers', csv);
      expect(results(check.body)).toEqual([
        ['update', 'Update: TIN'],
        ['problem', 'Payment term 45 days is not on the credit terms list'],
        ['problem', 'S-9999 is not in Master Data. Leave the code empty to add a new supplier'],
      ]);
      expect((await upload('load', 'suppliers', csv)).body.counts).toEqual({ added: 0, updated: 1, unchanged: 0, problem: 2 });
      expect((await api.prisma.mdmSupplier.findFirst({ where: { tenantId: TENANT_ID, code: 'S-0047' } }))?.tin).toBe('C26660012340');
    });

    it('adds and updates items by the code typed, with the same rules as the item form', async () => {
      const csv = [
        'Code,Name,Group,Base unit,Purchase tax,Can be sold,Sales tax,Reorder level',
        'imp-test-01,Folding chair,seating,PCS,SST10,Yes,SST10,',
        'CH-DIN-01,,,,,,,60',
        'IMP-TEST-02,Gadget,Gadgets,PCS,SST10,,,',
        'IMP-TEST-01,Again,Seating,PCS,SST10,,,',
        ',No code,Seating,PCS,SST10,,,',
      ].join('\n');
      const check = await upload('check', 'items', csv);
      expect(results(check.body)).toEqual([
        ['new', 'New item'],
        ['update', 'Update: reorder level'],
        ['problem', 'Item group Gadgets is not on the item groups list'],
        ['problem', 'Row 1 already has IMP-TEST-01'],
        ['problem', 'Give the item code: items keep the code you type'],
      ]);
      expect(check.body.rows[0]!.display).toMatchObject({ code: 'New · IMP-TEST-01', group: 'Seating', purchaseTax: 'SST10', salesTax: 'SST10' });
      expect(results((await upload('load', 'items', csv)).body).slice(0, 2)).toEqual([
        ['added', 'Added IMP-TEST-01'],
        ['updated', 'Updated: reorder level'],
      ]);
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      expect((await port.findItems(TENANT_ID, ['IMP-TEST-01']))[0]).toMatchObject({ name: 'Folding chair', status: 'ACTIVE' });
      expect((await api.prisma.mdmItem.findFirst({ where: { tenantId: TENANT_ID, code: 'CH-DIN-01' } }))?.reorderLevel?.toString()).toBe('60');
    });

    it('adds dated prices that wait for their date, and keeps history as it is', async () => {
      const csv = [
        'Price list,Item,Unit,Price,From',
        'STD-2026,CH-DIN-01,PCS,265.00,1/12/2026',
        'Standard 2026,CH-DIN-01,,250,2026-01-01',
        'RES-2026,CH-DIN-01,PCS,240,2026-01-01',
        'STD-2026,TM-OAK-01,PCS,80,2026-12-01',
        'STD-2026,CH-DIN-01,PCS,270,1 Dec 2026',
        'STD-2026,CH-DIN-02,PCS,295,soon',
      ].join('\n');
      const check = await upload('check', 'prices', csv);
      expect(results(check.body)).toEqual([
        ['new', 'New price'],
        ['unchanged', 'No change'],
        ['problem', 'A price cannot start before today (29 Sep 2026). Earlier prices are history'],
        ['problem', 'TM-OAK-01 cannot be sold, so it cannot have a price'],
        ['problem', 'Row 1 already has this price'],
        ['problem', 'From soon is not a date. Write it as 1/11/2026 or 2026-11-01'],
      ]);
      expect(check.body.rows[0]!.display).toEqual({ priceList: 'STD-2026', item: 'CH-DIN-01', unit: 'PCS', price: '265.00', from: '1 Dec 2026' });
      expect((await upload('load', 'prices', csv)).body.counts).toEqual({ added: 1, updated: 0, unchanged: 1, problem: 4 });
      const port = api.app.get<MasterDataPort>(MASTER_DATA_PORT);
      const price = async (onDate: string) => (await port.listPrices(TENANT_ID, { priceListCode: 'STD-2026', itemCodes: ['CH-DIN-01'], onDate })).map((p) => p.unitPrice);
      expect(await price('2026-09-29')).toEqual(['250.0000']);
      expect(await price('2026-12-01')).toEqual(['265.0000']);
    });

    it('refuses files it cannot read, and anyone without core.import', async () => {
      const message = (r: { body: { errors?: { message: string }[] } }) => r.body.errors?.[0]?.message;
      expect(message(await upload('check', 'items', 'Name,Group\nChair,Seating\n'))).toBe('The file has no Code column. Download the template to see the columns.');
      expect(message(await upload('check', 'customers', 'Code,Name\n'))).toBe('The file has no rows under the header.');
      expect(message(await upload('check', 'customers', 'Code,Name\nC-0012,X\n', 'ADM', 'customers.xlsx'))).toBe('Upload a CSV file (.csv). In Excel, use Save As and pick CSV UTF-8.');
      expect((await upload('check', 'customers', 'Code,Name\nC-0012,X\n', 'LMY')).status).toBe(403);
    });
  });
});
