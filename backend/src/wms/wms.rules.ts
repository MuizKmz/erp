/**
 * W01–W05, the read-only WMS view: pure rules that turn what the WMS answers into what the screens show.
 * One RFID tag is one unit. A tag is on the shelf while it is INBOUND, or ALLOCATED (reserved for an order, not yet shipped).
 */
import { dec } from '../platform/http/decimal';
import type { StatusCounts } from '../platform/http/list';

export interface WmsTagRow {
  epcCode: string;
  readableEpcCode?: string | null;
  status: string;
  batchName?: string | null;
  batchNumber?: string | null;
  qualityStatus?: string | null;
  isAvailableForSale?: boolean;
  isReserved?: boolean;
  receivingId?: number | null;
  createdAt?: string | null;
  inboundDate?: string | null;
  inboundBy?: string | null;
  outboundDate?: string | null;
  product?: { id?: number; name?: string | null; skuCode?: string | null } | null;
  warehouse?: { warehouseCode?: string | null; name?: string | null } | null;
  location?: { locationCode?: string | null } | null;
  rack?: { rackCode?: string | null } | null;
}

export interface WmsProduct {
  id: number;
  skuCode: string;
  name: string;
  categoryId?: number | null;
}

export interface ErpItemFacts {
  name: string;
  group: string;
  reorderLevel: string | null;
}

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled';

const onShelf = (tag: WmsTagRow) => tag.status === 'INBOUND' || tag.status === 'ALLOCATED';
const reserved = (tag: WmsTagRow) => tag.status === 'ALLOCATED' || !!tag.isReserved;
const matches = (q: string | undefined, ...values: (string | null | undefined)[]) => {
  const text = q?.trim().toLowerCase();
  return !text || values.some((v) => v?.toLowerCase().includes(text));
};

