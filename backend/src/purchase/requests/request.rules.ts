import { dec, type DecimalInput } from '../../platform/http/decimal';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { plainQty } from '../shared/text.rules';

/** Purchase request rules (FlowP1 steps 2–6), free of database and framework. */

export type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'CONVERTED' | 'REJECTED';

export type RequestAction =
  | 'edit' // change a draft
  | 'delete' // delete a draft (its number becomes a gap)
  | 'submit' // send to Purchasing
  | 'reject' // Purchasing says no, with a reason
  | 'toPo' // "Create PO directly"
  | 'toRfq'; // "Ask suppliers (RFQ)"

export interface RequestActionInput {
  status: RequestStatus;
  isMigrated: boolean;
  /** The current user raised the request. */
  isRequester: boolean;
  can: (permission: string) => boolean;
}

/** The buttons a user sees on a request; the server checks the same list. */
export function allowedRequestActions(input: RequestActionInput): RequestAction[] {
  if (input.isMigrated) return [];
  switch (input.status) {
    case 'DRAFT':
      // Only the person who raised it changes or sends a draft.
      return input.isRequester && input.can(P.REQUEST_CREATE) ? ['edit', 'delete', 'submit'] : [];
    case 'SUBMITTED':
      return input.can(P.REQUEST_PROCESS) ? ['reject', 'toPo', 'toRfq'] : [];
    default:
      return [];
  }
}

export interface SubmitCheckInput {
  neededBy: string | null;
  reason: string | null;
  lineCount: number;
  today: string;
}

/** "Needed-by date and reason are required to submit." Returns problems by field, empty when fine. */
export function submitProblems(input: SubmitCheckInput): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (!input.neededBy) problems.push({ field: 'neededBy', message: 'Add the date you need it by.' });
  else if (input.neededBy < input.today) problems.push({ field: 'neededBy', message: 'Needed by cannot be in the past.' });
  if (!input.reason?.trim()) problems.push({ field: 'reason', message: 'Add a reason so Purchasing knows why it is needed.' });
  if (input.lineCount === 0) problems.push({ field: 'lines', message: 'Add at least one item.' });
  return problems;
}

/**
 * The short "What" text on the request list: "Wood screws ×20, lacquer ×8".
 * Uses each item name up to its first comma; items after the first start lower case.
 */
export function summarizeLines(lines: { itemName: string; qty: DecimalInput }[], maxItems = 3): string {
  const parts = lines.slice(0, maxItems).map((l, i) => {
    const name = l.itemName.split(',')[0]!.trim();
    const shown = i === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1);
    return `${shown} ×${plainQty(dec(l.qty))}`;
  });
  const more = lines.length - maxItems;
  return more > 0 ? `${parts.join(', ')} and ${more} more` : parts.join(', ');
}

/**
 * "Create PO directly": one draft PO per supplier. Lines are grouped by the supplier the buyer chose
 * (defaulting to the item's preferred supplier). Every line needs a supplier.
 */
export function groupLinesBySupplier<T extends { lineNo: number }>(
  lines: T[],
  supplierOf: (line: T) => string | null,
): { groups: Map<string, T[]>; missing: number[] } {
  const groups = new Map<string, T[]>();
  const missing: number[] = [];
  for (const line of lines) {
    const supplier = supplierOf(line);
    if (!supplier) {
      missing.push(line.lineNo);
      continue;
    }
    groups.set(supplier, [...(groups.get(supplier) ?? []), line]);
  }
  return { groups, missing };
}
