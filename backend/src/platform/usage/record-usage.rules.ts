/** Pure helpers for the record-usage check: summing module answers and summarising found documents. */
import type { ModuleUsage, OpenDocument, RecordUsage, UsageQuery, UsageReference } from './record-usage.types';

/** A document a provider found, already judged open or not by its own module. */
export interface FoundDocument {
  docType: string;
  docTypeLabel: string;
  docNo: string;
  status: string;
  statusLabel: string;
  isOpen: boolean;
}

/**
 * One module's answer from the documents it found: each document counts once (a quotation with two revisions is one
 * quotation), and the open ones are listed by document type in the module's own order, then by number.
 */
export function summarizeDocuments(module: string, found: FoundDocument[], typeOrder: readonly string[], references: UsageReference[] = []): ModuleUsage {
  const unique = new Map<string, FoundDocument>();
  for (const doc of found) unique.set(`${doc.docType}|${doc.docNo}`, doc);
  const rank = (type: string) => (typeOrder.includes(type) ? typeOrder.indexOf(type) : typeOrder.length);
  const open: OpenDocument[] = [...unique.values()]
    .filter((d) => d.isOpen)
    .sort((a, b) => rank(a.docType) - rank(b.docType) || a.docNo.localeCompare(b.docNo))
    .map(({ docType, docTypeLabel, docNo, status, statusLabel }) => ({ module, docType, docTypeLabel, docNo, status, statusLabel }));
  return { module, documents: unique.size, open, references: references.filter((r) => r.count > 0) };
}

/** All modules together, in module-name order so the answer does not depend on start-up order. */
export function mergeUsage(query: UsageQuery, answers: ModuleUsage[]): RecordUsage {
  const sorted = [...answers].sort((a, b) => a.module.localeCompare(b.module));
  return {
    kind: query.kind,
    code: query.code,
    documents: sorted.reduce((sum, a) => sum + a.documents, 0),
    open: sorted.flatMap((a) => a.open),
    references: sorted.flatMap((a) => a.references),
    modules: sorted.map((a) => ({ module: a.module, documents: a.documents, open: a.open.length })),
  };
}

/** "PENDING_APPROVAL" → "Pending approval". Modules override the words their screens use differently. */
export function statusWords(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
