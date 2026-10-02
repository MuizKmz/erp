import { dec, toRmText, type DecimalInput } from '../../platform/http/decimal';

/**
 * Operation Policies rules (P24 Approval Rules, P25 Document Types, P26 Email Templates). Pure functions.
 * Changes apply to new documents only and every change is written to the change history.
 */

export interface FieldProblem {
  field: string;
  message: string;
}

/** Limits are positive amounts; the second approver limit is above the first. */
export function ruleProblems(rules: { index: number; label: string; threshold: DecimalInput | null; secondOver: DecimalInput | null }[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const r of rules) {
    if (r.threshold !== null && !dec(r.threshold).gt(0)) problems.push({ field: `rules[${r.index}].thresholdAmount`, message: `${r.label}: the limit must be more than RM 0.00.` });
    if (r.secondOver !== null && r.threshold !== null && !dec(r.secondOver).gt(dec(r.threshold))) {
      problems.push({ field: `rules[${r.index}].secondOverAmount`, message: `${r.label}: the second approver limit must be above ${toRmText(r.threshold)}.` });
    }
  }
  return problems;
}

/** Match tolerance: price 0–20 %, quantity over received 0 or more, tax rounding 0–100. */
export function toleranceProblems(t: { pricePct: DecimalInput; qtyOver: DecimalInput; taxAmount: DecimalInput }): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (dec(t.pricePct).lt(0) || dec(t.pricePct).gt(20)) problems.push({ field: 'tolerance.pricePct', message: 'Price tolerance must be between 0% and 20%.' });
  if (dec(t.qtyOver).lt(0)) problems.push({ field: 'tolerance.qtyOver', message: 'Quantity tolerance cannot be below 0.' });
  if (dec(t.taxAmount).lt(0) || dec(t.taxAmount).gt(100)) problems.push({ field: 'tolerance.taxAmount', message: 'Tax rounding must be between RM 0.00 and RM 100.00.' });
  return problems;
}

/** Numbers are never re-used: the next number cannot go below what is already given out. */
export function sequenceProblems(rows: { index: number; name: string; prefix: string; digits: number; nextValue: number; currentNext: number }[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const prefixes = new Map<string, string>();
  for (const r of rows) {
    if (!/^[A-Z]{1,6}-$/.test(r.prefix)) problems.push({ field: `sequences[${r.index}].prefix`, message: `${r.name}: the prefix is 1 to 6 capital letters and a dash, like PO-.` });
    else if (prefixes.has(r.prefix)) problems.push({ field: `sequences[${r.index}].prefix`, message: `${r.name}: ${r.prefix} is already used by ${prefixes.get(r.prefix)}.` });
    prefixes.set(r.prefix, r.name);
    if (r.digits < 3 || r.digits > 8) problems.push({ field: `sequences[${r.index}].digits`, message: `${r.name}: use 3 to 8 digits.` });
    if (r.nextValue < r.currentNext) {
      problems.push({ field: `sequences[${r.index}].nextValue`, message: `${r.name}: the next number cannot go back below ${r.currentNext}. Numbers are never re-used.` });
    }
    if (String(r.nextValue).length > r.digits) problems.push({ field: `sequences[${r.index}].digits`, message: `${r.name}: ${r.nextValue} does not fit in ${r.digits} digits.` });
  }
  return problems;
}

/** "PO-0007", or "PO-PNG-0007" when the branch code is added. */
export function formatNumber(prefix: string, digits: number, value: number, branchCode?: string | null): string {
  const n = String(value).padStart(digits, '0');
  return branchCode ? `${prefix}${branchCode}-${n}` : `${prefix}${n}`;
}

/** Placeholders a template uses: "{po.number}" → "po.number". */
export function templateFields(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(/\{([a-z_.]+)\}/g)) out.add(m[1]!);
  return [...out];
}

/** "Penang PO limit raised to RM 5,000.00" / "lowered" for the change history. */
export function limitChange(label: string, before: DecimalInput | null, after: DecimalInput | null): string | null {
  if (before === null && after === null) return null;
  if (before !== null && after !== null && dec(before).eq(dec(after))) return null;
  if (after === null) return `${label} removed`;
  if (before === null) return `${label} set to ${toRmText(after)}`;
  return `${label} ${dec(after).gt(dec(before)) ? 'raised' : 'lowered'} to ${toRmText(after)}`;
}

