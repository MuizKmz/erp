import { TENANT_ID } from '../prisma/seed/util';
import { ScopeRegistry } from '../src/platform/scope/scope.registry';
import { reseed, startApi, type Api } from './e2e-helpers';

/**
 * Data scopes (CLAUDE.md → Phase 4 · A7; SDD 10.3.1, 10.4), in dev mode, where they apply too (choice 19): a
 * Penang-only user never reaches an HQ record and an agent never reaches another agent's customer, by list, record or
 * action. Out of scope answers 404, never 403. Read only, so the demo data is reseeded before and left as it was.
 */
describe('Data scopes (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
  });

  /** Each scoped document table with its API route and a reader who may otherwise see that module. */
  const PURCHASE = {
    purRequest: 'purchase/requests',
    purRfq: 'purchase/rfqs',
    purPurchaseOrder: 'purchase/orders',
    purGoodsReceipt: 'purchase/receipts',
    purInvoice: 'purchase/invoices',
    purCancelOrder: 'purchase/cancel-orders',
    purCashPurchase: 'purchase/cash-purchases',
    purDebitNote: 'purchase/debit-notes',
    purReturn: 'purchase/returns',
  } as const;
  const SALES = {
    salEnquiry: 'sales/enquiries',
    salQuotation: 'sales/quotations',
    salSalesOrder: 'sales/orders',
    salDelivery: 'sales/deliveries',
    salInvoice: 'sales/invoices',
    salProforma: 'sales/proformas',
    salCashSale: 'sales/cash-sales',
    salDebitNote: 'sales/debit-notes',
    salReturn: 'sales/returns',
    salCancelOrder: 'sales/cancel-orders',
  } as const;

  type Row = { id: string; docNo: string | null; branchCode: string; customerCode?: string | null };
  const firstWhere = (model: string, where: Record<string, unknown>) =>
    (api.prisma as unknown as Record<string, { findFirst(a: object): Promise<Row | null> }>)[model]!.findFirst({ where: { tenantId: TENANT_ID, ...where } });

  /** The record as the user sees it: its detail status, and whether its number shows in their list. */
  async function reach(route: string, row: Row, user: string) {
    const detail = await api.call('GET', `${route}/${row.id}`, user);
    const list = await api.call('GET', `${route}?pageSize=100&q=${encodeURIComponent(row.docNo ?? '')}`, user);
    const listed = list.status === 200 && (list.body.items as { docNo?: string }[]).some((i) => i.docNo === row.docNo);
    return { detail: detail.status, listed };
  }

  it('scopes exactly the document and customer tables the modules registered', () => {
    const models = api.app.get(ScopeRegistry).all().map((r) => `${r.module}:${r.model}`).sort();
    expect(models).toEqual(
      [
        ...['PurRequest', 'PurRfq', 'PurPurchaseOrder', 'PurGoodsReceipt', 'PurInvoice', 'PurCancelOrder', 'PurCashPurchase', 'PurDebitNote', 'PurReturn', 'PurSalesDemand'].map((m) => `purchase:${m}`),
        ...['SalEnquiry', 'SalQuotation', 'SalSalesOrder', 'SalDelivery', 'SalInvoice', 'SalProforma', 'SalCashSale', 'SalDebitNote', 'SalReturn', 'SalCancelOrder'].map((m) => `sales:${m}`),
        'core:MdmCustomer',
      ].sort(),
    );
  });

  it('keeps every HQ Purchase document from a Penang-only user (Tan Wei Ling), by list and by record', async () => {
    const leaks: string[] = [];
    for (const [model, route] of Object.entries(PURCHASE)) {
      const hq = await firstWhere(model, { branchCode: 'HQ' });
      if (!hq) throw new Error(`The seed has no HQ ${model}`);
      const asTwl = await reach(route, hq, 'TWL');
      const asAz = await reach(route, hq, 'AZ');
      if (asTwl.detail !== 404 || asTwl.listed) leaks.push(`${route} ${hq.docNo}: ${asTwl.detail}${asTwl.listed ? ', listed' : ''}`);
      if (asAz.detail !== 200 || !asAz.listed) leaks.push(`${route} ${hq.docNo} hidden from Ahmad Zaki (HQ and PNG)`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('keeps every HQ Sales document from a Penang-only agent (Lim Wei Jie), by list and by record', async () => {
    const leaks: string[] = [];
    for (const [model, route] of Object.entries(SALES)) {
      const hq = await firstWhere(model, { branchCode: 'HQ' });
      if (!hq) continue; // not every document type has an HQ row in the seed
      const asLwj = await reach(route, hq, 'LWJ');
      if (asLwj.detail !== 404 || asLwj.listed) leaks.push(`${route} ${hq.docNo}: ${asLwj.detail}${asLwj.listed ? ', listed' : ''}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('keeps Aina’s customers and their documents from another agent (Faizal Omar), while the Sales Manager sees them', async () => {
    const leaks: string[] = [];
    for (const [model, route] of Object.entries(SALES)) {
      const ainas = await firstWhere(model, { customerCode: { in: ['C-0012', 'C-0102'] } });
      if (!ainas) continue;
      const asFo = await reach(route, ainas, 'FO');
      const asAr = await reach(route, ainas, 'AR');
      const asNa = await reach(route, ainas, 'NA');
      if (asFo.detail !== 404 || asFo.listed) leaks.push(`${route} ${ainas.docNo} reached by FO: ${asFo.detail}`);
      if (asAr.detail !== 200 || !asAr.listed) leaks.push(`${route} ${ainas.docNo} hidden from AR`);
      if (asNa.detail !== 200 || !asNa.listed) leaks.push(`${route} ${ainas.docNo} hidden from NA`);
    }
    expect(leaks).toEqual([]);

    const c0012 = await api.prisma.mdmCustomer.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'C-0012' } });
    expect((await api.call('GET', `core/customers/${c0012.id}`, 'FO')).status).toBe(404);
    expect((await api.call('GET', `core/customers/${c0012.id}`, 'AR')).status).toBe(200);
    const foCustomers = (await api.get<{ items: { code: string }[] }>('core/customers?pageSize=100', 'FO')).items.map((c) => c.code);
    expect(foCustomers).toEqual(['C-0045', 'C-0056', 'C-0078']);
    expect((await api.get<{ items: { code: string }[] }>('core/customers?pageSize=100', 'LWJ')).items.map((c) => c.code)).toEqual(['C-0031']);
  }, 120_000);

  it('answers an action on a record out of scope with 404, never 403 (SDD 10.3.1)', async () => {
    const hqPo = await firstWhere('purPurchaseOrder', { branchCode: 'HQ', status: 'DRAFT' });
    const res = await api.call('POST', `purchase/orders/${hqPo!.id}/submit`, 'TWL', { version: 1 });
    expect(res.status).toBe(404);
  });

  it('shows a customer that is visible to all branches to every branch (FR-SEC-033)', async () => {
    const c0031 = await api.prisma.mdmCustomer.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'C-0031' } });
    expect((await api.call('GET', `core/customers/${c0031.id}`, 'HAF')).status).toBe(404); // a PNG customer, HQ-only user
    await api.prisma.mdmCustomer.update({ where: { id: c0031.id }, data: { visibleToAllBranches: true } });
    try {
      expect((await api.call('GET', `core/customers/${c0031.id}`, 'HAF')).status).toBe(200);
    } finally {
      await api.prisma.mdmCustomer.update({ where: { id: c0031.id }, data: { visibleToAllBranches: false } });
    }
  });

  it('keeps the credit check and the record-usage answers company-wide, whoever asks', async () => {
    const asAdmin = await api.get<{ documents: number }>('core/usage/customer/C-0012', 'ADM');
    // Aina is HQ-only and agent-scoped, yet where her customer is used counts every document, in every branch.
    const asAgent = await api.get<{ documents: number }>('core/usage/customer/C-0012', 'AR');
    expect(asAgent.documents).toBe(asAdmin.documents);
    expect((await api.get<{ documents: number }>('core/usage/item/CH-DIN-01', 'LWJ')).documents).toBe((await api.get<{ documents: number }>('core/usage/item/CH-DIN-01', 'ADM')).documents);
    // A customer the asker cannot see is not found at all, here too.
    expect((await api.call('GET', 'core/usage/customer/C-0012', 'LWJ')).status).toBe(404);
  });

  it('scopes the dashboards too: the Penang agent counts only their own', async () => {
    const all = await api.get<{ kpis?: unknown }>('sales/dashboard', 'NA');
    const mine = await api.get<{ kpis?: unknown }>('sales/dashboard', 'LWJ');
    expect(JSON.stringify(mine)).not.toEqual(JSON.stringify(all));
  });

  it('keeps every Sales report to the person’s data scope (SRS RPT-020)', async () => {
    const REPORTS = ['by-customer', 'by-item', 'open-orders', 'quotation-conversion', 'customer-aging', 'invoice-register', 'e-invoice-status'];
    // Each agent's customers (C-0012 and C-0102 are Aina's, C-0031 is Lim Wei Jie's, the rest Faizal's).
    const AINA = ['Hotel Seri Bayu', 'Villa Damai'];
    const LIM = ['Kedai Perabot Maju'];
    const FAIZAL = ['Syarikat Delta', 'Restoran Selera', 'Klinik Sihat'];
    const leaks: string[] = [];
    for (const report of REPORTS) {
      const [fo, lwj, na] = await Promise.all(['FO', 'LWJ', 'NA'].map(async (u) => JSON.stringify(await api.get(`sales/reports/${report}`, u))));
      for (const name of [...AINA, ...LIM]) if (fo.includes(name)) leaks.push(`${report}: Faizal sees ${name}`);
      for (const name of [...AINA, ...FAIZAL]) if (lwj.includes(name)) leaks.push(`${report}: Lim Wei Jie sees ${name}`);
      if (report !== 'by-item' && !AINA.some((n) => na.includes(n))) leaks.push(`${report}: the Sales Manager does not see Aina’s customers`);
    }
    expect(leaks).toEqual([]);
    // Sales by item lists items, not customers: its totals are each agent's own orders.
    const ordered = async (u: string) => (await api.get<{ kpis: { ordered: { amount: string } } }>('sales/reports/by-item', u)).kpis.ordered.amount;
    expect([await ordered('NA'), await ordered('AR'), await ordered('LWJ'), await ordered('FO')]).toEqual(['274098.00', '134860.00', '113498.00', '25740.00']);
  }, 120_000);

  it('narrows every document list to the branch a page asks for, never beyond the person’s own (Branch filter)', async () => {
    for (const route of [...Object.values(PURCHASE), ...Object.values(SALES)]) {
      const total = async (user: string, query = '') => {
        const res = await api.call('GET', `${route}?pageSize=100${query}`, user);
        expect(res.status).toBe(200);
        return res.body as { total: number; items: { branchCode: string }[] };
      };
      const all = await total('ADM');
      const hq = await total('ADM', '&branch=HQ');
      const png = await total('ADM', '&branch=PNG');
      expect([route, hq.total + png.total]).toEqual([route, all.total]);
      expect(png.items.every((i) => i.branchCode === 'PNG')).toBe(true);
      expect(all.items.every((i) => typeof i.branchCode === 'string')).toBe(true);
      // A branch the person does not work in shows nothing; it never widens the scope.
      expect((await total(route.startsWith('purchase/') ? 'TWL' : 'LWJ', '&branch=HQ')).total).toBe(0);
    }
  }, 120_000);

  it('narrows the homes and their charts to the branch chosen', async () => {
    const count = async (query: string) => (await api.call('GET', `purchase/dashboard${query}`, 'AZ')).body.kpis.openOrders.count as number;
    const [all, hq, png] = [await count(''), await count('?branch=HQ'), await count('?branch=PNG')];
    expect(hq + png).toBe(all);
    expect(png).toBeLessThan(all);
    const board = await api.call('GET', 'sales/dashboard/board?branch=PNG', 'NA');
    expect(board.status).toBe(200);
  });

  it('narrows lists and homes to the top bar’s branch (x-view-branch), while a record of another branch still opens', async () => {
    const top = { 'x-view-branch': 'PNG' };
    for (const route of [...Object.values(PURCHASE), ...Object.values(SALES)]) {
      const byQuery = await api.call('GET', `${route}?pageSize=100&branch=PNG`, 'ADM');
      const byHeader = await api.call('GET', `${route}?pageSize=100`, 'ADM', undefined, top);
      expect([route, byHeader.body.total]).toEqual([route, byQuery.body.total]);
      // The list's own Branch filter wins over the top bar.
      const hq = await api.call('GET', `${route}?pageSize=100&branch=HQ`, 'ADM');
      expect([route, (await api.call('GET', `${route}?pageSize=100&branch=HQ`, 'ADM', undefined, top)).body.total]).toEqual([route, hq.body.total]);
    }
    const count = async (headers: Record<string, string>) => (await api.call('GET', 'purchase/dashboard', 'AZ', undefined, headers)).body.kpis.openOrders.count as number;
    expect(await count(top)).toBe((await api.call('GET', 'purchase/dashboard?branch=PNG', 'AZ')).body.kpis.openOrders.count);
    // An HQ order opens while the top bar shows Penang; a branch the person does not work in still stays hidden.
    const hqOrder = await firstWhere('purPurchaseOrder', { branchCode: 'HQ' });
    expect((await api.call('GET', `purchase/orders/${hqOrder!.id}`, 'ADM', undefined, top)).status).toBe(200);
    expect((await api.call('GET', `purchase/orders/${hqOrder!.id}`, 'TWL', undefined, { 'x-view-branch': 'HQ' })).status).toBe(404);
  }, 120_000);
});
