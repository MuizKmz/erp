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
  status: 'ACTIVE' | 'BLOCKED' | 'DISCONTINUED';
}

export interface MasterDataPort {
  findUserByCode(tenantId: string, code: string): Promise<MdUser | null>;
  listUsers(tenantId: string): Promise<MdUser[]>;
  listBranches(tenantId: string): Promise<MdBranch[]>;
  /** All suppliers, or only the given codes. */
  listSuppliers(tenantId: string, codes?: string[]): Promise<MdSupplier[]>;
  /** Active items that Purchase may buy. */
  listPurchasableItems(tenantId: string): Promise<MdItem[]>;
}
