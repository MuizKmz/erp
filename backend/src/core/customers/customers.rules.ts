/**
 * Customer rules (CLAUDE.md → Phase 3 · decisions 2, 7, 9 and Core business rules 2–5, 9). Pure functions; the service
 * loads the data and turns the answers into 400 / 403 / 409 responses.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { FieldError } from '../../platform/http/errors';

/** Tab order on C04: All, Active, Prospect, Blocked. */
export const CUSTOMER_STATUSES = ['ACTIVE', 'PROSPECT', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const STATUS_LABEL: Record<CustomerStatus, string> = { ACTIVE: 'Active', PROSPECT: 'Prospect', BLOCKED: 'Blocked' };

/** e-Invoice identity types (SRS FR-MST-042, Appendix E). */
export const ID_TYPES = ['BRN', 'NRIC', 'PASSPORT', 'ARMY'] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_TYPE_LABEL: Record<IdType, string> = { BRN: 'BRN · business registration', NRIC: 'NRIC · identity card', PASSPORT: 'Passport', ARMY: 'Army number' };

export const CREDIT_SCOPES = ['GROUP', 'BRANCH'] as const;
export const TAX_MODES = ['EXCLUSIVE', 'INCLUSIVE'] as const;

/** EQ-2609-0010: an enquiry number as Sales gives it. */
export const ENQUIRY_NO = /^EQ-\d{4}-\d{4,}$/;

/** Field labels for the before-and-after audit, in the order the form shows them. */
export const CUSTOMER_LABELS: Record<string, string> = {
  name: 'Name',
  category: 'Category',
  area: 'Area',
  branchCode: 'Branch',
  defaultAgentCode: 'Sales agent',
  billingAddress: 'Billing address',
  deliveryAddress: 'Delivery address',
  contactName: 'Contact',
  email: 'Email',
  phone: 'Phone',
  tin: 'TIN',
  idType: 'ID type',
  idNumber: 'ID number',
  salesTaxNo: 'Sales tax no',
  serviceTaxNo: 'Service tax no',
  einvoiceEmail: 'e-Invoice email',
  taxMode: 'Tax mode',
  creditTermDays: 'Credit term',
  creditLimit: 'Credit limit',
  overdueLimit: 'Overdue limit',
  creditScope: 'Credit checked',
  priceListCode: 'Price list',
};

/** The credit fields: only `core.customer.credit` changes them (decision 2, rule 9). */
export const CREDIT_FIELDS: readonly string[] = ['creditTermDays', 'creditLimit', 'overdueLimit', 'creditScope'];

/** Which permissions a set of changed fields needs: credit fields need the credit permission, the rest the edit one. */
export function permissionsNeeded(changedFields: string[]): { credit: boolean; details: boolean } {
  return {
    credit: changedFields.some((f) => CREDIT_FIELDS.includes(f)),
    details: changedFields.some((f) => !CREDIT_FIELDS.includes(f)),
  };
}

export interface CustomerFields {
  name: string;
  branchCode: string;
  priceListCode: string;
  creditTermDays: number | null;
}

/** What a customer needs before it can be active (rule 5). Empty = ready. */
export function activationGaps(c: CustomerFields): FieldError[] {
  const gaps: FieldError[] = [];
  if (!c.name?.trim()) gaps.push({ field: 'name', message: 'Give the customer a name.' });
  if (!c.branchCode) gaps.push({ field: 'branchCode', message: 'Pick the branch.' });
  if (!c.priceListCode) gaps.push({ field: 'priceListCode', message: 'Pick the price list.' });
  if (c.creditTermDays === null || c.creditTermDays === undefined) gaps.push({ field: 'creditTermDays', message: 'Pick the credit term.' });
  return gaps;
}

/** Credit limits are 0 or more, or empty for no limit (rule 9). */
export function limitError(value: DecimalInput | null | undefined, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return dec(value).lt(0) ? `${label} cannot be below 0. Leave it empty for no limit.` : null;
}

export type CustomerAction = 'edit' | 'editCredit' | 'block' | 'activate' | 'delete';

/** Which status actions the status allows, before the usage check. A prospect becomes a customer by Activate. */
export function statusActions(status: CustomerStatus): ('block' | 'activate')[] {
  if (status === 'ACTIVE') return ['block'];
  if (status === 'BLOCKED') return ['activate'];
  return ['activate', 'block'];
}

/** The warning on the tax identity card when e-Invoices would miss something (decision 9). Never blocks a save. */
export function eInvoiceGap(c: { isCash: boolean; tin: string | null; idNumber: string | null }): string | null {
  if (c.isCash) return null;
  const noTin = !c.tin?.trim();
  const noId = !c.idNumber?.trim();
  if (noTin && noId) return 'No TIN or ID number yet. e-Invoices with this customer need both.';
  if (noId) return 'No ID number yet. e-Invoices need it with the TIN.';
  if (noTin) return 'No TIN yet. e-Invoices need it with the ID number.';
  return null;
}

/** "Cash" for 0 days, else "30 days". */
export function creditTermText(days: number): string {
  return days === 0 ? 'Cash' : `${days} days`;
}

/** The stored customer as plain values, for the audit and the mdm.customer.* event payload. */
export interface CustomerRecord {
  code: string;
  name: string;
  category: string | null;
  area: string | null;
  branchCode: string;
  defaultAgentCode: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  tin: string | null;
  idType: string | null;
  idNumber: string | null;
  salesTaxNo: string | null;
  serviceTaxNo: string | null;
  einvoiceEmail: string | null;
  taxMode: string;
  creditTermDays: number;
  creditLimit: DecimalInput | null;
  overdueLimit: DecimalInput | null;
  creditScope: string | null;
  priceListCode: string;
  isCash: boolean;
  status: string;
}

const money = (v: DecimalInput | null) => (v === null || v === undefined ? null : dec(v).toFixed(2));

/** What the audit compares: money at 2 places, the credit term in words. */
export function customerAudit(c: CustomerRecord): Record<string, unknown> {
  return { ...c, creditLimit: money(c.creditLimit), overdueLimit: money(c.overdueLimit), creditTermDays: creditTermText(c.creditTermDays) };
}

/** The customer after a change, as mdm.customer.* events carry it (codes and plain values). */
export function customerSnapshot(c: CustomerRecord) {
  return { ...c, creditLimit: money(c.creditLimit), overdueLimit: money(c.overdueLimit) };
}
