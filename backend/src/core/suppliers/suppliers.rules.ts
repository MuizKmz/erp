/**
 * Supplier rules (CLAUDE.md → Phase 3 · decisions 2, 9 and Core business rules 2–5, 10). Pure functions; the service
 * loads the data and turns the answers into 400 / 403 / 409 responses.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { FieldError } from '../../platform/http/errors';

export const SUPPLIER_STATUSES = ['ACTIVE', 'BLOCKED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export const STATUS_LABEL: Record<SupplierStatus, string> = { ACTIVE: 'Active', BLOCKED: 'Blocked' };

/** Purchase buys in ringgit only for now (foreign currency is not in Phase 3). */
export const CURRENCIES = ['MYR'] as const;

/** Field labels for the before-and-after audit, in the order the form shows them. */
export const SUPPLIER_LABELS: Record<string, string> = {
  name: 'Name',
  shortName: 'Short name',
  category: 'Supplies',
  isWalkIn: 'Walk-in shop',
  contactName: 'Contact',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  tin: 'TIN',
  idType: 'ID type',
  regNo: 'ID number',
  sstNo: 'Sales tax no',
  serviceTaxNo: 'Service tax no',
  einvoiceEmail: 'e-Invoice email',
  paymentTermDays: 'Payment term',
  currency: 'Currency',
  contractPrices: 'Contract prices',
};

/** Contract prices let an order skip the RFQ (Purchase rule 4), so only core.supplier.contract changes them. */
export function permissionsNeeded(changedFields: string[]): { contracts: boolean; details: boolean } {
  return { contracts: changedFields.includes('contractPrices'), details: changedFields.some((f) => f !== 'contractPrices') };
}

/** What a supplier needs before it can be active (rule 5). Empty = ready. */
export function activationGaps(s: { name: string; paymentTermDays: number | null; currency: string }): FieldError[] {
  const gaps: FieldError[] = [];
  if (!s.name?.trim()) gaps.push({ field: 'name', message: 'Give the supplier a name.' });
  if (s.paymentTermDays === null || s.paymentTermDays === undefined) gaps.push({ field: 'paymentTermDays', message: 'Pick the payment term.' });
  if (!s.currency) gaps.push({ field: 'currency', message: 'Pick the currency.' });
  return gaps;
}

export type SupplierAction = 'edit' | 'editContracts' | 'block' | 'activate' | 'delete';

export function statusActions(status: SupplierStatus): ('block' | 'activate')[] {
  return status === 'ACTIVE' ? ['block'] : ['activate'];
}

/** The warning on the tax identity card (decision 9). Walk-in shops are not asked. Never blocks a save. */
export function eInvoiceGap(s: { isWalkIn: boolean; tin: string | null; regNo: string | null }): string | null {
  if (s.isWalkIn) return null;
  const noTin = !s.tin?.trim();
  const noId = !s.regNo?.trim();
  if (noTin && noId) return 'No TIN or ID number yet. e-Invoices with this supplier need both.';
  if (noId) return 'No ID number yet. e-Invoices need it with the TIN.';
  if (noTin) return 'No TIN yet. e-Invoices need it with the ID number.';
  return null;
}

export interface ContractPrice {
  itemCode: string;
  unitPrice: DecimalInput;
  /** YYYY-MM-DD */
  validFrom: string;
  /** YYYY-MM-DD, or null for no end */
  validTo: string | null;
}

/** "1 Jan 2026" */
function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

/** "SF-CUS-03 at 2100.0000, 1 Jan 2026 – 31 Dec 2026" */
export function contractText(c: ContractPrice): string {
  return `${c.itemCode} at ${dec(c.unitPrice).toFixed(4)}, ${day(c.validFrom)} – ${c.validTo ? day(c.validTo) : 'no end'}`;
}

/**
 * A supplier's contract prices: a price above 0, an end on or after the start, and no two periods for the same item
 * that overlap (rule 10). Errors by field path contractPrices[i].
 */
export function contractPriceErrors(rows: ContractPrice[]): FieldError[] {
  const errors: FieldError[] = [];
  rows.forEach((c, i) => {
    if (!dec(c.unitPrice).gt(0)) errors.push({ field: `contractPrices[${i}]`, message: 'A contract price must be more than 0.' });
    else if (c.validTo && c.validTo < c.validFrom) errors.push({ field: `contractPrices[${i}]`, message: 'The end date cannot be before the start date.' });
  });
  rows.forEach((a, i) => {
    rows.slice(0, i).forEach((b) => {
      if (a.itemCode !== b.itemCode || errors.some((e) => e.field === `contractPrices[${i}]`)) return;
      const overlap = a.validFrom <= (b.validTo ?? '9999-12-31') && b.validFrom <= (a.validTo ?? '9999-12-31');
      if (overlap) errors.push({ field: `contractPrices[${i}]`, message: `Two contract prices for ${a.itemCode} overlap. Let one end before the other starts.` });
    });
  });
  return errors;
}

/** The stored supplier as plain values, for the audit and the mdm.supplier.* event payload. */
export interface SupplierRecord {
  code: string;
  name: string;
  shortName: string | null;
  category: string | null;
  isWalkIn: boolean;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tin: string | null;
  idType: string | null;
  regNo: string | null;
  sstNo: string | null;
  serviceTaxNo: string | null;
  einvoiceEmail: string | null;
  paymentTermDays: number;
  currency: string;
  status: string;
}

/** What the audit compares: the payment term in words, contract prices as one line of text. */
export function supplierAudit(s: SupplierRecord, contracts: ContractPrice[]): Record<string, unknown> {
  const sorted = [...contracts].sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.validFrom.localeCompare(b.validFrom));
  return {
    ...s,
    paymentTermDays: s.paymentTermDays === 0 ? 'Cash' : `${s.paymentTermDays} days`,
    contractPrices: sorted.length ? sorted.map(contractText).join('; ') : null,
  };
}

/** The supplier after a change, as mdm.supplier.* events carry it, with its contract prices. */
export function supplierSnapshot(s: SupplierRecord, contracts: ContractPrice[]) {
  return {
    ...s,
    contractPrices: contracts.map((c) => ({ itemCode: c.itemCode, unitPrice: dec(c.unitPrice).toFixed(4), validFrom: c.validFrom, validTo: c.validTo })),
  };
}
