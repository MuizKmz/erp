/**
 * Where a master-data record is used (CLAUDE.md → Phase 3 · Record-usage check). Core asks; each module that keeps
 * documents answers from its own tables through a registered provider. The platform only collects the answers: what
 * "open" means is decided by each module, what may be deleted or blocked by Core.
 */

export const USAGE_KINDS = ['ITEM', 'CUSTOMER', 'SUPPLIER', 'UOM', 'TAX_CODE', 'PRICE_LIST', 'WAREHOUSE'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export interface UsageQuery {
  tenantId: string;
  kind: UsageKind;
  /** Business code (CH-DIN-01, C-0012, SST10 …). Codes never change, so documents are matched on them. */
  code: string;
}

/** A document that uses the record and is still open. */
export interface OpenDocument {
  module: string;
  docType: string;
  /** "Sales order" */
  docTypeLabel: string;
  docNo: string;
  status: string;
  /** "Pending approval" */
  statusLabel: string;
}

/** Something other than a document that points to the record, e.g. Sales' excluded items. */
export interface UsageReference {
  module: string;
  /** "Excluded items" */
  label: string;
  count: number;
}

/** One module's answer. */
export interface ModuleUsage {
  module: string;
  /** Documents of any status that use the record. A document with revisions counts once. */
  documents: number;
  open: OpenDocument[];
  references: UsageReference[];
}

/** A module that keeps documents and can say where a record is used. Read only. */
export interface RecordUsageProvider {
  readonly module: string;
  usage(query: UsageQuery): Promise<ModuleUsage>;
}

/** Every module's answer together. */
export interface RecordUsage {
  kind: UsageKind;
  code: string;
  documents: number;
  open: OpenDocument[];
  references: UsageReference[];
  modules: { module: string; documents: number; open: number }[];
}
