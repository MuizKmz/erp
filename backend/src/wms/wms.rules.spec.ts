import {
  epcView,
  filterInventory,
  filterLocations,
  filterReceiving,
  filterShipping,
  inventoryRows,
  inventorySummary,
  locationRows,
  pageOf,
  receivingRow,
  shippingRow,
  statusCounts,
  stockState,
  type ErpItemFacts,
  type WmsTagRow,
} from './wms.rules';

const tag = (sku: string, warehouse: string | null, status = 'INBOUND', extra: Partial<WmsTagRow> = {}): WmsTagRow => ({
  epcCode: `${sku}-${Math.random()}`,
  status,
  product: { skuCode: sku, name: `${sku} name` },
  warehouse: warehouse ? { warehouseCode: warehouse } : null,
  location: { locationCode: 'LOC-A' },
  rack: { rackCode: 'R-1' },
  ...extra,
});
const erp = new Map<string, ErpItemFacts>([
  ['A', { name: 'Item A', group: 'Seating', reorderLevel: '5' }],
  ['B', { name: 'Item B', group: 'Tables', reorderLevel: '10' }],
]);
const products = [
  { id: 1, skuCode: 'A', name: 'wms a' },
  { id: 2, skuCode: 'B', name: 'wms b' },
  { id: 3, skuCode: 'C', name: 'wms c' },
  { id: 4, skuCode: 'D', name: 'wms d' },
];
const WAREHOUSES = ['W1', 'W2'];

