// A client with a WMS: set before the app module is loaded (it is required inside beforeAll).
process.env.WMS_URL = 'http://127.0.0.1:39517';
process.env.WMS_EMAIL = 'erp@example.com';
process.env.WMS_PASSWORD = 'not-a-real-password';
process.env.WMS_WEB_URL = 'https://wms.example.com';

import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { Api } from './e2e-helpers';
import { WmsController } from '../src/wms/wms.controller';

const tag = (epcCode: string, sku: string, warehouse: string, location: string, rack: string, status = 'INBOUND', extra: object = {}) => ({
  epcCode,
  readableEpcCode: `SERIAL-${epcCode}`,
  status,
  batchName: 'B-1',
  receivingId: 1,
  createdAt: '2026-09-22T01:00:00.000Z',
  product: { skuCode: sku, name: `${sku} from WMS` },
  warehouse: { warehouseCode: warehouse },
  location: { locationCode: location },
  rack: { rackCode: rack },
  ...extra,
});

/** What the fake WMS answers. CH-DIN-01 is a seeded ERP item, so Core adds its group and reorder level. */
const ANSWERS: Record<string, unknown> = {
  product: [
    { id: 1, skuCode: 'CH-DIN-01', name: 'x', categoryId: 1 },
    { id: 2, skuCode: 'WMS-ONLY', name: 'Only in the WMS', categoryId: 1 },
    { id: 3, skuCode: 'WMS-EMPTY', name: 'Nothing on the shelf', categoryId: 1 },
  ],
  warehouse: [{ warehouseCode: 'WH-A' }, { warehouseCode: 'WH-B' }],
  category: [{ id: 1, name: 'WMS group' }],
  customer: [{ id: 5, customerCode: 'CUS-1', customerName: 'Customer One' }],
  epc: [
    tag('E1', 'CH-DIN-01', 'WH-A', 'LOC-1', 'R-1'),
    tag('E2', 'CH-DIN-01', 'WH-A', 'LOC-1', 'R-1', 'ALLOCATED'),
    tag('E3', 'CH-DIN-01', 'WH-B', 'LOC-2', 'R-9'),
    tag('E4', 'WMS-ONLY', 'WH-B', 'LOC-2', 'R-9'),
    tag('E5', 'CH-DIN-01', 'WH-A', 'LOC-1', 'R-1', 'GENERATED'),
    tag('E6', 'CH-DIN-01', 'WH-A', 'LOC-1', 'R-1', 'OUTBOUND'),
  ],
  receiving: [
    { id: 1, receivingCode: 'RCV-1', doNumber: 'DO-1', status: 'COMPLETED', receivingDate: '2026-09-23T00:00:00.000Z', receivedQuantity: 5, stockedInQuantity: 5, order: { orderNo: 'PO-1' }, supplier: { supplierCode: 'SUP-1', supplierName: 'Supplier One' }, warehouse: { warehouseCode: 'WH-A' } },
    { id: 2, receivingCode: 'RCV-2', status: 'IN_PROGRESS', receivingDate: '2026-09-25T00:00:00.000Z', receivedQuantity: 8, stockedInQuantity: 3, supplier: { supplierCode: 'SUP-2', supplierName: 'Supplier Two' }, warehouse: { warehouseCode: 'WH-B' } },
  ],
  shipping: [
    { trackingCode: 'TRK-1', state: 'SHIPPED', shippingDate: '2026-09-25T00:00:00.000Z', destination: 'Klang', order: { orderNo: 'SO-1', customerId: 5, orderItems: [{ quantity: 3 }] } },
    { trackingCode: 'TRK-2', state: 'PENDING', order: { orderNo: 'SO-2', customerId: 5, orderItems: [{ quantity: 2 }] } },
  ],
};
const HISTORY = {
  epcCode: 'E1',
  currentStatus: 'INBOUND',
  qualityStatus: 'GOOD',
  isAvailableForSale: true,
  product: { skuCode: 'CH-DIN-01', name: 'Dining chair' },
  location: { warehouse: { warehouseCode: 'WH-A' }, location: { locationCode: 'LOC-1' } },
  lifecycle: { receivedFrom: 'Supplier One', returnCount: 0 },
  tracking: { inboundDate: '2026-09-23T06:00:00.000Z', inboundBy: 'Ali' },
};

