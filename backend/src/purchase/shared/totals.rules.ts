import type { Prisma } from '@prisma/client';
import { dec, roundMoney, type DecimalInput } from '../../platform/http/decimal';

/**
 * Document money rules (CLAUDE.md → Database conventions):
 *   line amount = round(qty × unit price, 2)
 *   line tax    = round(line amount × tax rate, 2)
 *   header totals = sums of the lines
 * Rounding is half-up. Never use JS numbers for these.
 */

export interface LineInput {
  qty: DecimalInput;
  unitPrice: DecimalInput;
  /** Fraction: 0.1 for SST 10%. */
  taxRate: DecimalInput;
}

export interface LineTotals {
  amount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}

export interface DocumentTotals {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

export function lineTotals(line: LineInput): LineTotals {
  const amount = roundMoney(dec(line.qty).mul(dec(line.unitPrice)));
  const taxAmount = roundMoney(amount.mul(dec(line.taxRate)));
  return { amount, taxAmount };
}

export function documentTotals(lines: LineTotals[]): DocumentTotals {
  const subtotal = lines.reduce((sum, l) => sum.add(l.amount), dec(0));
  const taxTotal = lines.reduce((sum, l) => sum.add(l.taxAmount), dec(0));
  return { subtotal, taxTotal, total: subtotal.add(taxTotal) };
}