describe('WMS view rules', () => {
  describe('stockState', () => {
    it('says what the numbers mean, with out of stock first', () => {
      expect(stockState(0, undefined)).toBe('OUT');
      expect(stockState(3, undefined)).toBe('NOT_IN_ERP');
      expect(stockState(3, erp.get('A'))).toBe('LOW');
      expect(stockState(5, erp.get('A'))).toBe('IN_STOCK');
      expect(stockState(1, { name: 'x', group: 'y', reorderLevel: null })).toBe('IN_STOCK');
    });
  });

  describe('inventoryRows', () => {
    const tags = [tag('A', 'W1'), tag('A', 'W1'), tag('A', 'W2'), tag('A', 'W2', 'ALLOCATED'), tag('A', 'W1', 'GENERATED'), tag('A', null, 'OUTBOUND'), tag('A', 'W1', 'QUARANTINE'), tag('B', 'W1'), tag('C', 'W2')];
    const rows = inventoryRows(products, tags, WAREHOUSES, erp, () => 'FROM WMS');

    it('counts tags on the shelf per warehouse: reserved yes; not scanned in, shipped or quarantined no', () => {
      expect(rows[0]).toMatchObject({ itemCode: 'A', name: 'Item A', group: 'Seating', byWarehouse: { W1: 2, W2: 2 }, total: 4, state: 'LOW', stateLabel: 'Low' });
    });

    it('lists a WMS item with no stock, and flags one Core does not know', () => {
      expect(rows.map((r) => [r.itemCode, r.total, r.state])).toEqual([['A', 4, 'LOW'], ['B', 1, 'LOW'], ['C', 1, 'NOT_IN_ERP'], ['D', 0, 'OUT']]);
      expect(rows[2]).toMatchObject({ name: 'wms c', group: 'FROM WMS', reorderLevel: null });
    });

    it('filters by group, search and what to show', () => {
      expect(filterInventory(rows, { group: 'Tables' }).map((r) => r.itemCode)).toEqual(['B']);
      expect(filterInventory(rows, { q: 'item a' }).map((r) => r.itemCode)).toEqual(['A']);
      expect(filterInventory(rows, { show: 'low' }).map((r) => r.itemCode)).toEqual(['A', 'B']);
      expect(filterInventory(rows, { show: 'out' }).map((r) => r.itemCode)).toEqual(['D']);
      expect(filterInventory(rows, { show: 'notInErp' }).map((r) => r.itemCode)).toEqual(['C']);
    });

    it('sums the cards', () => {
      expect(inventorySummary(rows)).toEqual({ items: 4, units: 6, belowReorder: 2, outOfStock: 1 });
    });
  });

  describe('locationRows', () => {
    const tags = [tag('A', 'W1'), tag('A', 'W1'), tag('A', 'W1', 'INBOUND', { isReserved: true }), tag('A', 'W1', 'ALLOCATED'), tag('B', 'W1', 'INBOUND', { rack: null }), tag('A', 'W1', 'GENERATED'), tag('A', 'W1', 'OUTBOUND')];

    it('groups by place and item, splitting available from reserved', () => {
      const rows = locationRows(tags);
      expect(rows).toEqual([
        { id: 'W1|LOC-A||B', warehouse: 'W1', location: 'LOC-A', rack: null, itemCode: 'B', name: 'B name', units: 1, available: 1, reserved: 0 },
        { id: 'W1|LOC-A|R-1|A', warehouse: 'W1', location: 'LOC-A', rack: 'R-1', itemCode: 'A', name: 'A name', units: 4, available: 2, reserved: 2 },
      ]);
    });

    it('filters by warehouse, location, rack and search', () => {
      const rows = locationRows(tags);
      expect(filterLocations(rows, { rack: 'R-1' })).toHaveLength(1);
      expect(filterLocations(rows, { warehouse: 'W2' })).toHaveLength(0);
      expect(filterLocations(rows, { q: 'b name' }).map((r) => r.itemCode)).toEqual(['B']);
    });
  });

  describe('epcView', () => {
    const history = {
      epcCode: 'E1',
      currentStatus: 'INBOUND',
      qualityStatus: 'GOOD',
      isAvailableForSale: true,
      product: { skuCode: 'A', name: 'Item A' },
      location: { warehouse: { warehouseCode: 'W1' }, location: { locationCode: 'LOC-A' } },
      lifecycle: { receivedFrom: 'Supplier X', currentOrder: null, lastShippedOrder: null, returnCount: 0, lastReturnDate: null },
      tracking: { inboundDate: '2026-09-23T06:40:00.000Z', inboundBy: 'Ali', outboundDate: null },
    };
    const t = tag('A', 'W1', 'INBOUND', { readableEpcCode: 'S1', batchName: 'B-1', createdAt: '2026-09-22T01:12:00.000Z' });

    it('shows the tag and its dates, with a step not reached left without one', () => {
      const v = epcView(history, t, { po: 'PO-1', supplierDo: 'DO-1' });
      expect(v).toMatchObject({ serialNumber: 'S1', statusLabel: 'In warehouse', itemCode: 'A', batch: 'B-1', warehouse: 'W1', location: 'LOC-A', rack: 'R-1', availableForSale: true, reservedForOrder: null });
      expect(v.events.map((e) => e.what)).toEqual(['Tag generated', 'Received', 'Stocked in', 'Shipped']);
      expect(v.events[1]!.detail).toBe('PO-1, DO-1, Supplier X');
      expect(v.events[2]!.detail).toBe('LOC-A · R-1, by Ali');
      expect(v.events[3]!.when).toBeNull();
    });

    it('adds the return when there was one, and copes with an unknown status', () => {
      const v = epcView({ ...history, currentStatus: 'SOMETHING_NEW', lifecycle: { returnCount: 2, lastReturnDate: '2026-10-01T00:00:00.000Z', lastReturnReason: 'Damaged' } }, undefined, undefined);
      expect(v.statusLabel).toBe('SOMETHING_NEW');
      expect(v.events.at(-1)).toEqual({ what: 'Returned', when: '2026-10-01T00:00:00.000Z', detail: 'Damaged, 2 time(s)' });
    });
  });

  describe('receiving', () => {
    const rows = [
      receivingRow({ id: 1, receivingCode: 'R1', doNumber: 'D1', status: 'COMPLETED', receivingDate: '2026-09-01T00:00:00.000Z', receivedQuantity: 5, stockedInQuantity: 5, order: { orderNo: 'PO-1' }, supplier: { supplierCode: 'S1', supplierName: 'One' }, warehouse: { warehouseCode: 'W1' } }),
      receivingRow({ id: 2, receivingCode: 'R2', status: 'IN_PROGRESS', receivingDate: '2026-09-20T00:00:00.000Z', receivedQuantity: 8, stockedInQuantity: 3, supplier: { supplierCode: 'S2' }, warehouse: { warehouseCode: 'W2' } }),
    ];

    it('maps the row, newest first, and filters', () => {
      expect(rows[0]).toMatchObject({ po: 'PO-1', date: '2026-09-01', received: 5, scannedIn: 5, statusKey: 'completed' });
      expect(filterReceiving(rows, {}).map((r) => r.receivingCode)).toEqual(['R2', 'R1']);
      expect(filterReceiving(rows, { supplier: 'S1' })).toHaveLength(1);
      expect(filterReceiving(rows, { dateFrom: '2026-09-10' }).map((r) => r.receivingCode)).toEqual(['R2']);
      expect(filterReceiving(rows, { q: 'po-1' }).map((r) => r.receivingCode)).toEqual(['R1']);
    });

    it('counts the tabs', () => {
      expect(statusCounts(rows, ['pending', 'inProgress', 'completed'])).toEqual({ all: 2, pending: 0, inProgress: 1, completed: 1 });
    });
  });

  describe('shipping', () => {
    const customers = (id: number) => (id === 7 ? { code: 'C-1', name: 'Customer One' } : undefined);
    const rows = [
      shippingRow({ trackingCode: 'T1', state: 'SHIPPED', shippingDate: '2026-09-25T00:00:00.000Z', order: { orderNo: 'SO-1', customerId: 7, orderItems: [{ quantity: 3 }, { quantity: 4 }] } }, customers),
      shippingRow({ trackingCode: 'T2', state: 'PENDING', order: { orderNo: 'SO-2', customerId: 99 } }, customers),
    ];

    it('adds up the units and names the customer', () => {
      expect(rows[0]).toMatchObject({ customerCode: 'C-1', customerName: 'Customer One', units: 7, shipDate: '2026-09-25', statusLabel: 'Shipped' });
      expect(rows[1]).toMatchObject({ customerCode: null, units: 0, shipDate: null, statusKey: 'pending' });
    });

    it('puts what is still waiting first, and filters', () => {
      expect(filterShipping(rows, {}).map((r) => r.trackingCode)).toEqual(['T2', 'T1']);
      expect(filterShipping(rows, { customer: 'C-1' }).map((r) => r.trackingCode)).toEqual(['T1']);
      expect(filterShipping(rows, { q: 'so-2' }).map((r) => r.trackingCode)).toEqual(['T2']);
    });
  });

  it('cuts a list into pages', () => {
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], total: 5, page: 2, pageSize: 2 });
  });
});
