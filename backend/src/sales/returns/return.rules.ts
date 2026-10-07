import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Sales return rules (FlowS6 steps 5–8, S27, S28, rules 1 and 12). Pure functions. */

export const SR_STATUSES = ['DRAFT', 'RELEASED'] as const;
export type SrStatus = (typeof SR_STATUSES)[number];
export type GoodsTo = 'DAMAGED' | 'STOCK';
export type ReturnAction = 'edit' | 'delete' | 'release' | 'attach';

export const RETURN_REASONS = ['Damaged in transit', 'Scratched top', 'Wrong colour', 'Wrong item delivered', 'Quality issue', 'Customer changed mind', 'Other'] as const;
export const CREDIT_METHODS = { CREDIT_NOTE: 'Credit note to customer account', REFUND: 'Refund through Finance' } as const;

export const SR_LOCKED_MESSAGE = 'A released return cannot be changed. The credit note is already queued.';

/**
 * Rule 1 (return step): return now can never be more than invoiced minus earlier returns, per invoice line.
 * "Return now cannot be more than invoiced minus earlier returns (60)."
 */
export function returnProblems(lines: { qty: DecimalInput; max: DecimalInput }[], requireOne = true): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  lines.forEach((l, i) => {
    const qty = dec(l.qty);
    if (qty.lt(0)) problems.push({ field: `lines[${i}].qty`, message: 'Return now cannot be below 0.' });
    else if (qty.gt(dec(l.max))) problems.push({ field: `lines[${i}].qty`, message: `Return now cannot be more than invoiced minus earlier returns (${trim(l.max)}).` });
  });
  if (requireOne && !problems.length && lines.every((l) => dec(l.qty).eq(0))) problems.push({ field: 'lines', message: 'Enter a quantity to return on at least one line.' });
  return problems;
}

/** The checklist on S28; release is possible only when every check is met. */
export function returnChecks(r: { lines: { qty: DecimalInput; max: DecimalInput }[]; customerActive: boolean; locationExists: boolean; locationName: string | null; reason: string | null }) {
  const qty = r.lines.reduce((s, l) => s.add(dec(l.qty)), dec(0));
  const max = r.lines.reduce((s, l) => s.add(dec(l.max)), dec(0));
  return [
    { key: 'qty', ok: qty.gt(0) && returnProblems(r.lines).length === 0, text: `Return qty ${trim(qty)} is within ${trim(max)} invoiced` },
    { key: 'customer', ok: r.customerActive, text: r.customerActive ? 'Customer is active in Master Data' : 'Customer is not active in Master Data' },
    { key: 'location', ok: r.locationExists, text: r.locationExists ? `Return location exists at ${r.locationName}` : 'Pick where the goods go back to' },
    { key: 'reason', ok: Boolean(r.reason?.trim()), text: r.reason?.trim() ? 'A reason is given' : 'Give a reason' },
  ];
}

/** "5 dining chairs" → here "5 Dining chair, solid oak", or "3 lines". */
export function returnSummary(lines: { itemName: string; qty: DecimalInput }[]): string {
  const back = lines.filter((l) => dec(l.qty).gt(0));
  if (!back.length) return '';
  if (back.length > 1) return `${back.length} lines`;
  return `${trim(back[0]!.qty)} ${back[0]!.itemName}`;
}

export function allowedReturnActions(r: { status: SrStatus; isMigrated: boolean; canEdit: boolean; canReceive: boolean }): ReturnAction[] {
  if (r.isMigrated) return [];
  if (r.status === 'RELEASED') return r.canEdit || r.canReceive ? ['attach'] : [];
  const actions: ReturnAction[] = [];
  if (r.canEdit) actions.push('edit', 'delete', 'attach');
  if (r.canReceive) actions.push('release');
  if (!r.canEdit && r.canReceive) actions.push('attach');
  return actions;
}

function trim(v: DecimalInput): string {
  return dec(v).toDecimalPlaces(4).toString();
}
