/**
 * Everything Purchase (and later Sales) reads from Master Data goes through this interface.
 * Phase 1: PrismaMasterDataAdapter reads the local mdm_ seed tables.
 * Later: an HTTP adapter calls the real Master Data API — nothing that depends on this port changes.
 * READ ONLY: there are deliberately no write methods.
 *
 * Grows step by step as screens need more. Decimals are strings ("50.0000") so the port does not depend
 * on Prisma types — the later HTTP adapter will return the same shapes.
 */
export const MASTER_DATA_PORT = Symbol('MASTER_DATA_PORT');

export interface MdUser {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  email: string;
  roles: string[];
  branchCodes: string[];
  department: string | null;
  /** "Store", "Admin" — shown next to the name on requests */
  jobTitle: string | null;
  isActive: boolean;
}

export interface MdBranch {
  code: string;
  name: string;
  isActive: boolean;
}

export interface MdSupplier {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  email: string | null;
  paymentTermDays: number;
  currency: string;
  isWalkIn: boolean;
  status: 'ACTIVE' | 'BLOCKED';
}

export interface MdItem {
  id: string;
  code: string;
  name: string;
  itemGroup: string;
  type: 'STOCK' | 'NON_STOCK' | 'SERVICE' | 'ASSET';
  uomCode: string;
  purchaseTaxCode: string;
  preferredSupplierCode: string | null;
  reorderLevel: string | null;
  packSize: string;
  isPurchasable: boolean;
  isBuyToOrder: boolean;
  isSellable: boolean;
  /** Sales unit (falls back to the base unit) and sales tax code, for Sales documents. */
  salesUomCode: string;
  salesTaxCode: string | null;
  barcode: string | null;
  /** For the estimated margin on sales documents. */
  standardCost: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'DISCONTINUED';
}

export interface MdCustomer {
  id: string;
  code: string;
  name: string;
  tin: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  branchCode: string;
  defaultAgentCode: string | null;
  creditTermDays: number;
  /** null = no limit */
  creditLimit: string | null;
  overdueLimit: string | null;
  /** GROUP / BRANCH when the customer overrides Credit Control, else null */
  creditScope: string | null;
  priceListCode: string;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  isCash: boolean;
  status: 'ACTIVE' | 'BLOCKED' | 'PROSPECT';
}

export interface MdPriceList {
  code: string;
  name: string;
  currency: string;
  taxInclusive: boolean;
}

export interface MdPrice {
  priceListCode: string;
  itemCode: string;
  uomCode: string;
  /** before tax, "235.0000" */
  unitPrice: string;
}

export interface MdWarehouse {
  code: string;
  name: string;
  branchCode: string;
  isActive: boolean;
}

/** Rack / bin inside a warehouse (HQ-MAIN/B-03). Codes match WMS location codes. */
export interface MdLocation {
  code: string;
  name: string;
  warehouseCode: string;
  isActive: boolean;
}

export interface MdTaxCode {
  code: string;
  /** "SST 10%" */
  name: string;
  /** fraction: "0.1000" */
  rate: string;
}

export interface MdContractPrice {
  itemCode: string;
  supplierCode: string;
  unitPrice: string;
  validFrom: string;
  validTo: string | null;
}

export interface SearchOptions {
  q?: string;
  limit?: number;
}

export interface MasterDataPort {
  findUserByCode(tenantId: string, code: string): Promise<MdUser | null>;
  listUsers(tenantId: string): Promise<MdUser[]>;
  listBranches(tenantId: string): Promise<MdBranch[]>;
  /** All suppliers, or only the given codes. */
  listSuppliers(tenantId: string, codes?: string[]): Promise<MdSupplier[]>;
  /** Active items that Purchase may buy. */
  listPurchasableItems(tenantId: string): Promise<MdItem[]>;
  findSupplier(tenantId: string, code: string): Promise<MdSupplier | null>;
  /** Suppliers matching code or name; activeOnly hides BLOCKED ones. */
  searchSuppliers(tenantId: string, options: SearchOptions & { activeOnly?: boolean }): Promise<MdSupplier[]>;
  /** Items by code, whatever their status (so callers can explain why one cannot be used). */
  findItems(tenantId: string, codes: string[]): Promise<MdItem[]>;
  /** Active purchasable items matching code or name. */
  searchPurchasableItems(tenantId: string, options: SearchOptions): Promise<MdItem[]>;
  listWarehouses(tenantId: string, branchCode?: string): Promise<MdWarehouse[]>;
  listLocations(tenantId: string, warehouseCode?: string): Promise<MdLocation[]>;
  listTaxCodes(tenantId: string): Promise<MdTaxCode[]>;
  /** Contract prices valid on a date (YYYY-MM-DD). */
  listContractPrices(tenantId: string, filter: { supplierCode?: string; itemCodes?: string[]; onDate: string }): Promise<MdContractPrice[]>;

  // ── Sales ──
  findCustomer(tenantId: string, code: string): Promise<MdCustomer | null>;
  /** All customers, or only the given codes. */
  listCustomers(tenantId: string, codes?: string[]): Promise<MdCustomer[]>;
  /** Customers matching code or name. activeOnly hides BLOCKED and PROSPECT ones. */
  searchCustomers(tenantId: string, options: SearchOptions & { activeOnly?: boolean }): Promise<MdCustomer[]>;
  listPriceLists(tenantId: string): Promise<MdPriceList[]>;
  /** Prices of one price list valid on a date, for the given items or all. */
  listPrices(tenantId: string, filter: { priceListCode: string; itemCodes?: string[]; onDate: string }): Promise<MdPrice[]>;
  /** Items matching code, name or barcode. sellableOnly hides items that cannot be sold. */
  searchSellableItems(tenantId: string, options: SearchOptions & { itemGroup?: string; sellableOnly?: boolean }): Promise<MdItem[]>;
}