describe('WMS read-only view (end to end, fake WMS)', () => {
  let helpers: typeof import('./e2e-helpers');
  let api: Api;
  let fake: Server;
  /** Everything the ERP sent to the WMS. */
  const seen: { method: string; url: string }[] = [];
  let down = false;

  beforeAll(async () => {
    fake = createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '' });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (down) return send(500, { message: 'down' });
      const path = (req.url ?? '').replace(/^\/api\//, '');
      if (req.method === 'POST' && path === 'auth/login') return send(201, { token: 'fake-token' });
      if (req.method !== 'GET') return send(405, {});
      if (req.headers.authorization !== 'Bearer fake-token') return send(401, {});
      if (path.startsWith('epc/history/')) return decodeURIComponent(path.slice(12)) === 'E1' || decodeURIComponent(path.slice(12)) === 'SERIAL-E1' ? send(200, HISTORY) : send(404, {});
      const list = path.split('?')[0]!;
      const data = ANSWERS[list];
      if (!data) return send(404, {});
      return send(200, path.includes('status=INBOUND') ? (data as { status: string }[]).filter((t) => t.status === 'INBOUND') : data);
    });
    await new Promise<void>((resolve) => fake.listen(39517, '127.0.0.1', resolve));
    helpers = await import('./e2e-helpers');
    helpers.reseed();
    api = await helpers.startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    await new Promise((resolve) => fake.close(resolve));
    helpers?.reseed();
  }, 300_000);

  it('opens the WMS tile only for someone allowed to see it', async () => {
    const tile = async (user: string) => (await api.get<{ items: { code: string; state: string; route: string | null }[] }>('me/modules', user)).items.find((m) => m.code === 'wms');
    expect(await tile('ADM')).toMatchObject({ state: 'OPEN', route: '/wms' });
    expect(await tile('AR')).toMatchObject({ state: 'EXISTING', route: null });
  });

  it('refuses a sales agent, who may only see their own customers', async () => {
    expect((await api.call('GET', 'wms/shipping', 'AR')).status).toBe(403);
  });

  it('W01 counts tags on the shelf per warehouse, with what Core knows about the item', async () => {
    const a = await api.get<any>('wms/inventory', 'ADM');
    expect(a.warehouses).toEqual(['WH-A', 'WH-B']);
    expect(a.items.find((r: any) => r.itemCode === 'CH-DIN-01')).toMatchObject({ byWarehouse: { 'WH-A': 2, 'WH-B': 1 }, total: 3, group: 'Seating' });
    expect(a.items.find((r: any) => r.itemCode === 'WMS-ONLY')).toMatchObject({ total: 1, stateLabel: 'Not in ERP', group: 'WMS group' });
    expect(a.items.find((r: any) => r.itemCode === 'WMS-EMPTY')).toMatchObject({ total: 0, stateLabel: 'Out of stock' });
    expect(a.summary).toMatchObject({ items: 3, units: 4, outOfStock: 1 });
    expect(a.source).toMatchObject({ stale: false, webUrl: 'https://wms.example.com' });
    const one = await api.get<any>('wms/inventory?warehouse=WH-B', 'ADM');
    expect(one.warehouses).toEqual(['WH-B']);
    expect(one.totals.total).toBe(2);
  });

  it('W02 shows each place, splitting available from reserved', async () => {
    const a = await api.get<any>('wms/stock-locations', 'ADM');
    expect(a.items[0]).toMatchObject({ warehouse: 'WH-A', location: 'LOC-1', rack: 'R-1', itemCode: 'CH-DIN-01', units: 2, available: 1, reserved: 1 });
    expect(a.options).toEqual({ warehouses: ['WH-A', 'WH-B'], locations: ['LOC-1', 'LOC-2'], racks: ['R-1', 'R-9'] });
    expect((await api.get<any>('wms/stock-locations?warehouse=WH-B', 'ADM')).options.locations).toEqual(['LOC-2']);
  });

  it('W03 finds a tag by EPC or serial number, and says when it does not know one', async () => {
    const a = await api.get<any>('wms/epc/E1', 'ADM');
    expect(a).toMatchObject({ serialNumber: 'SERIAL-E1', statusLabel: 'In warehouse', itemCode: 'CH-DIN-01', rack: 'R-1', batch: 'B-1' });
    expect(a.events[1].detail).toBe('PO-1, DO-1, Supplier One');
    expect((await api.get<any>('wms/epc/SERIAL-E1', 'ADM')).epcCode).toBe('E1');
    expect((await api.call('GET', 'wms/epc/NOPE', 'ADM')).status).toBe(404);
  });

  it('W04 and W05 list receivings and shipments, with their tabs', async () => {
    const r = await api.get<any>('wms/receiving', 'ADM');
    expect(r.items.map((x: any) => x.receivingCode)).toEqual(['RCV-2', 'RCV-1']);
    expect(r.statusCounts).toEqual({ all: 2, pending: 0, inProgress: 1, completed: 1 });
    expect((await api.get<any>('wms/receiving?status=completed', 'ADM')).items.map((x: any) => x.po)).toEqual(['PO-1']);
    const s = await api.get<any>('wms/shipping', 'ADM');
    expect(s.items.map((x: any) => x.trackingCode)).toEqual(['TRK-2', 'TRK-1']);
    expect(s.items[1]).toMatchObject({ customerName: 'Customer One', units: 3, shipDate: '2026-09-25', statusLabel: 'Shipped' });
    expect(s.statusCounts).toEqual({ all: 2, pending: 1, shipped: 1, cancelled: 0 });
  });

  it('feeds the stock figures other screens read', async () => {
    const res = await api.get<{ connections: { inventory: boolean } }>('purchase/demand', 'LMY');
    expect(res.connections.inventory).toBe(true);
  });

  it('keeps showing the last figures when the WMS goes down, and says so', async () => {
    await new Promise((resolve) => setTimeout(resolve, 15_100)); // Let the short-lived answers end.
    down = true;
    try {
      const a = await api.get<any>('wms/stock-locations', 'ADM');
      expect(a.items.length).toBeGreaterThan(0);
      expect(a.source.stale).toBe(true);
      const lookup = await api.call('GET', 'wms/epc/E1', 'ADM');
      expect(lookup.status).toBe(503);
      expect(lookup.body).toMatchObject({ code: 'WMS_UNAVAILABLE' });
    } finally {
      down = false;
    }
  }, 40_000);

  it('W00 shows the home cards and charts, and saving a layout never reaches the WMS', async () => {
    const d = await api.get<any>('wms/dashboard', 'ADM');
    expect(d.kpis).toEqual({
      units: { count: 4, warehouses: 2, items: 3 },
      reorder: expect.objectContaining({ outOfStock: 1 }),
      toScan: { count: 1, units: 5 },
      toShip: { count: 1, units: 2 },
    });

    const board = await api.get<any>('wms/dashboard/board', 'ADM');
    expect(board.cards.map((c: any) => c.key)).toEqual(['wms.recent_receiving', 'wms.needs_attention', 'wms.units_by_warehouse']);
    const card = (b: any, key: string) => b.cards.find((c: any) => c.key === key);
    expect(card(board, 'wms.units_by_warehouse').data.rows).toEqual([expect.objectContaining({ key: 'WH-A', value: '2.0000' }), expect.objectContaining({ key: 'WH-B', value: '2.0000' })]);
    expect(card(board, 'wms.needs_attention').data.items[0].title).toContain('WMS-EMPTY');

    const before = seen.length;
    const saved = await api.call('PUT', 'wms/dashboard/board', 'ADM', { cols: 3, cards: ['wms.top_items', 'wms.waiting_to_ship'] });
    expect(saved.status).toBe(200);
    expect((saved.body as any).cards.map((c: any) => c.key)).toEqual(['wms.top_items', 'wms.waiting_to_ship']);
    expect(seen.slice(before).every((r) => r.method === 'GET')).toBe(true);
    expect((await api.call('DELETE', 'wms/dashboard/board', 'ADM')).status).toBe(200);
    expect((await api.call('GET', 'wms/dashboard', 'AR')).status).toBe(403);
  });

  it('never changes anything: only GET routes, and only a sign-in and GETs reach the WMS', () => {
    const routes = Object.getOwnPropertyNames(WmsController.prototype).filter((n) => n !== 'constructor');
    expect(routes.length).toBe(5);
    for (const name of routes) {
      expect(Reflect.getMetadata(METHOD_METADATA, (WmsController.prototype as unknown as Record<string, object>)[name]!)).toBe(RequestMethod.GET);
    }
    expect(seen.length).toBeGreaterThan(0);
    const notReads = seen.filter((r) => r.method !== 'GET');
    expect(notReads.every((r) => r.method === 'POST' && r.url === '/api/auth/login')).toBe(true);
  });
});
