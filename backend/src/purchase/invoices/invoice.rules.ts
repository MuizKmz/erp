import { dec, roundMoney, toRmText, type DecimalInput } from '../../platform/http/decimal';
import { plainQty } from '../shared/text.rules';

/**
 * Supplier invoice rules (FlowP5, CLAUDE.md rule 2). Pure functions, no database.
 * Bills are matched against what was RECEIVED, never against what was ordered.
 */

export type InvoiceStatus = 'DRAFT' | 'TO_MATCH' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID';
export type InvoiceDecision = 'RECORD_RECEIVED' | 'HOLD' | 'ACCEPT_AS_BILLED';
export type InvoiceAction = 'edit' | 'delete' | 'record' | 'hold' | 'acceptAsBilled';

export interface Tolerance {
  pricePct: DecimalInput; // ± % of the PO price
  qtyOver: DecimalInput; // units billed over received
  taxAmount: DecimalInput; // ± RM on the tax total
}

export interface MatchLineInput {
  lineNo: number;
  orderedQty: DecimalInput;
  orderedPrice: DecimalInput;
  /** Received and not yet billed or returned: the most this invoice may bill. */
  billableQty: DecimalInput;
  billedQty: DecimalInput;
  billedPrice: DecimalInput;
  taxRate: DecimalInput;
}

export interface MatchLine {
  lineNo: number;
  qtyOk: boolean;
  /** Billed minus billable; positive = billed but not received. */
  qtyOver: string;
  priceOk: boolean;
  /** (billed − PO price) / PO price × 100, one decimal: "3.2", "-1.5", "0". */
  pricePct: string;
  /** What "Record only what was received" records: the received quantity at an acceptable price. */
  recordQty: string;
  recordPrice: string;
}

export interface MatchResult {
  matched: boolean;
  lines: MatchLine[];
  /** Tax on the billed amounts, worked out from the tax rates. */
  expectedTax: string;
  taxOk: boolean;
  taxDiff: string;
  summary: string;
}

/** Percent difference with one decimal; 0 when the PO price is 0. */
export function pricePct(ordered: DecimalInput, billed: DecimalInput): string {
  const o = dec(ordered);
  if (o.isZero()) return '0';
  return dec(billed).sub(o).div(o).mul(100).toDecimalPlaces(1).toString();
}

/** The three-way match: per line quantity against received and price against the PO; tax on the total. */
export function matchInvoice(lines: MatchLineInput[], billedTax: DecimalInput | null, tol: Tolerance): MatchResult {
  const out = lines.map((l): MatchLine => {
    const billable = dec(l.billableQty).lt(0) ? dec(0) : dec(l.billableQty);
    const over = dec(l.billedQty).sub(billable);
    const pct = pricePct(l.orderedPrice, l.billedPrice);
    const priceOk = dec(pct).abs().lte(dec(tol.pricePct));
    const qtyOk = over.lte(dec(tol.qtyOver));
    return {
      lineNo: l.lineNo,
      qtyOk,
      qtyOver: over.toFixed(4),
      priceOk,
      pricePct: pct,
      recordQty: (dec(l.billedQty).lt(billable) ? dec(l.billedQty) : billable).toFixed(4),
      recordPrice: dec(priceOk ? l.billedPrice : l.orderedPrice).toFixed(4),
    };
  });
  const expectedTax = lines.reduce((s, l) => s.add(roundMoney(roundMoney(dec(l.billedQty).mul(dec(l.billedPrice))).mul(dec(l.taxRate)))), dec(0));
  const taxDiff = billedTax === null ? dec(0) : dec(billedTax).sub(expectedTax);
  const taxOk = taxDiff.abs().lte(dec(tol.taxAmount));
  const matched = out.every((l) => l.qtyOk && l.priceOk) && taxOk;
  return { matched, lines: out, expectedTax: expectedTax.toFixed(2), taxOk, taxDiff: taxDiff.toFixed(2), summary: matchSummary(lines, out, taxOk, taxDiff) };
}

/** List text: "All three agree", "Billed 30 · received 20", "Price +3.2%", "Tax differs by RM 2.00". */
function matchSummary(input: MatchLineInput[], lines: MatchLine[], taxOk: boolean, taxDiff: ReturnType<typeof dec>): string {
  const parts: string[] = [];
  const qtyBad = lines.filter((l) => !l.qtyOk);
  if (qtyBad.length === 1 && input.length === 1) {
    const l = input[0]!;
    parts.push(`Billed ${plainQty(l.billedQty)} · received ${plainQty(dec(l.billableQty).lt(0) ? 0 : l.billableQty)}`);
  } else if (qtyBad.length) parts.push(`${qtyBad.length} lines billed over received`);
  const priceBad = lines.filter((l) => !l.priceOk);
  if (priceBad.length === 1) parts.push(`Price ${signed(priceBad[0]!.pricePct)}%`);
  else if (priceBad.length) parts.push(`${priceBad.length} prices differ`);
  if (!taxOk) parts.push(`Tax differs by ${toRmText(taxDiff.abs())}`);
  if (!parts.length) return 'All three agree';
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(' · ');
}

export const signed = (pct: string) => (dec(pct).gt(0) ? `+${pct}` : pct);

/** After "Record only what was received": "Qty fixed 100 → 95" or "Price fixed 25,800.00 → 25,000.00". */
export function fixedSummary(input: MatchLineInput[], lines: MatchLine[]): string {
  if (input.length === 1) {
    const l = input[0]!;
    const m = lines[0]!;
    const parts: string[] = [];
    if (!dec(m.recordQty).eq(dec(l.billedQty))) parts.push(`Qty fixed ${plainQty(l.billedQty)} → ${plainQty(m.recordQty)}`);
    if (!dec(m.recordPrice).eq(dec(l.billedPrice))) parts.push(`price fixed ${toRmText(l.billedPrice).replace('RM ', '')} → ${toRmText(m.recordPrice).replace('RM ', '')}`);
    if (parts.length) return parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(' · ');
  }
  return 'Recorded as received';
}

/** What a decided or to-be-decided invoice records, line by line. */
export function recordedLines(
  input: (MatchLineInput & { taxRate: DecimalInput })[],
  lines: MatchLine[],
  decision: InvoiceDecision | 'MATCHED',
) {
  return input.map((l, i) => {
    const m = lines[i]!;
    const asBilled = decision === 'MATCHED' || decision === 'ACCEPT_AS_BILLED';
    const qty = dec(asBilled ? l.billedQty : m.recordQty);
    const price = dec(asBilled ? l.billedPrice : m.recordPrice);
    const amount = roundMoney(qty.mul(price));
    return { lineNo: l.lineNo, qty, unitPrice: price, amount, taxAmount: roundMoney(amount.mul(dec(l.taxRate))) };
  });
}

/** Only invoices still to match can change; the decision buttons depend on the match. */
export function allowedInvoiceActions(input: { status: InvoiceStatus; isMigrated: boolean; canEdit: boolean; matched: boolean }): InvoiceAction[] {
  if (input.isMigrated || !input.canEdit || input.status !== 'TO_MATCH') return [];
  return input.matched ? ['edit', 'delete', 'record'] : ['edit', 'delete', 'record', 'hold', 'acceptAsBilled'];
}

/** Due date: invoice date plus the payment term. */
export function dueDate(invoiceDate: string, paymentTermDays: number): string {
  const d = new Date(`${invoiceDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + paymentTermDays);
  return d.toISOString().slice(0, 10);
}
