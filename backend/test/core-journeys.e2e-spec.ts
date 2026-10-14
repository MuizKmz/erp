import { TENANT_ID } from '../prisma/seed/util';
import { reseed, startApi, type Api } from './e2e-helpers';

/**
 * The Core handbook journeys (A–I), run against the API on fresh demo data, in the handbook's order (C-0103, C-0104,
 * QT-0013 and EQ-2609-0011 depend on it). Every expected number is the one the handbook tells a tester to look for.
 * Where a journey says "Sales shows" or "Purchase shows", the check goes through that module's own endpoint, so it
 * proves the change reached the module the way a user would see it.
 */
describe('Core journeys (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  type Detail = Record<string, unknown> & { id: string; version: number; allowedActions: string[]; refusals: Record<string, string>; activity: { message: string }[] };
  const idOf = async (resource: string, code: string) => {
    const page = await api.get<{ items: { id: string; code: string }[] }>(`core/${resource}?q=${encodeURIComponent(code)}`);
    return page.items.find((i) => i.code === code)!.id;
  };
  const detail = async (resource: string, code: string, user = 'ADM') => api.get<Detail>(`core/${resource}/${await idOf(resource, code)}`, user);
  const pick = (d: Detail, fields: string[]) => Object.fromEntries(fields.map((f) => [f, d[f]]));

  const CUSTOMER = ['name', 'category', 'area', 'branchCode', 'defaultAgentCode', 'billingAddress', 'deliveryAddress', 'contactName', 'email', 'phone', 'tin', 'idType', 'idNumber', 'salesTaxNo', 'serviceTaxNo', 'einvoiceEmail', 'taxMode', 'creditTermDays', 'creditLimit', 'overdueLimit', 'creditScope', 'priceListCode'];
  const SUPPLIER = ['name', 'shortName', 'category', 'isWalkIn', 'contactName', 'email', 'phone', 'address', 'tin', 'idType', 'regNo', 'sstNo', 'serviceTaxNo', 'einvoiceEmail', 'paymentTermDays', 'currency'];
  const ITEM = ['name', 'itemGroup', 'type', 'baseUom', 'barcode', 'einvoiceClassification', 'isPurchasable', 'isBuyToOrder', 'purchaseUom', 'purchaseTaxCode', 'preferredSupplierCode', 'reorderLevel', 'packSize', 'isSellable', 'salesUom', 'salesTaxCode', 'standardCost'];
  const customerBody = (d: Detail, change: Record<string, unknown>) => ({ ...pick(d, CUSTOMER), ...change, version: d.version });
  const supplierBody = (d: Detail, change: Record<string, unknown>) => ({
    ...pick(d, SUPPLIER),
    contractPrices: (d.contractPrices as { itemCode: string; unitPrice: string; validFrom: string; validTo: string | null }[]).map(({ itemCode, unitPrice, validFrom, validTo }) => ({ itemCode, unitPrice, validFrom, validTo })),
    ...change,
    version: d.version,
  });
  const itemBody = (d: Detail, change: Record<string, unknown>) => ({
    ...pick(d, ITEM),
    conversions: (d.conversions as { fromUom: string; toUom: string; factor: string }[]).map(({ fromUom, toUom, factor }) => ({ fromUom, toUom, factor })),
    ...change,
    version: d.version,
  });
  const home = () => api.get<{ cards: { key: string; total: number }[]; attention: { key: string; lead: string }[] }>('core/dashboard');
  const lead = async (key: string) => (await home()).attention.find((a) => a.key === key)?.lead ?? null;
  /** S04 Add item for a customer: the list price, tax and state Sales shows. */
  const salesItem = async (customerCode: string, itemCode: string) =>
    (await api.get<{ items: { code: string; listPrice: string | null; taxRate: string; state: string }[] }>(`sales/lookups/items?customerCode=${customerCode}&q=${itemCode}`, 'AR')).items.find((i) => i.code === itemCode);

  describe('A · Core home: what is there and what needs attention (C01)', () => {
    it('shows the counts and the five lines of Needs attention', async () => {
      const h = await home();
      expect(Object.fromEntries(h.cards.map((c) => [c.key, c.total]))).toEqual({ items: 39, customers: 7, suppliers: 10, 'price-lists': 2, 'tax-codes': 3, uoms: 9, warehouses: 3 });
      expect(h.attention.map((a) => a.lead)).toEqual(['39 items', '8 suppliers', '6 customers', '3 purchasable items', 'Item groups']);
      expect((await api.get<{ allowedActions?: string[]; cards: unknown[] }>('core/dashboard', 'AR')).cards).toHaveLength(7);
    });
  });

  describe('B · Fill the e-Invoice gaps (C07, C05, C03, C01)', () => {
    it('adds a TIN and ID number, an ID number and a classification code, and the home counts drop', async () => {
      const s = await detail('suppliers', 'S-0009');
      expect(s.eInvoiceGap).toBe('No TIN or ID number yet. e-Invoices with this supplier need both.');
      const saved = await api.call('PATCH', `core/suppliers/${s.id}`, 'ADM', supplierBody(s, { tin: 'C24680135790', regNo: '201901012345' }));
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ eInvoiceGap: null });
      expect((saved.body as Detail).activity[0]?.message).toBe('Changed TIN (blank) → C24680135790 and ID number (blank) → 201901012345');

      const c = await detail('customers', 'C-0045');
      expect((await api.call('PATCH', `core/customers/${c.id}`, 'ADM', customerBody(c, { idNumber: '201401023456' }))).status).toBe(200);

      const i = await detail('items', 'CH-DIN-01');
      expect((await api.call('PATCH', `core/items/${i.id}`, 'ADM', itemBody(i, { einvoiceClassification: '022' }))).status).toBe(200);

      expect([await lead('item-classification'), await lead('supplier-identity'), await lead('customer-identity')]).toEqual(['38 items', '7 suppliers', '5 customers']);
    });
  });

  describe('C · A prospect becomes a customer (Sales S06 + C05)', () => {
    it('cannot quote a prospect until Core adds it; the new customer links the enquiry, and the quotation follows', async () => {
      const eq = await api.call('POST', 'sales/enquiries', 'AR', {
        isProspect: true, prospectName: 'Taman Indah Hotel', branchCode: 'HQ', contactName: 'En. Rahman', phone: '+60 3-1234 5678',
        enquiryTypeCode: 'HOSPITALITY', sourceCode: 'PHONE', agentCode: 'AR', details: { Rooms: '40' }, items: [{ itemCode: 'CH-BAR-01', qty: '6' }],
      });
      expect(eq).toMatchObject({ status: 201, body: { docNo: 'EQ-2609-0011', status: 'NEW' } });
      const enquiry = eq.body as Detail & { docNo: string };
      expect(await api.call('POST', `sales/enquiries/${enquiry.id}/quotation`, 'AR', { version: enquiry.version })).toMatchObject({
        status: 409,
        body: { message: 'Taman Indah Hotel is a new prospect. Ask Admin to add the customer in Master Data before making a quotation.' },
      });

      const created = await api.call('POST', 'core/customers', 'ADM', {
        name: 'Taman Indah Hotel', category: 'Hospitality', area: 'Central', branchCode: 'HQ', defaultAgentCode: 'AR', contactName: 'En. Rahman', phone: '+60 3-1234 5678',
        tin: 'C25550012340', idType: 'BRN', idNumber: '202401012345', taxMode: 'EXCLUSIVE', creditTermDays: 30, creditLimit: '40000.00', overdueLimit: '5000.00', priceListCode: 'STD-2026',
        cameFromEnquiry: 'EQ-2609-0011',
      });
      expect(created).toMatchObject({ status: 201, body: { code: 'C-0103', status: 'ACTIVE' } });
      expect((created.body as Detail).activity[0]?.message).toBe('Customer C-0103 created from enquiry EQ-2609-0011');

      const linked = await api.until('EQ-2609-0011 to get C-0103', async () => {
        const e = await api.get<Detail & { customerCode: string | null }>(`sales/enquiries/${enquiry.id}`, 'AR');
        return e.customerCode === 'C-0103' ? e : null;
      });
      expect(linked.activity.map((a) => a.message)).toContain('Taman Indah Hotel was added to Master Data as C-0103 · Taman Indah Hotel. Quotations can now be made.');
      expect(await api.call('POST', `sales/enquiries/${enquiry.id}/quotation`, 'AR', { version: linked.version })).toMatchObject({
        status: 201,
        body: { docNo: 'QT-0013', status: 'DRAFT', totals: { total: '1254.00' } },
      });
    });
  });

  describe('D · A new item, from Core to Sales and Purchase (C03, C09, S04, P10)', () => {
    it('adds CH-LOU-01, prices it on STD-2026 from today, and both modules offer it', async () => {
      const item = await api.call('POST', 'core/items', 'ADM', {
        code: 'CH-LOU-01', name: 'Lounge chair, rattan', itemGroup: 'Seating', type: 'STOCK', baseUom: 'PCS', barcode: null, einvoiceClassification: '022',
        isPurchasable: true, isBuyToOrder: false, purchaseUom: null, purchaseTaxCode: 'SST10', preferredSupplierCode: 'S-0047', reorderLevel: null, packSize: '1',
        isSellable: true, salesUom: null, salesTaxCode: 'SST10', standardCost: '310.00', conversions: [],
      });
      expect(item).toMatchObject({ status: 201, body: { code: 'CH-LOU-01', status: 'ACTIVE' } });

      const std = await detail('price-lists', 'STD-2026');
      const prices = (std.prices as { locked: boolean; itemCode: string; uomCode: string; unitPrice: string; validFrom: string }[]).filter((p) => !p.locked).map(({ itemCode, uomCode, unitPrice, validFrom }) => ({ itemCode, uomCode, unitPrice, validFrom }));
      const priced = await api.call('PATCH', `core/price-lists/${std.id}`, 'ADM', {
        ...pick(std, ['name', 'currency', 'taxInclusive', 'validFrom', 'validTo']),
        prices: [...prices, { itemCode: 'CH-LOU-01', uomCode: 'PCS', unitPrice: '520.00', validFrom: '2026-09-29' }],
        version: std.version,
      });
      expect(priced).toMatchObject({ status: 200, body: { priceCount: 18 } });

      expect(await salesItem('C-0012', 'CH-LOU-01')).toMatchObject({ listPrice: '520.0000', taxRate: '0.1000', state: 'OUT_OF_STOCK' });
      const bought = await api.get<{ items: { code: string; preferredSupplierName: string; taxRate: string }[] }>('purchase/lookups/items?q=CH-LOU', 'LMY');
      expect(bought.items).toEqual([expect.objectContaining({ code: 'CH-LOU-01', preferredSupplierName: 'Perabot Kayu Timur', taxRate: '0.1000' })]);
    });
  });

  describe('E · Who may change what (C07, C05)', () => {
    it('lets the buyer change a supplier but not its contract price, the Purchasing Manager the price, Finance the credit only', async () => {
      const asBuyer = await detail('suppliers', 'S-0047', 'LMY');
      expect(asBuyer.allowedActions).toEqual(['edit']);
      expect((await api.call('PATCH', `core/suppliers/${asBuyer.id}`, 'LMY', supplierBody(asBuyer, { phone: '+60 9-512 3344' }))).status).toBe(200);

      const s = await detail('suppliers', 'S-0047', 'AZ');
      const cheaper = supplierBody(s, { contractPrices: [{ itemCode: 'SF-CUS-03', unitPrice: '2050.0000', validFrom: '2026-01-01', validTo: '2026-12-31' }] });
      expect((await api.call('PATCH', `core/suppliers/${s.id}`, 'LMY', cheaper)).status).toBe(403);
      expect((await api.call('PATCH', `core/suppliers/${s.id}`, 'AZ', cheaper)).status).toBe(200);
      const offered = await api.get<{ items: { code: string; contractPrice: string | null }[] }>('purchase/lookups/items?q=SF-CUS-03&supplierCode=S-0047', 'LMY');
      expect(offered.items[0]).toMatchObject({ code: 'SF-CUS-03', contractPrice: '2050.0000' });

      const c = await detail('customers', 'C-0045', 'RI');
      expect(c.allowedActions).toEqual(['editCredit']);
      expect((await api.call('PATCH', `core/customers/${c.id}`, 'RI', customerBody(c, { name: 'Delta Trading' }))).status).toBe(403);
      expect((await api.call('PATCH', `core/customers/${c.id}`, 'RI', customerBody(c, { creditLimit: '25000.00' }))).status).toBe(200);
      expect(await api.get('sales/lookups/customer-card?q=C-0045', 'AR')).toMatchObject({ creditLimit: '25000.00' });

      expect((await detail('customers', 'C-0045', 'AR')).allowedActions).toEqual([]);
    });
  });

  describe('F · Changes that wait for their date (C10, C09)', () => {
    it('adds a tax rate and a price from later dates; Sales keeps today’s until then; the waiting rate can be taken back', async () => {
      const sst = await api.get<Detail & { periods: { id: string; state: string }[] }>('core/tax-codes/SST10');
      expect((await api.call('POST', 'core/tax-codes/SST10/rates', 'ADM', { rate: '8', validFrom: '2027-01-01', name: 'SST 8%', version: sst.version })).status).toBe(201);
      const listed = (await api.get<{ codes: { code: string; rate: string; validTo: string | null; next: unknown }[] }>('core/tax-codes')).codes.find((c) => c.code === 'SST10');
      expect(listed).toMatchObject({ rate: '10%', validTo: '2026-12-31', next: { rate: '8%', validFrom: '2027-01-01' } });

      const std = await detail('price-lists', 'STD-2026');
      const open = (std.prices as { locked: boolean; itemCode: string; uomCode: string; unitPrice: string; validFrom: string }[]).filter((p) => !p.locked).map(({ itemCode, uomCode, unitPrice, validFrom }) => ({ itemCode, uomCode, unitPrice, validFrom }));
      const later = await api.call('PATCH', `core/price-lists/${std.id}`, 'ADM', {
        ...pick(std, ['name', 'currency', 'taxInclusive', 'validFrom', 'validTo']),
        prices: [...open, { itemCode: 'CH-DIN-01', uomCode: 'PCS', unitPrice: '260.00', validFrom: '2026-11-01' }],
        version: std.version,
      });
      expect((later.body as { prices: { itemCode: string; validFrom: string; state: string }[] }).prices.find((p) => p.itemCode === 'CH-DIN-01' && p.validFrom === '2026-11-01')?.state).toBe('waiting');

      expect(await salesItem('C-0012', 'CH-DIN-01')).toMatchObject({ listPrice: '250.0000', taxRate: '0.1000' });

      const withNext = await api.get<Detail & { periods: { id: string; state: string }[] }>('core/tax-codes/SST10');
      const waiting = withNext.periods.find((p) => p.state === 'waiting')!;
      const back = await api.call('DELETE', `core/tax-codes/SST10/rates/${waiting.id}?version=${withNext.version}`, 'ADM');
      expect((back.body as { periods: { rate: string; validTo: string | null }[] }).periods).toEqual([expect.objectContaining({ rate: '10%', validTo: null })]);
    });
  });

  describe('G · Why something cannot be deleted or blocked (C03, C05, C08, C13, C12)', () => {
    it('names the open documents or the customers that stand in the way', async () => {
      const item = await detail('items', 'CH-DIN-01');
      expect(item.refusals).toMatchObject({
        discontinue: 'CH-DIN-01 is on 7 open documents (SO-0001, SO-0002, SO-0005 …). Finish or cancel them first.',
        delete: 'CH-DIN-01 is used on 19 documents and in price lists (2), so it cannot be deleted. Discontinue it instead.',
      });
      expect(await api.call('POST', `core/items/${item.id}/discontinue`, 'ADM', { version: item.version })).toMatchObject({ status: 409 });

      const c = await detail('customers', 'C-0012');
      expect(await api.call('POST', `core/customers/${c.id}/block`, 'ADM', { version: c.version })).toMatchObject({
        status: 409,
        body: { message: 'C-0012 is on 5 open documents (SO-0001, SO-0003, QT-0006 …). Finish or cancel them first.' },
      });

      const res = await detail('price-lists', 'RES-2026');
      expect(res.refusals.deactivate).toBe('RES-2026 is the price list of 1 customer (C-0031). Move it to another price list first.');

      const hq = (await api.get<{ warehouses: Detail[] }>('core/warehouses')).warehouses.find((w) => w.code === 'HQ-MAIN')!;
      expect(await api.call('PATCH', `core/warehouses/${hq.id}`, 'ADM', { name: hq.name, branchCode: hq.branchCode, isActive: false, version: hq.version })).toMatchObject({
        status: 409,
        body: { message: 'HQ-MAIN is on 18 open documents (PO-0001, PO-0003, PO-0005 …). Finish or cancel them first.' },
      });

      const seating = (await api.get<{ lists: Record<string, Detail[]> }>('core/reference')).lists['item-groups']!.find((e) => e.name === 'Seating')!;
      expect(seating).toMatchObject({ usedBy: '7 items' });
    });
  });

  describe('H · Lists and warehouses (C12, C05, C13, P14)', () => {
    it('adds a credit term a customer then uses, and a warehouse Purchase can pick', async () => {
      expect((await api.call('POST', 'core/reference/credit-terms', 'ADM', { name: '60 days', days: 60 })).status).toBe(201);
      const c = await detail('customers', 'C-0078');
      expect((await api.call('PATCH', `core/customers/${c.id}`, 'ADM', customerBody(c, { creditTermDays: 60 }))).status).toBe(200);
      const term = (await api.get<{ lists: Record<string, Detail[]> }>('core/reference')).lists['credit-terms']!.find((e) => e.days === 60)!;
      expect(term).toMatchObject({ usedBy: '1 customer', refusals: { delete: '“60 days” is used by 1 customer, so it cannot be deleted. Make it inactive instead.' } });

      expect((await api.call('POST', 'core/warehouses', 'ADM', { code: 'KL-MAIN', name: 'Kuala Lumpur · main', branchCode: 'HQ' })).status).toBe(201);
      expect((await api.get<{ items: { code: string }[] }>('purchase/lookups/warehouses', 'LMY')).items.map((w) => w.code)).toEqual(['HQ-DMG', 'HQ-MAIN', 'KL-MAIN', 'PNG-MAIN']);
    });
  });

  describe('I · Import customers from CSV (C14)', () => {
    it('checks the mockup’s file without saving, then loads the two ready rows', async () => {
      const csv = [
        'Code,Name,Branch,Price list,Credit term,Credit limit,Phone',
        ',Taman Sari Resort,HQ,Standard 2026,30 days,40000.00,',
        'C-0012,Hotel Seri Bayu Sdn Bhd,HQ,STD-2026,30 days,150000.00,+60 3-2280 9999',
        ',Kedai Baru,KL,Standard 2026,30 days,10000.00,',
      ].join('\r\n');
      const base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
      const post = async (step: 'check' | 'load') => {
        const form = new FormData();
        form.append('kind', 'customers');
        form.append('file', new Blob([csv], { type: 'text/csv' }), 'customers-october.csv');
        const res = await fetch(`${base}/core/imports/${step}`, { method: 'POST', headers: { 'x-dev-user': 'ADM' }, body: form });
        return (await res.json()) as { rows: { status: string; display: Record<string, string>; result: string }[]; summary: string };
      };
      const check = await post('check');
      expect(check.rows.map((r) => [r.display.code, r.result])).toEqual([
        ['New · C-0104', 'New customer'],
        ['C-0012', 'Update: phone'],
        ['New', 'Branch KL is not in Master Data'],
      ]);
      expect(await api.prisma.mdmCustomer.count({ where: { tenantId: TENANT_ID } })).toBe(8);

      const load = await post('load');
      expect(load.rows.map((r) => r.result)).toEqual(['Added C-0104', 'Updated: phone', 'Branch KL is not in Master Data']);
      expect(load.summary).toBe('2 rows saved: 1 added, 1 updated. 1 row with a problem was left out: download it, fix it and upload it again.');
      expect(await api.get('sales/lookups/customer-card?q=C-0104', 'AR')).toMatchObject({ name: 'Taman Sari Resort', creditLimit: '40000.00', priceList: 'Standard 2026' });
    });
  });
});
