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

// ── Customers (C04, C05) ──

export type CustomerStatus = 'ACTIVE' | 'PROSPECT' | 'BLOCKED'
export type CustomerAction = 'edit' | 'editCredit' | 'block' | 'activate' | 'delete'
export type IdType = 'BRN' | 'NRIC' | 'PASSPORT' | 'ARMY'

export interface CustomerListItem {
  id: string
  code: string
  name: string
  category: string | null
  area: string | null
  branchCode: string
  agentName: string | null
  priceListName: string
  creditTerm: string
  creditLimit: string | null
  overdueLimit: string | null
  tin: string | null
  status: CustomerStatus
  statusLabel: string
}

/** What the customer form saves. */
export interface CustomerInput {
  name: string
  category: string | null
  area: string | null
  branchCode: string
  defaultAgentCode: string | null
  billingAddress: string | null
  deliveryAddress: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  tin: string | null
  idType: IdType | null
  idNumber: string | null
  salesTaxNo: string | null
  serviceTaxNo: string | null
  einvoiceEmail: string | null
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE'
  creditTermDays: number
  creditLimit: string | null
  overdueLimit: string | null
  creditScope: 'GROUP' | 'BRANCH' | null
  priceListCode: string
}

export interface CustomerDetail extends CustomerInput {
  id: string
  code: string
  isCash: boolean
  cameFromEnquiry: string | null
  status: CustomerStatus
  statusLabel: string
  version: number
  branchName: string
  agentName: string | null
  priceListName: string
  eInvoiceGap: string | null
  usage: RecordUsage
  activity: CoreActivity[]
  allowedActions: CustomerAction[]
  refusals: Partial<Record<CustomerAction, string>>
}

export interface CustomerFormOptions {
  categories: string[]
  areas: string[]
  creditTerms: { days: number; name: string }[]
  branches: { code: string; name: string }[]
  agents: { code: string; name: string }[]
  priceLists: { code: string; name: string }[]
  idTypes: { value: IdType; label: string }[]
}

// ── Suppliers (C06, C07) ──

export type SupplierStatus = 'ACTIVE' | 'BLOCKED'
export type SupplierAction = 'edit' | 'editContracts' | 'block' | 'activate' | 'delete'

export interface SupplierListItem {
  id: string
  code: string
  name: string
  shortName: string | null
  category: string | null
  isWalkIn: boolean
  tin: string | null
  sstNo: string | null
  paymentTerm: string
  email: string | null
  status: SupplierStatus
  statusLabel: string
}

export interface ContractPriceInput {
  itemCode: string
  /** "2100.0000" */
  unitPrice: string
  validFrom: string
  validTo: string | null
}

/** What the supplier form saves. */
export interface SupplierInput {
  name: string
  shortName: string | null
  category: string | null
  isWalkIn: boolean
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
  tin: string | null
  idType: IdType | null
  regNo: string | null
  sstNo: string | null
  serviceTaxNo: string | null
  einvoiceEmail: string | null
  paymentTermDays: number
  currency: string
  contractPrices: ContractPriceInput[]
}

export interface SupplierDetail extends Omit<SupplierInput, 'contractPrices'> {
  id: string
  code: string
  status: SupplierStatus
  statusLabel: string
  version: number
  contractPrices: (ContractPriceInput & { itemId: string | null; itemName: string; uomCode: string | null; isCurrent: boolean })[]
  eInvoiceGap: string | null
  usage: RecordUsage
  activity: CoreActivity[]
  allowedActions: SupplierAction[]
  refusals: Partial<Record<SupplierAction, string>>
}

export interface SupplierFormOptions {
  paymentTerms: { days: number; name: string }[]
  currencies: string[]
  idTypes: { value: IdType; label: string }[]
}

export interface PurchasableItemOption {
  code: string
  name: string
  baseUom: string
}
