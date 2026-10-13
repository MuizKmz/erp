/**
 * When a Sales document still needs the master data it uses (CLAUDE.md → Phase 3 · Record-usage check). Open =
 * a draft, a document waiting for approval, or a released document with something left to deliver or invoice.
 * Released invoices waiting for payment do not count: what is left is money, so a customer who does not pay can
 * still be blocked. Pure functions.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import { statusWords, summarizeDocuments, type FoundDocument } from '../../platform/usage/record-usage.rules';
import type { ModuleUsage, UsageReference } from '../../platform/usage/record-usage.types';

export type SalesDocType =
  | 'SALES_ORDER'
  | 'DELIVERY'
  | 'INVOICE'
  | 'QUOTATION'
  | 'PROFORMA'
  | 'CASH_SALE'
  | 'DEBIT_NOTE'
  | 'RETURN'
  | 'CANCEL_ORDER'
  | 'ENQUIRY';

/** Listing order of open documents, and the names Sales screens use. */
export const SALES_DOC_TYPES: { type: SalesDocType; label: string }[] = [
  { type: 'SALES_ORDER', label: 'Sales order' },
  { type: 'DELIVERY', label: 'Delivery order' },
  { type: 'INVOICE', label: 'Invoice' },
  { type: 'QUOTATION', label: 'Quotation' },
  { type: 'PROFORMA', label: 'Proforma invoice' },
  { type: 'CASH_SALE', label: 'Cash sale' },
  { type: 'DEBIT_NOTE', label: 'Debit note' },
  { type: 'RETURN', label: 'Sales return' },
  { type: 'CANCEL_ORDER', label: 'Cancel order' },
  { type: 'ENQUIRY', label: 'Enquiry' },
];

/** Statuses in which a document is open whatever its quantities. */
export const SALES_OPEN_STATUSES: Record<SalesDocType, readonly string[]> = {
  SALES_ORDER: ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL'],
  DELIVERY: ['DRAFT'],
  INVOICE: ['DRAFT', 'PENDING_APPROVAL'],
  QUOTATION: ['DRAFT', 'PENDING_APPROVAL', 'RELEASED'],
  PROFORMA: ['DRAFT', 'SENT'],
  CASH_SALE: ['DRAFT'],
  DEBIT_NOTE: ['DRAFT'],
  RETURN: ['DRAFT'],
  CANCEL_ORDER: ['DRAFT'],
  ENQUIRY: ['NEW', 'FORWARDED'],
};

export interface SalesDocRow {
  docType: SalesDocType;
  docNo: string;
  status: string;
  /** Quotations and sales orders: the revision of this row. */
  revision?: number;
  /** Delivery orders only: the quantities of every line. */
  deliveryLines?: { qty: DecimalInput; invoicedQty: DecimalInput }[];
}

/** A delivered order stays open while some of it is not invoiced yet. */
export function deliveryLeftToInvoice(lines: { qty: DecimalInput; invoicedQty: DecimalInput }[]): boolean {
  return lines.some((l) => dec(l.qty).gt(dec(l.invoicedQty)));
}

/** Keeps only the newest revision of each document (older quotation revisions are SUPERSEDED). */
export function latestRevisions(rows: SalesDocRow[]): SalesDocRow[] {
  const newest = new Map<string, SalesDocRow>();
  for (const row of rows) {
    const key = `${row.docType}|${row.docNo}`;
    const current = newest.get(key);
    if (!current || (row.revision ?? 0) > (current.revision ?? 0)) newest.set(key, row);
  }
  return [...newest.values()];
}

export function isOpenSalesDoc(row: SalesDocRow): boolean {
  if (SALES_OPEN_STATUSES[row.docType].includes(row.status)) return true;
  return row.docType === 'DELIVERY' && row.status === 'CONFIRMED' && deliveryLeftToInvoice(row.deliveryLines ?? []);
}

function statusLabel(row: SalesDocRow, isOpen: boolean): string {
  if (row.docType === 'DELIVERY' && row.status === 'CONFIRMED') return isOpen ? 'Delivered, not yet invoiced' : 'Delivered';
  return statusWords(row.status);
}

/** Sales' answer from the documents it found, plus references that are not documents (excluded items). */
export function salesUsage(rows: SalesDocRow[], references: UsageReference[] = []): ModuleUsage {
  const label = new Map(SALES_DOC_TYPES.map((t) => [t.type, t.label]));
  const found: FoundDocument[] = latestRevisions(rows).map((row) => {
    const isOpen = isOpenSalesDoc(row);
    return { docType: row.docType, docTypeLabel: label.get(row.docType) ?? row.docType, docNo: row.docNo, status: row.status, statusLabel: statusLabel(row, isOpen), isOpen };
  });
  return summarizeDocuments('sales', found, SALES_DOC_TYPES.map((t) => t.type), references);
}
