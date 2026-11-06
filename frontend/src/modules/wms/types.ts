import type { ListResponse } from '@/api/list'

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

/** Where a screen's data came from: "From WMS · updated 2 minutes ago". */
export interface WmsSource {
  asOf: string | null
  /** The WMS could not be reached: these are the last figures it gave. */
  stale: boolean
  /** The WMS website; no "Open in WMS" button without it. */
  webUrl: string | null
}

export interface InventoryRow {
  id: string
  itemCode: string
  name: string
  group: string
  byWarehouse: Record<string, number>
  total: number
  reorderLevel: string | null
  state: 'IN_STOCK' | 'LOW' | 'OUT' | 'NOT_IN_ERP'
  stateLabel: string
  stateGroup: ChipGroup
}

export interface InventoryAnswer extends ListResponse<InventoryRow> {
  warehouses: string[]
  summary: { items: number; units: number; belowReorder: number; outOfStock: number }
  totals: { byWarehouse: Record<string, number>; total: number }
  options: { warehouses: string[]; groups: string[] }
  source: WmsSource
}

export interface LocationRow {
  id: string
  warehouse: string
  location: string
  rack: string | null
  itemCode: string
  name: string
  units: number
  available: number
  reserved: number
}

export interface LocationAnswer extends ListResponse<LocationRow> {
  options: { warehouses: string[]; locations: string[]; racks: string[] }
  source: WmsSource
}

export interface EpcAnswer {
  epcCode: string
  serialNumber: string | null
  status: string
  statusLabel: string
  statusGroup: ChipGroup
  itemCode: string | null
  itemName: string | null
  batch: string | null
  warehouse: string | null
  location: string | null
  rack: string | null
  quality: string | null
  availableForSale: boolean
  reservedForOrder: string | null
  events: { what: string; when: string | null; detail: string }[]
  source: WmsSource
}

export interface ReceivingRow {
  id: string
  receivingCode: string
  supplierDo: string | null
  po: string | null
  supplierCode: string | null
  supplierName: string | null
  warehouse: string | null
  date: string | null
  received: number
  scannedIn: number
  statusKey: string
  statusLabel: string
  statusGroup: ChipGroup
}

export interface ReceivingAnswer extends ListResponse<ReceivingRow> {
  options: { warehouses: string[]; suppliers: { code: string; name: string }[] }
  source: WmsSource
}

export interface ShippingRow {
  id: string
  trackingCode: string
  order: string | null
  customerCode: string | null
  customerName: string | null
  destination: string | null
  shipDate: string | null
  units: number
  statusKey: string
  statusLabel: string
  statusGroup: ChipGroup
}

export interface ShippingAnswer extends ListResponse<ShippingRow> {
  options: { customers: { code: string; name: string }[] }
  source: WmsSource
}
