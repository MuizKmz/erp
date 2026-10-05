import { Prisma } from '@prisma/client';
import { dec, roundMoney, type DecimalInput } from '../../platform/http/decimal';

/**
 * Sales money rules (CLAUDE.md → Sales business rules 14):
 *   gross    = round(qty × unit price, 2)
 *   discount = round(gross × discount % / 100, 2)
 *   amount   = gross − discount
 *   tax      = round(amount × rate, 2)                 tax mode EXCLUSIVE (price before tax)
 *            = round(amount × rate / (1 + rate), 2)    tax mode INCLUSIVE (price includes tax, cash sales)
 *   header totals = sums of the lines; the total is rounded to 5 sen when the policy is on,
 *   and the adjustment is kept as its own amount.
 * Rounding is half-up. Never use JS numbers for these.
 */

export type TaxMode = 'EXCLUSIVE' | 'INCLUSIVE';

export interface SaleLineInput {
  qty: DecimalInput;
  unitPrice: DecimalInput;
  /** 5 for 5 %. */
  discountPct?: DecimalInput;
  /** Fraction: 0.1 for SST 10%. */
  taxRate: DecimalInput;
}

export interface SaleLineTotals {
  grossAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  /** After discount. Before tax in EXCLUSIVE mode, including tax in INCLUSIVE mode. */
  amount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}

export interface SaleTotals {
  /** EXCLUSIVE: sum of gross. INCLUSIVE: amount before tax. */
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  rounding: Prisma.Decimal;
  total: Prisma.Decimal;
}

export function saleLineTotals(line: SaleLineInput, taxMode: TaxMode = 'EXCLUSIVE'): SaleLineTotals {
  const grossAmount = roundMoney(dec(line.qty).mul(dec(line.unitPrice)));
  const discountAmount = roundMoney(grossAmount.mul(dec(line.discountPct ?? 0)).div(100));
  const amount = grossAmount.sub(discountAmount);
  const rate = dec(line.taxRate);
  const taxAmount = taxMode === 'INCLUSIVE' ? roundMoney(amount.mul(rate).div(rate.add(1))) : roundMoney(amount.mul(rate));
  return { grossAmount, discountAmount, amount, taxAmount };
}

/** Round to the nearest 5 sen (Malaysian cash rounding): 10.02 → 10.00, 10.03 → 10.05, 10.08 → 10.10. */
export function roundTo5Sen(value: DecimalInput): Prisma.Decimal {
  return dec(value).mul(20).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).div(20).toDecimalPlaces(2);
}

export function saleTotals(lines: SaleLineTotals[], taxMode: TaxMode = 'EXCLUSIVE', roundTo5: boolean = false): SaleTotals {
  const sum = (pick: (l: SaleLineTotals) => Prisma.Decimal) => lines.reduce((s, l) => s.add(pick(l)), dec(0));
  const gross = sum((l) => l.grossAmount);
  const discountTotal = sum((l) => l.discountAmount);
  const amount = sum((l) => l.amount);
  const taxTotal = sum((l) => l.taxAmount);
  const beforeRounding = taxMode === 'INCLUSIVE' ? amount : amount.add(taxTotal);
  const total = roundTo5 ? roundTo5Sen(beforeRounding) : beforeRounding;
  return {
    subtotal: taxMode === 'INCLUSIVE' ? amount.sub(taxTotal) : gross,
    discountTotal,
    taxTotal,
    rounding: total.sub(beforeRounding),
    total,
  };
}

/** Margin on the amount before tax: (amount − cost) / amount × 100, one decimal. Null when there is no cost or no amount. */
export function marginPct(amount: DecimalInput, cost: DecimalInput | null): Prisma.Decimal | null {
  if (cost === null || dec(amount).lte(0)) return null;
  return dec(amount).sub(dec(cost)).div(dec(amount)).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
}

/** What the customer still owes on an invoice: total + debit notes − returns − deposit used − payments. */
export function invoiceBalance(i: { total: DecimalInput; debited: DecimalInput; credited: DecimalInput; deposit: DecimalInput; paid: DecimalInput }): Prisma.Decimal {
  return dec(i.total).add(dec(i.debited)).sub(dec(i.credited)).sub(dec(i.deposit)).sub(dec(i.paid));
}
