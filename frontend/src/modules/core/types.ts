/** Core API shapes (backend/src/core). Money and quantities arrive as strings. */

export interface CountPart {
  key: string
  label: string
  count: number
}

export interface CoreDashboardCard {
  key: string
  label: string
  to: string
  total: number
  parts: CountPart[]
  /** Extra line, e.g. "11 locations" on Warehouses */
  note?: string
}

export interface CoreRecentChange {
  at: string
  userName: string
  entityType: string
  entityId: string
  code: string | null
  message: string
}

/** A line under *Needs attention*: "<lead> <text>", the lead linking to the list to fix it in. */
export interface CoreAttention {
  key: string
  lead: string
  text: string
  to: string
}

export interface CoreDashboard {
  cards: CoreDashboardCard[]
  attention: CoreAttention[]
  recent: CoreRecentChange[]
}

// ── Where a record is used (record-usage check) ──

export interface UsageOpenDocument {
  module: string
  docType: string
  docTypeLabel: string
  docNo: string
  status: string
  statusLabel: string
}

export interface RecordUsage {
  documents: number
  open: UsageOpenDocument[]
  references: { module: string; label: string; count: number }[]
  modules: { module: string; documents: number; open: number }[]
}

export interface CoreActivity {
  id: string
  message: string
  comment: string | null
  userName: string
  at: string
}

// ── Items (C02, C03) ──

export type ItemStatus = 'ACTIVE' | 'BLOCKED' | 'DISCONTINUED'
export type ItemType = 'STOCK' | 'NON_STOCK' | 'SERVICE' | 'ASSET'
export type ItemAction = 'edit' | 'block' | 'activate' | 'discontinue' | 'delete'

export interface ItemListItem {
  id: string
  code: string
  name: string
  itemGroup: string
  type: ItemType
  typeLabel: string
  baseUom: string
  isPurchasable: boolean
  isSellable: boolean
  isBuyToOrder: boolean
  barcode: string | null
  preferredSupplier: { code: string; name: string } | null
  status: ItemStatus
  statusLabel: string
}

export interface Conversion {
  fromUom: string
  toUom: string
  /** "50" */
  factor: string
}

/** What the item form saves. */
export interface ItemInput {
  name: string
  itemGroup: string
  type: ItemType
  baseUom: string
  barcode: string | null
  einvoiceClassification: string | null
  isPurchasable: boolean
  isBuyToOrder: boolean
  purchaseUom: string | null
  purchaseTaxCode: string | null
  preferredSupplierCode: string | null
  reorderLevel: string | null
  packSize: string
  isSellable: boolean
  salesUom: string | null
  salesTaxCode: string | null
  standardCost: string | null
  conversions: Conversion[]
}

export interface ItemDetail extends ItemInput {
  id: string
  code: string
  typeLabel: string
  baseUomName: string | null
  einvoiceClassificationName: string | null
  preferredSupplier: { id: string; code: string; name: string; shortName: string | null } | null
  conversions: (Conversion & { text: string })[]
  prices: { priceListId: string | null; priceListCode: string; priceListName: string; uomCode: string; unitPrice: string; validFrom: string }[]
  contractPrices: { supplierId: string | null; supplierCode: string; supplierName: string; unitPrice: string; validFrom: string; validTo: string | null }[]
  usage: RecordUsage
  activity: CoreActivity[]
  allowedActions: ItemAction[]
  refusals: Partial<Record<ItemAction, string>>
  canSeeCost: boolean
  status: ItemStatus
  statusLabel: string
  version: number
}

export interface ItemFormOptions {
  itemGroups: string[]
  uoms: { code: string; name: string; decimals: number }[]
  taxCodes: { code: string; name: string; type: string; rate: string }[]
  classifications: { code: string; name: string }[]
}

export interface SupplierOption {
  code: string
  name: string
  shortName: string | null
}

// ── Units of measure (C11) ──

export interface UomRow {
  id: string
  code: string
  name: string
  decimals: number
  isActive: boolean
  version: number
  baseOf: number
  conversions: number
}

export interface UomsData {
  units: UomRow[]
  conversions: { itemId: string | null; itemCode: string; itemName: string; text: string }[]
  canEdit: boolean
}

export interface UomDetail {
  id: string
  code: string
  name: string
  decimals: number
  isActive: boolean
  version: number
  usage: RecordUsage
  activeItems: string[]
  allowedActions: ('edit' | 'delete')[]
  refusals: { delete?: string; deactivate?: string }
}
