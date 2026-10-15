/**
 * When a Purchase document still needs the master data it uses (CLAUDE.md → Phase 3 · Record-usage check). Open =
 * a draft, a document waiting for approval, or a released document with something left to receive or bill. An
 * approved invoice waiting for payment and a return waiting for the supplier's credit do not count: what is left is
 * money, not Purchase work. Pure functions.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import { statusWords, summarizeDocuments, type FoundDocument } from '../../platform/usage/record-usage.rules';
import type { ModuleUsage, UsageReference } from '../../platform/usage/record-usage.types';

export type PurchaseDocType =
  | 'PURCHASE_ORDER'
  | 'GOODS_RECEIPT'
  | 'INVOICE'
  | 'RFQ'
  | 'REQUEST'
  | 'CASH_PURCHASE'
  | 'DEBIT_NOTE'
  | 'RETURN'
  | 'CANCEL_ORDER';

/** Listing order of open documents, and the names Purchase screens use. */
export const PURCHASE_DOC_TYPES: { type: PurchaseDocType; label: string }[] = [
  { type: 'PURCHASE_ORDER', label: 'Purchase order' },
  { type: 'GOODS_RECEIPT', label: 'Goods receipt' },
  { type: 'INVOICE', label: 'Purchase invoice' },
  { type: 'RFQ', label: 'RFQ' },
  { type: 'REQUEST', label: 'Purchase request' },
  { type: 'CASH_PURCHASE', label: 'Cash purchase' },
  { type: 'DEBIT_NOTE', label: 'Debit note' },
  { type: 'RETURN', label: 'Purchase return' },
  { type: 'CANCEL_ORDER', label: 'Cancel order' },
];

/** Statuses in which a document is open whatever its quantities. */
export const PURCHASE_OPEN_STATUSES: Record<PurchaseDocType, readonly string[]> = {
  PURCHASE_ORDER: ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL'],
  GOODS_RECEIPT: ['DRAFT'],
  INVOICE: ['DRAFT', 'TO_MATCH', 'PENDING_APPROVAL'],
  RFQ: ['DRAFT', 'WAITING', 'READY'],
  REQUEST: ['DRAFT', 'SUBMITTED'],
  CASH_PURCHASE: ['DRAFT'],
  DEBIT_NOTE: ['DRAFT', 'PENDING_APPROVAL'],
  RETURN: ['DRAFT'],
  CANCEL_ORDER: ['DRAFT'],
};

/** Words Purchase screens use where they differ from the status name. */
const STATUS_WORDS: Partial<Record<PurchaseDocType, Record<string, string>>> = {
  RFQ: { READY: 'Ready to compare' },
  RETURN: { RELEASED: 'Waiting for credit' },
};

export interface PurchaseDocRow {
  docType: PurchaseDocType;
  docNo: string;
  status: string;
  /** Goods receipts only: the quantities of every line. */
  receiptLines?: { receivedQty: DecimalInput; billedQty: DecimalInput; returnedQty: DecimalInput }[];
}

/** A confirmed goods receipt stays open while some of what came in is neither billed nor returned. */
export function receiptLeftToBill(lines: { receivedQty: DecimalInput; billedQty: DecimalInput; returnedQty: DecimalInput }[]): boolean {
  return lines.some((l) => dec(l.receivedQty).minus(dec(l.billedQty)).minus(dec(l.returnedQty)).gt(0));
}

export function isOpenPurchaseDoc(row: PurchaseDocRow): boolean {
  if (PURCHASE_OPEN_STATUSES[row.docType].includes(row.status)) return true;
  return row.docType === 'GOODS_RECEIPT' && row.status === 'CONFIRMED' && receiptLeftToBill(row.receiptLines ?? []);
}

function statusLabel(row: PurchaseDocRow, isOpen: boolean): string {
  if (row.docType === 'GOODS_RECEIPT' && row.status === 'CONFIRMED' && isOpen) return 'Confirmed, not yet billed';
  return STATUS_WORDS[row.docType]?.[row.status] ?? statusWords(row.status);
}

/** Purchase's answer from the documents it found. */
export function purchaseUsage(rows: PurchaseDocRow[], references: UsageReference[] = []): ModuleUsage {
  const label = new Map(PURCHASE_DOC_TYPES.map((t) => [t.type, t.label]));
  const found: FoundDocument[] = rows.map((row) => {
    const isOpen = isOpenPurchaseDoc(row);
    return { docType: row.docType, docTypeLabel: label.get(row.docType) ?? row.docType, docNo: row.docNo, status: row.status, statusLabel: statusLabel(row, isOpen), isOpen };
  });
  return summarizeDocuments('purchase', found, PURCHASE_DOC_TYPES.map((t) => t.type), references);
}
