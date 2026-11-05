import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Invoice register (S05): the invoices, debit notes and credit notes (sales returns) released in a month. Pure. */

export type RegisterType = 'INVOICE' | 'DEBIT_NOTE' | 'CREDIT_NOTE';

export const REGISTER_TYPES: Record<RegisterType, string> = { INVOICE: 'Invoice', DEBIT_NOTE: 'Debit note', CREDIT_NOTE: 'Credit note' };

/** The Type filter's keys. */
export const REGISTER_TYPE_KEYS: Record<string, RegisterType> = { invoice: 'INVOICE', 'debit-note': 'DEBIT_NOTE', 'credit-note': 'CREDIT_NOTE' };

/** A credit note takes away from what was billed; the register shows it as a negative amount. */
export function signed(type: RegisterType, amount: DecimalInput): Prisma.Decimal {
  return type === 'CREDIT_NOTE' ? dec(amount).neg() : dec(amount);
}

/** Per type, how many and how much (as on the documents), and the net billed: invoices + debit notes − credit notes. */
export function registerTotals(docs: { type: RegisterType; beforeTax: DecimalInput; tax: DecimalInput; total: DecimalInput }[]) {
  const of = (type: RegisterType) => {
    const these = docs.filter((d) => d.type === type);
    return { count: these.length, amount: these.reduce((s, d) => s.add(dec(d.total)), dec(0)) };
  };
  const net = (pick: (d: (typeof docs)[number]) => DecimalInput) => docs.reduce((s, d) => s.add(signed(d.type, pick(d))), dec(0));
  return {
    invoiced: of('INVOICE'),
    debitNotes: of('DEBIT_NOTE'),
    credited: of('CREDIT_NOTE'),
    net: { beforeTax: net((d) => d.beforeTax), tax: net((d) => d.tax), total: net((d) => d.total) },
  };
}