/** One page of rows already filtered in memory: the WMS gives whole lists. */
export function pageOf<T>(rows: T[], page: number, pageSize: number): { items: T[]; total: number; page: number; pageSize: number } {
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

// ---- W01 Inventory -------------------------------------------------------------------------------------------------

export type StockState = 'IN_STOCK' | 'LOW' | 'OUT' | 'NOT_IN_ERP';

const STOCK_LABEL: Record<StockState, { label: string; group: ChipGroup }> = {
  IN_STOCK: { label: 'In stock', group: 'done' },
  LOW: { label: 'Low', group: 'pending' },
  OUT: { label: 'Out of stock', group: 'cancelled' },
  NOT_IN_ERP: { label: 'Not in ERP', group: 'partial' },
};

/** Out of stock wins, then an item Core does not know, then below its reorder level. */
export function stockState(total: number, erp: ErpItemFacts | undefined): StockState {
  if (total === 0) return 'OUT';
  if (!erp) return 'NOT_IN_ERP';
  return erp.reorderLevel !== null && dec(total).lt(dec(erp.reorderLevel)) ? 'LOW' : 'IN_STOCK';
}

export interface InventoryRow {
  id: string;
  itemCode: string;
  name: string;
  group: string;
  byWarehouse: Record<string, number>;
  total: number;
  reorderLevel: string | null;
  state: StockState;
  stateLabel: string;
  stateGroup: ChipGroup;
}

export function inventoryRows(products: WmsProduct[], tags: WmsTagRow[], warehouses: string[], erp: Map<string, ErpItemFacts>, groupOf: (p: WmsProduct) => string): InventoryRow[] {
  const counts = new Map<string, Record<string, number>>();
  for (const tag of tags) {
    const sku = tag.product?.skuCode;
    const warehouse = tag.warehouse?.warehouseCode;
    if (!sku || !warehouse || !onShelf(tag)) continue;
    const row = counts.get(sku) ?? {};
    row[warehouse] = (row[warehouse] ?? 0) + 1;
    counts.set(sku, row);
  }
  return products
    .map((p): InventoryRow => {
      const known = erp.get(p.skuCode);
      const byWarehouse = Object.fromEntries(warehouses.map((w) => [w, counts.get(p.skuCode)?.[w] ?? 0]));
      const total = Object.values(byWarehouse).reduce((sum, n) => sum + n, 0);
      const state = stockState(total, known);
      return {
        id: p.skuCode,
        itemCode: p.skuCode,
        name: known?.name ?? p.name,
        group: known?.group ?? groupOf(p),
        byWarehouse,
        total,
        reorderLevel: known?.reorderLevel ?? null,
        state,
        stateLabel: STOCK_LABEL[state].label,
        stateGroup: STOCK_LABEL[state].group,
      };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

export function filterInventory(rows: InventoryRow[], f: { group?: string; q?: string; show?: string }): InventoryRow[] {
  return rows.filter((r) => (!f.group || r.group === f.group) && matches(f.q, r.itemCode, r.name) && (!f.show || f.show === 'all' || (f.show === 'low' ? r.state === 'LOW' : f.show === 'out' ? r.state === 'OUT' : r.state === 'NOT_IN_ERP')));
}

export function inventorySummary(rows: InventoryRow[]) {
  return {
    items: rows.length,
    units: rows.reduce((sum, r) => sum + r.total, 0),
    belowReorder: rows.filter((r) => r.state === 'LOW' || (r.state === 'OUT' && r.reorderLevel !== null && dec(r.reorderLevel).gt(0))).length,
    outOfStock: rows.filter((r) => r.state === 'OUT').length,
  };
}

// ---- W02 Stock location --------------------------------------------------------------------------------------------

export interface LocationRow {
  id: string;
  warehouse: string;
  location: string;
  rack: string | null;
  itemCode: string;
  name: string;
  units: number;
  available: number;
  reserved: number;
}

export function locationRows(tags: WmsTagRow[]): LocationRow[] {
  const rows = new Map<string, LocationRow>();
  for (const tag of tags) {
    const warehouse = tag.warehouse?.warehouseCode;
    const location = tag.location?.locationCode;
    const itemCode = tag.product?.skuCode;
    if (!onShelf(tag) || !warehouse || !location || !itemCode) continue;
    const rack = tag.rack?.rackCode ?? null;
    const key = [warehouse, location, rack, itemCode].join('|');
    const row = rows.get(key) ?? { id: key, warehouse, location, rack, itemCode, name: tag.product?.name ?? itemCode, units: 0, available: 0, reserved: 0 };
    row.units += 1;
    if (reserved(tag)) row.reserved += 1;
    else row.available += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.location.localeCompare(b.location) || (a.rack ?? '').localeCompare(b.rack ?? '') || a.itemCode.localeCompare(b.itemCode));
}

export function filterLocations(rows: LocationRow[], f: { warehouse?: string; location?: string; rack?: string; q?: string }): LocationRow[] {
  return rows.filter((r) => (!f.warehouse || r.warehouse === f.warehouse) && (!f.location || r.location === f.location) && (!f.rack || r.rack === f.rack) && matches(f.q, r.itemCode, r.name));
}

// ---- W03 EPC lookup ------------------------------------------------------------------------------------------------

const EPC_STATE: Record<string, { label: string; group: ChipGroup }> = {
  GENERATED: { label: 'Not stocked in', group: 'draft' },
  INBOUND: { label: 'In warehouse', group: 'done' },
  ALLOCATED: { label: 'Reserved', group: 'pending' },
  OUTBOUND: { label: 'Shipped', group: 'released' },
  QUARANTINE: { label: 'Quarantine', group: 'partial' },
  RETURNED_TO_SUPPLIER: { label: 'Returned to supplier', group: 'draft' },
  DISPOSED: { label: 'Disposed', group: 'cancelled' },
  MISSING: { label: 'Missing', group: 'cancelled' },
};

export interface WmsEpcHistory {
  epcCode: string;
  currentStatus: string;
  qualityStatus?: string | null;
  isAvailableForSale?: boolean;
  product?: { skuCode?: string | null; name?: string | null } | null;
  location?: { warehouse?: { warehouseCode?: string | null } | null; location?: { locationCode?: string | null } | null } | null;
  lifecycle?: { receivedFrom?: string | null; currentOrder?: string | null; lastShippedOrder?: string | null; returnCount?: number | null; lastReturnDate?: string | null; lastReturnReason?: string | null } | null;
  tracking?: { inboundDate?: string | null; inboundBy?: string | null; outboundDate?: string | null; outboundBy?: string | null } | null;
}

export interface EpcEvent {
  what: string;
  when: string | null;
  detail: string;
}

/** The tag's summary dates, in order. The WMS keeps these dates, not every scan. A step not reached has no date. */
export function epcTimeline(h: WmsEpcHistory, tag: WmsTagRow | undefined, receiving: { po: string | null; supplierDo: string | null } | undefined): EpcEvent[] {
  const place = [h.location?.location?.locationCode, tag?.rack?.rackCode].filter(Boolean).join(' · ');
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');
  const events: EpcEvent[] = [
    { what: 'Tag generated', when: tag?.createdAt ?? null, detail: join(tag?.batchName ? `Batch ${tag.batchName}` : null) },
    { what: 'Received', when: h.tracking?.inboundDate ?? null, detail: join(receiving?.po, receiving?.supplierDo, h.lifecycle?.receivedFrom) },
    { what: 'Stocked in', when: h.tracking?.inboundDate ?? null, detail: join(place, h.tracking?.inboundBy ? `by ${h.tracking.inboundBy}` : null) },
    { what: 'Shipped', when: h.tracking?.outboundDate ?? null, detail: join(h.lifecycle?.lastShippedOrder, h.tracking?.outboundBy ? `by ${h.tracking.outboundBy}` : null) },
  ];
  if (h.lifecycle?.lastReturnDate) {
    events.push({ what: 'Returned', when: h.lifecycle.lastReturnDate, detail: join(h.lifecycle.lastReturnReason, h.lifecycle.returnCount ? `${h.lifecycle.returnCount} time(s)` : null) });
  }
  return events;
}

export function epcView(h: WmsEpcHistory, tag: WmsTagRow | undefined, receiving: { po: string | null; supplierDo: string | null } | undefined) {
  const state = EPC_STATE[h.currentStatus] ?? { label: h.currentStatus, group: 'draft' as ChipGroup };
  return {
    epcCode: h.epcCode,
    serialNumber: tag?.readableEpcCode ?? null,
    status: h.currentStatus,
    statusLabel: state.label,
    statusGroup: state.group,
    itemCode: h.product?.skuCode ?? null,
    itemName: h.product?.name ?? null,
    batch: tag?.batchName ?? tag?.batchNumber ?? null,
    warehouse: h.location?.warehouse?.warehouseCode ?? null,
    location: h.location?.location?.locationCode ?? null,
    rack: tag?.rack?.rackCode ?? null,
    quality: h.qualityStatus ?? null,
    availableForSale: !!h.isAvailableForSale,
    reservedForOrder: h.lifecycle?.currentOrder ?? null,
    events: epcTimeline(h, tag, receiving),
  };
}

// ---- W04 Receiving -------------------------------------------------------------------------------------------------

export interface WmsReceiving {
  id: number;
  receivingCode: string;
  doNumber?: string | null;
  status: string;
  receivingDate?: string | null;
  receivedQuantity?: number | null;
  stockedInQuantity?: number | null;
  order?: { orderNo?: string | null } | null;
  supplier?: { supplierCode?: string | null; supplierName?: string | null } | null;
  warehouse?: { warehouseCode?: string | null } | null;
}

const RECEIVING_STATE: Record<string, { key: string; label: string; group: ChipGroup }> = {
  PENDING: { key: 'pending', label: 'Pending', group: 'draft' },
  IN_PROGRESS: { key: 'inProgress', label: 'In progress', group: 'pending' },
  COMPLETED: { key: 'completed', label: 'Completed', group: 'done' },
  CLOSED: { key: 'completed', label: 'Closed', group: 'done' },
};

export function receivingRow(r: WmsReceiving) {
  const state = RECEIVING_STATE[r.status] ?? { key: 'pending', label: r.status, group: 'draft' as ChipGroup };
  return {
    id: r.receivingCode,
    receivingCode: r.receivingCode,
    supplierDo: r.doNumber ?? null,
    po: r.order?.orderNo ?? null,
    supplierCode: r.supplier?.supplierCode ?? null,
    supplierName: r.supplier?.supplierName ?? null,
    warehouse: r.warehouse?.warehouseCode ?? null,
    date: r.receivingDate?.slice(0, 10) ?? null,
    received: r.receivedQuantity ?? 0,
    scannedIn: r.stockedInQuantity ?? 0,
    statusKey: state.key,
    statusLabel: state.label,
    statusGroup: state.group,
  };
}
export type ReceivingRow = ReturnType<typeof receivingRow>;

export function filterReceiving(rows: ReceivingRow[], f: { warehouse?: string; supplier?: string; dateFrom?: string; q?: string }): ReceivingRow[] {
  return rows
    .filter((r) => (!f.warehouse || r.warehouse === f.warehouse) && (!f.supplier || r.supplierCode === f.supplier) && (!f.dateFrom || (r.date ?? '') >= f.dateFrom) && matches(f.q, r.receivingCode, r.supplierDo, r.po))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.receivingCode.localeCompare(a.receivingCode));
}

// ---- W05 Shipping --------------------------------------------------------------------------------------------------

export interface WmsShipment {
  trackingCode: string;
  shippingDate?: string | null;
  destination?: string | null;
  state: string;
  order?: { orderNo?: string | null; customerId?: number | null; orderItems?: { quantity?: number | null }[] | null } | null;
}

const SHIPPING_STATE: Record<string, { key: string; label: string; group: ChipGroup }> = {
  PENDING: { key: 'pending', label: 'Pending', group: 'draft' },
  SHIPPED: { key: 'shipped', label: 'Shipped', group: 'done' },
  CANCELLED: { key: 'cancelled', label: 'Cancelled', group: 'cancelled' },
};

export function shippingRow(s: WmsShipment, customerOf: (id: number) => { code: string; name: string } | undefined) {
  const state = SHIPPING_STATE[s.state] ?? { key: 'pending', label: s.state, group: 'draft' as ChipGroup };
  const customer = s.order?.customerId ? customerOf(s.order.customerId) : undefined;
  return {
    id: s.trackingCode,
    trackingCode: s.trackingCode,
    order: s.order?.orderNo ?? null,
    customerCode: customer?.code ?? null,
    customerName: customer?.name ?? null,
    destination: s.destination ?? null,
    shipDate: s.shippingDate?.slice(0, 10) ?? null,
    units: (s.order?.orderItems ?? []).reduce((sum, line) => sum + (line.quantity ?? 0), 0),
    statusKey: state.key,
    statusLabel: state.label,
    statusGroup: state.group,
  };
}
export type ShippingRow = ReturnType<typeof shippingRow>;

export function filterShipping(rows: ShippingRow[], f: { customer?: string; dateFrom?: string; q?: string }): ShippingRow[] {
  return rows
    .filter((r) => (!f.customer || r.customerCode === f.customer) && (!f.dateFrom || (r.shipDate ?? '') >= f.dateFrom) && matches(f.q, r.trackingCode, r.order))
    .sort((a, b) => (a.statusKey === 'pending' ? 0 : 1) - (b.statusKey === 'pending' ? 0 : 1) || (b.shipDate ?? '').localeCompare(a.shipDate ?? '') || b.trackingCode.localeCompare(a.trackingCode));
}

/** { all, pending, … } for the status tabs; the tab itself filters afterwards. */
export function statusCounts(rows: { statusKey: string }[], keys: string[]): StatusCounts {
  const counts: StatusCounts = { all: rows.length };
  for (const key of keys) counts[key] = rows.filter((r) => r.statusKey === key).length;
  return counts;
}
