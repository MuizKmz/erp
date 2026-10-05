import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Invoice rules (FlowS3, S17–S20). Pure functions. */

export const INV_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED'] as const;
export type InvStatus = (typeof INV_STATUSES)[number];

export type InvoiceAction = 'edit' | 'delete' | 'requestApproval' | 'release' | 'email' | 'print' | 'debitNote' | 'return';

export const INV_LOCKED_MESSAGE = 'A released invoice cannot be edited or deleted. Correct it with a debit note or a sales return.';

export type PaymentKey = 'DRAFT' | 'PENDING' | 'UNPAID' | 'OVERDUE' | 'PAID';

/**
 * The payment column and tabs of S17: "Draft · waiting approval", "Unpaid · credited", "Overdue 73 days", "Paid".
 * Unpaid, Overdue and Paid are worked out from the balance and the due date; they are never stored.
 */
export function paymentState(i: { status: InvStatus; balance: DecimalInput; credited: DecimalInput; dueDate: string | null; today: string }): { key: PaymentKey; label: string } {
  if (i.status === 'PENDING_APPROVAL') return { key: 'PENDING', label: 'Draft · waiting approval' };
  if (i.status === 'DRAFT') return { key: 'DRAFT', label: 'Draft' };
  if (dec(i.balance).lte(0)) return { key: 'PAID', label: 'Paid' };
  if (i.dueDate && i.dueDate < i.today) {
    const days = daysBetween(i.dueDate, i.today);
    return { key: 'OVERDUE', label: `Overdue ${days} ${days === 1 ? 'day' : 'days'}` };
  }
  return { key: 'UNPAID', label: dec(i.credited).gt(0) ? 'Unpaid · credited' : 'Unpaid' };
}

/** Due date = invoice date + credit term days. */
export function dueDateFor(docDate: string, creditTermDays: number): string {
  const d = new Date(`${docDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + creditTermDays);
  return d.toISOString().slice(0, 10);
}

/** Lines priced below the customer's price list (policy "Strict price list"): they need Sales Manager approval. */
export function belowPriceList(lines: { unitPrice: DecimalInput; listPrice: DecimalInput | null }[]): { count: number; highestPct: number } {
  let count = 0;
  let highest = 0;
  for (const l of lines) {
    if (l.listPrice === null || dec(l.listPrice).lte(0) || dec(l.unitPrice).gte(dec(l.listPrice))) continue;
    count++;
    highest = Math.max(highest, Math.round(dec(l.listPrice).sub(dec(l.unitPrice)).div(dec(l.listPrice)).mul(100).toNumber()));
  }
  return { count, highestPct: highest };
}

/** "Unit price 12% below the price list on 1 line" */
export function priceReason(below: { count: number; highestPct: number }): string {
  return `Unit price ${below.highestPct}% below the price list on ${below.count} ${below.count === 1 ? 'line' : 'lines'}`;
}

/** Rule 1 (invoice step): invoice now between 1 and delivered − already invoiced, per order line. */
export function invoiceQtyProblems(lines: { qty: DecimalInput; canInvoice: DecimalInput }[]): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  lines.forEach((l, i) => {
    const qty = dec(l.qty);
    if (qty.lte(0)) problems.push({ field: `lines[${i}].qty`, message: 'Invoice now must be at least 1.' });
    else if (qty.gt(dec(l.canInvoice))) problems.push({ field: `lines[${i}].qty`, message: `Invoice now cannot be more than delivered minus invoiced (${trimQty(l.canInvoice)}).` });
  });
  return problems;
}

/** Splits an invoiced quantity over the confirmed delivery lines that still have something to invoice, oldest first. */
export function allocateToDeliveries(qty: DecimalInput, deliveryLines: { id: string; open: DecimalInput }[]): { id: string; qty: Prisma.Decimal }[] {
  let left = dec(qty);
  const out: { id: string; qty: Prisma.Decimal }[] = [];
  for (const d of deliveryLines) {
    if (left.lte(0)) break;
    const take = Prisma_min(left, dec(d.open));
    if (take.lte(0)) continue;
    out.push({ id: d.id, qty: take });
    left = left.sub(take);
  }
  return out;
}

export function allowedInvoiceActions(i: {
  status: InvStatus;
  isMigrated: boolean;
  needsApproval: boolean;
  creditBlocked: boolean;
  approved: boolean;
  canEdit: boolean;
  canRelease: boolean;
  hasBalance: boolean;
}): InvoiceAction[] {
  if (i.isMigrated) return i.status === 'RELEASED' ? ['print'] : [];
  const actions: InvoiceAction[] = ['print'];
  if (i.status === 'DRAFT') {
    if (i.canEdit) actions.push('edit', 'delete');
    if (i.canEdit && i.needsApproval && !i.approved) actions.push('requestApproval');
    if (i.canRelease && !i.creditBlocked && (!i.needsApproval || i.approved)) actions.push('release');
    return actions;
  }
  if (i.status === 'PENDING_APPROVAL') return actions;
  actions.push('email');
  if (i.canEdit) actions.push('debitNote', 'return');
  return actions;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]!);
  } else if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

/** "Ringgit Malaysia Sixteen Thousand Five Hundred Only" (S20 amount in words). */
export function amountInWords(amount: DecimalInput): string {
  const value = dec(amount).toDecimalPlaces(2);
  const ringgit = value.floor().toNumber();
  const sen = value.sub(value.floor()).mul(100).toNumber();
  const groups: [number, string][] = [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1_000, 'Thousand'], [1, '']];
  let rest = ringgit;
  const words: string[] = [];
  for (const [size, name] of groups) {
    const n = Math.floor(rest / size);
    if (n > 0) words.push(`${belowThousand(n)}${name ? ` ${name}` : ''}`);
    rest %= size;
  }
  const r = words.length ? words.join(' ') : 'Zero';
  return `Ringgit Malaysia ${r}${sen ? ` and ${belowThousand(sen)} Sen` : ''} Only`;
}

function Prisma_min(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lt(b) ? a : b;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function trimQty(v: DecimalInput): string {
  return dec(v).toDecimalPlaces(4).toString();
}