const SUPPLIER = ['supplier.contact', 'supplier.email'];
const BUYER = ['buyer.name', 'buyer.email'];

/** Fields each template can use ("Fields you can use"). Supplier fields come from Master Data; company name from Company. */
export const TEMPLATE_FIELDS: Record<string, string[]> = {
  PO_TO_SUPPLIER: [...SUPPLIER, 'po.number', 'po.date', 'po.deliver_to', 'po.expected_date', 'po.currency', 'po.total', ...BUYER, 'company.name'],
  RFQ_REQUEST: [...SUPPLIER, 'rfq.number', 'rfq.items', 'rfq.reply_by', 'rfq.reply_link', ...BUYER, 'company.name'],
  RFQ_NOT_AWARDED: [...SUPPLIER, 'rfq.number', ...BUYER, 'company.name'],
  DELIVERY_REMINDER: [...SUPPLIER, 'po.number', 'po.deliver_to', 'po.expected_date', ...BUYER, 'company.name'],
  INVOICE_DIFFERENCE: [...SUPPLIER, 'invoice.supplier_no', 'invoice.recorded_total', 'invoice.message', ...BUYER, 'company.name'],
  CANCELLATION_NOTICE: [...SUPPLIER, 'po.number', 'cancel.lines', 'cancel.reason', ...BUYER, 'company.name'],
  RETURN_NOTICE: [...SUPPLIER, 'return.number', 'return.grn_number', 'return.rma', 'return.reason', 'return.lines', 'return.collection', 'return.currency', 'return.total', ...BUYER, 'company.name'],
  APPROVAL_REQUEST: ['approver.name', 'approver.email', 'requester.name', 'doc.title', 'doc.number', 'doc.currency', 'doc.total', 'approval.reason', 'approval.note', 'company.name'],
};

/** A field in braces that this template cannot fill would go out as "{po.numbr}" — refuse it. */
export function unknownFieldProblems(key: string, parts: { field: string; text: string | null | undefined }[]): FieldProblem[] {
  const allowed = new Set(TEMPLATE_FIELDS[key] ?? []);
  const problems: FieldProblem[] = [];
  for (const p of parts) {
    const bad = templateFields(p.text).filter((f) => !allowed.has(f));
    if (bad.length) problems.push({ field: p.field, message: `{${bad[0]}} is not a field this email can use. Pick one from Fields you can use.` });
  }
  return problems;
}

/** Example values for "Send test email". */
export function sampleValues(user: { name: string; email: string }, companyName: string): Record<string, string> {
  return {
    'supplier.contact': 'Encik Faizal', 'supplier.email': user.email,
    'po.number': 'PO-0000', 'po.date': '1 Oct 2026', 'po.deliver_to': 'HQ Main Store', 'po.expected_date': '8 Oct 2026', 'po.currency': 'MYR', 'po.total': '1,000.00',
    'rfq.number': 'RFQ-0000', 'rfq.items': '100 roll FB-OAK-01 chair fabric roll', 'rfq.reply_by': '5 Oct 2026', 'rfq.reply_link': '(link to the reply page)',
    'invoice.supplier_no': 'INV-TEST', 'invoice.recorded_total': 'MYR 1,000.00', 'invoice.message': 'This is a test.',
    'cancel.lines': '5 roll FB-OAK-01', 'cancel.reason': 'Test',
    'return.number': 'PRT-0000', 'return.grn_number': 'GRN-0000', 'return.rma': 'RMA-TEST', 'return.reason': 'Test', 'return.lines': '1 roll FB-OAK-01', 'return.collection': 'Supplier collects', 'return.currency': 'MYR', 'return.total': '44.00',
    'approver.name': user.name, 'approver.email': user.email, 'requester.name': user.name, 'doc.title': 'Purchase order', 'doc.number': 'PO-0000', 'doc.currency': 'MYR', 'doc.total': '1,000.00',
    'approval.reason': 'Test email', 'approval.note': 'This is a test.',
    'buyer.name': user.name, 'buyer.email': user.email, 'company.name': companyName,
  };
}
