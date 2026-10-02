import { dec, roundMoney, type DecimalInput } from '../../platform/http/decimal';

/**
 * Request for quote rules (FlowP2, CLAUDE.md rules 4 and 5). Pure functions, no database.
 */

export type RfqStatus = 'DRAFT' | 'WAITING' | 'READY' | 'AWARDED' | 'CLOSED';
export type RfqAction = 'recordReply' | 'remind' | 'addSupplier' | 'award' | 'close';

/** Open RFQs can still get replies, more suppliers, an award or a close. */
export function allowedRfqActions(input: { status: RfqStatus; isMigrated: boolean; canManage: boolean; anyWaiting: boolean; anyReplied: boolean }): RfqAction[] {
  if (input.isMigrated || !input.canManage || !(input.status === 'WAITING' || input.status === 'READY')) return [];
  const actions: RfqAction[] = ['recordReply', 'addSupplier', 'close'];
  if (input.anyWaiting) actions.push('remind');
  if (input.anyReplied) actions.push('award');
  return actions;
}

/** WAITING until every asked supplier has replied or declined, then READY to compare. */
export function statusAfterReply(suppliers: { status: 'ASKED' | 'REPLIED' | 'DECLINED' }[]): 'WAITING' | 'READY' {
  return suppliers.length > 0 && suppliers.every((s) => s.status !== 'ASKED') ? 'READY' : 'WAITING';
}

/** "1 week", "3 weeks", "10 days", "1 day" */
export function leadTimeText(days: number): string {
  if (days > 0 && days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  }
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReplyForCompare {
  supplierCode: string;
  /** Unit price per RFQ line (lineNo → price); missing when the supplier did not quote the line. */
  prices: Map<number, DecimalInput>;
  leadTimeDays: number | null;
}

export interface CompareLine {
  lineNo: number;
  qty: DecimalInput;
}

export interface CompareResult {
  /** Total before tax per supplier that quoted every line. */
  totals: Map<string, string>;
  /** Cheapest supplier(s) by total; several when tied. */
  cheapest: string[];
  /** Lowest unit price per line. */
  lowestPrice: Map<number, string[]>;
  /** Shortest delivery time. */
  fastest: string[];
}

/** Side-by-side comparison: who is cheapest overall and per line, and who delivers soonest. */
export function compareReplies(lines: CompareLine[], replies: ReplyForCompare[]): CompareResult {
  const totals = new Map<string, string>();
  for (const r of replies) {
    if (!lines.every((l) => r.prices.has(l.lineNo))) continue;
    const total = lines.reduce((sum, l) => sum.add(roundMoney(dec(l.qty).mul(dec(r.prices.get(l.lineNo)!)))), dec(0));
    totals.set(r.supplierCode, total.toFixed(2));
  }
  const minOf = (entries: [string, string][]) => {
    if (!entries.length) return [];
    const min = entries.reduce((m, [, v]) => (dec(v).lt(dec(m)) ? v : m), entries[0]![1]);
    return entries.filter(([, v]) => dec(v).eq(dec(min))).map(([k]) => k);
  };
  const lowestPrice = new Map<number, string[]>();
  for (const l of lines) {
    lowestPrice.set(
      l.lineNo,
      minOf(replies.filter((r) => r.prices.has(l.lineNo)).map((r) => [r.supplierCode, dec(r.prices.get(l.lineNo)!).toFixed(4)])),
    );
  }
  const withLead = replies.filter((r) => r.leadTimeDays !== null);
  const fastestDays = withLead.length ? Math.min(...withLead.map((r) => r.leadTimeDays!)) : null;
  return {
    totals,
    cheapest: minOf([...totals]),
    lowestPrice,
    fastest: fastestDays === null ? [] : withLead.filter((r) => r.leadTimeDays === fastestDays).map((r) => r.supplierCode),
  };
}

/** Rule 5: awarding a supplier that is not the cheapest needs a written reason. Returns the problem, or null. */
export function awardProblem(input: {
  supplierCode: string;
  replied: boolean;
  quotedAllLines: boolean;
  cheapest: string[];
  reason: string | null | undefined;
  cheapestName?: string;
  saving?: string;
}): { field: string; message: string } | null {
  if (!input.replied) return { field: 'supplierCode', message: 'Only a supplier that has replied can be awarded.' };
  if (!input.quotedAllLines) return { field: 'supplierCode', message: 'This supplier did not quote every item. Ask them to complete the reply first.' };
  if (!input.cheapest.includes(input.supplierCode) && !input.reason?.trim()) {
    const who = input.cheapestName ? `${input.cheapestName} is cheaper` : 'Another supplier is cheaper';
    return { field: 'reason', message: `${who}${input.saving ? ` by ${input.saving}` : ''}. Write why you chose this supplier.` };
  }
  return null;
}

/** FlowP2 step 1: over the RFQ limit (RM 50,000.00) at least `minSuppliers` must be asked. */
export function supplierCountProblem(input: {
  supplierCount: number;
  estimatedValue: DecimalInput;
  rfqRequiredOn: boolean;
  rfqRequiredOver: DecimalInput;
  minSuppliers: number;
  limitText: string;
}): string | null {
  if (input.supplierCount < 1) return 'Pick at least one supplier to ask.';
  if (input.rfqRequiredOn && dec(input.estimatedValue).gt(dec(input.rfqRequiredOver)) && input.supplierCount < input.minSuppliers) {
    return `This is worth more than ${input.limitText}. Ask at least ${input.minSuppliers} suppliers.`;
  }
  return null;
}
