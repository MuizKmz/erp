import { Inject, Injectable } from '@nestjs/common';
import { WMS_CLIENT } from '../integration/integration.ports';
import type { WmsAnswer, WmsClient } from '../integration/wms-client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../master-data/master-data.port';
import type { RequestContext } from '../platform/context/request-context';
import { NotFoundError } from '../platform/http/errors';
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
  type ErpItemFacts,
  type WmsEpcHistory,
  type WmsProduct,
  type WmsReceiving,
  type WmsShipment,
  type WmsTagRow,
} from './wms.rules';

interface Paging {
  page: number;
  pageSize: number;
  status?: string;
  q?: string;
  dateFrom?: string;
  warehouse?: string;
  location?: string;
  rack?: string;
  group?: string;
  show?: string;
  supplier?: string;
  customer?: string;
}

const distinct = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].sort();

/**
 * W01–W05: read only. Everything comes live from the client's WMS and nothing is stored (WMS_DATA_OWNERSHIP.md, stage 1).
 * Core adds only what the WMS does not know: the item's group and reorder level.
 */
@Injectable()
export class WmsQuery {
  constructor(
    @Inject(WMS_CLIENT) private readonly client: WmsClient | null,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  /** The module exists only where a WMS is connected. */
  private get wms(): WmsClient {
    if (!this.client) throw new NotFoundError('WMS connection');
    return this.client;
  }

  /** "From WMS · updated …": the oldest answer behind the screen, and whether the WMS could not be reached. */
  private source(...answers: WmsAnswer<unknown>[]) {
    return {
      asOf: answers.map((a) => a.asOf).sort()[0] ?? null,
      stale: answers.some((a) => a.stale),
      webUrl: this.wms.webUrl,
    };
  }

  private async tags() {
    return this.wms.get<WmsTagRow[]>('epc');
  }

  async inventory(ctx: RequestContext, q: Paging) {
    const [products, tags, warehouses, categories] = await Promise.all([
      this.wms.get<WmsProduct[]>('product'),
      this.tags(),
      this.wms.get<{ warehouseCode: string }[]>('warehouse'),
      this.wms.get<{ id: number; name: string }[]>('category'),
    ]);
    const items = await this.masterData.findItems(ctx.tenantId, products.data.map((p) => p.skuCode));
    const erp = new Map<string, ErpItemFacts>(items.map((i) => [i.code, { name: i.name, group: i.itemGroup, reorderLevel: i.reorderLevel }]));
    const groupName = new Map(categories.data.map((c) => [c.id, c.name]));
    const allWarehouses = warehouses.data.map((w) => w.warehouseCode).sort();
    const shown = q.warehouse ? allWarehouses.filter((w) => w === q.warehouse) : allWarehouses;
    const rows = inventoryRows(products.data, tags.data, shown, erp, (p) => (p.categoryId ? (groupName.get(p.categoryId) ?? '—') : '—'));
    const filtered = filterInventory(rows, q);
    return {
      ...pageOf(filtered, q.page, q.pageSize),
      statusCounts: { all: filtered.length },
      warehouses: shown,
      summary: inventorySummary(rows),
      totals: {
        byWarehouse: Object.fromEntries(shown.map((w) => [w, filtered.reduce((sum, r) => sum + (r.byWarehouse[w] ?? 0), 0)])),
        total: filtered.reduce((sum, r) => sum + r.total, 0),
      },
      options: { warehouses: allWarehouses, groups: distinct(rows.map((r) => r.group)) },
      source: this.source(products, tags, warehouses, categories),
    };
  }

  async stockLocations(q: Paging) {
    const tags = await this.tags();
    const rows = locationRows(tags.data);
    const inWarehouse = rows.filter((r) => !q.warehouse || r.warehouse === q.warehouse);
    const inLocation = inWarehouse.filter((r) => !q.location || r.location === q.location);
    const filtered = filterLocations(rows, q);
    return {
      ...pageOf(filtered, q.page, q.pageSize),
      statusCounts: { all: filtered.length },
      options: { warehouses: distinct(rows.map((r) => r.warehouse)), locations: distinct(inWarehouse.map((r) => r.location)), racks: distinct(inLocation.map((r) => r.rack)) },
      source: this.source(tags),
    };
  }

  /** W00 · The home's cards. */
  async dashboard(ctx: RequestContext) {
    const all = { page: 1, pageSize: 100_000 };
    const [inventory, receiving, shipping] = await Promise.all([this.inventory(ctx, all), this.receiving(all), this.shipping({ ...all, status: 'pending' })]);
    const toScan = receiving.items.filter((r) => r.received > r.scannedIn);
    return {
      kpis: {
        units: { count: inventory.summary.units, warehouses: inventory.warehouses.length, items: inventory.summary.items },
        reorder: { count: inventory.summary.belowReorder, outOfStock: inventory.summary.outOfStock },
        toScan: { count: toScan.length, units: toScan.reduce((sum, r) => sum + r.received - r.scannedIn, 0) },
        toShip: { count: shipping.items.length, units: shipping.items.reduce((sum, r) => sum + r.units, 0) },
      },
      source: { asOf: inventory.source.asOf, stale: inventory.source.stale || receiving.source.stale || shipping.source.stale, webUrl: inventory.source.webUrl },
    };
  }

  /** One tag, by EPC or serial number. */
  async epc(code: string) {
    const history = await this.wms.find<WmsEpcHistory>(`epc/history/${encodeURIComponent(code.trim())}`);
    if (!history) throw new NotFoundError(`EPC ${code.trim()}`);
    const [tags, receivings] = await Promise.all([this.tags(), this.wms.get<WmsReceiving[]>('receiving')]);
    const tag = tags.data.find((t) => t.epcCode === history.epcCode);
    const receiving = tag?.receivingId ? receivings.data.find((r) => r.id === tag.receivingId) : undefined;
    return {
      ...epcView(history, tag, receiving ? { po: receiving.order?.orderNo ?? null, supplierDo: receiving.doNumber ?? null } : undefined),
      source: this.source(tags, receivings),
    };
  }

  async receiving(q: Paging) {
    const receivings = await this.wms.get<WmsReceiving[]>('receiving');
    const rows = receivings.data.map(receivingRow);
    const filtered = filterReceiving(rows, q);
    const inTab = q.status && q.status !== 'all' ? filtered.filter((r) => r.statusKey === q.status) : filtered;
    return {
      ...pageOf(inTab, q.page, q.pageSize),
      statusCounts: statusCounts(filtered, ['pending', 'inProgress', 'completed']),
      options: {
        warehouses: distinct(rows.map((r) => r.warehouse)),
        suppliers: [...new Map(rows.filter((r) => r.supplierCode).map((r) => [r.supplierCode!, { code: r.supplierCode!, name: r.supplierName ?? r.supplierCode! }])).values()].sort((a, b) => a.code.localeCompare(b.code)),
      },
      source: this.source(receivings),
    };
  }

  async shipping(q: Paging) {
    const [shipments, customers] = await Promise.all([this.wms.get<WmsShipment[]>('shipping'), this.wms.get<{ id: number; customerCode: string; customerName: string }[]>('customer')]);
    const byId = new Map(customers.data.map((c) => [c.id, { code: c.customerCode, name: c.customerName }]));
    const rows = shipments.data.map((s) => shippingRow(s, (id) => byId.get(id)));
    const filtered = filterShipping(rows, q);
    const inTab = q.status && q.status !== 'all' ? filtered.filter((r) => r.statusKey === q.status) : filtered;
    return {
      ...pageOf(inTab, q.page, q.pageSize),
      statusCounts: statusCounts(filtered, ['pending', 'shipped', 'cancelled']),
      options: { customers: [...new Map(rows.filter((r) => r.customerCode).map((r) => [r.customerCode!, { code: r.customerCode!, name: r.customerName ?? r.customerCode! }])).values()].sort((a, b) => a.code.localeCompare(b.code)) },
      source: this.source(shipments, customers),
    };
  }
}
