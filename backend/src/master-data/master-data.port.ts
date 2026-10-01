/**
 * Everything Purchase (and later Sales) reads from Master Data goes through this interface.
 * Phase 1: PrismaMasterDataAdapter reads the local mdm_ seed tables.
 * Later: an HTTP adapter calls the real Master Data API — nothing that depends on this port changes.
 * READ ONLY: there are deliberately no write methods.
 *
 * Grows step by step (items, suppliers, warehouses, tax codes arrive with the schema in step 2).
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

export interface MasterDataPort {
  findUserByCode(tenantId: string, code: string): Promise<MdUser | null>;
  listUsers(tenantId: string): Promise<MdUser[]>;
  listBranches(tenantId: string): Promise<MdBranch[]>;
}
