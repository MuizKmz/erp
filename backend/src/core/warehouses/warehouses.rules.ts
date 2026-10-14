/**
 * Warehouse rules (CLAUDE.md → Phase 3 · decision 6, Core business rules 1, 3 and 4). Core edits warehouses; their
 * locations belong to Inventory (the WMS) and stay read only (SRS FR-INV-001, SDD §6.1). Pure functions.
 */

/** HQ-MAIN, PNG-MAIN: a capital or digit first, then capitals, digits and dashes, up to 20. Typed once; it never changes. */
export const WAREHOUSE_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

export const WAREHOUSE_LABELS: Record<string, string> = { name: 'Name', branchCode: 'Branch', isActive: 'Status' };

export type WarehouseAction = 'edit' | 'delete';

/** Documents keep the warehouse and its branch together, so the branch is fixed once documents use the warehouse. */
export function branchChangeError(code: string, documents: number): string | null {
  if (documents === 0) return null;
  return `${code} is used on ${documents} document${documents === 1 ? '' : 's'}, so its branch cannot change. Add a new warehouse for the other branch instead.`;
}

/** "HQ · HQ Shah Alam" */
export const branchText = (b: { code: string; name: string } | undefined, code: string) => (b ? `${b.code} · ${b.name}` : code);
