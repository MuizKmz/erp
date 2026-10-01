import { Prisma } from '@prisma/client';

/**
 * Money and quantities are never JS floats. Calculate with Prisma.Decimal and send strings.
 * Rounding is half-up (2.675 → 2.68), which is what customers and suppliers expect on paper.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type DecimalInput = Prisma.Decimal | string | number;

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export function dec(value: DecimalInput | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

/** Round to 2 decimals (money). */
export function roundMoney(value: DecimalInput): Prisma.Decimal {
  return dec(value).toDecimalPlaces(2, HALF_UP);
}

/** "4400.00" — money as sent in JSON and events. */
export function toMoney(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(2, HALF_UP);
}

/** "95.0000" — quantities as sent in JSON and events. */
export function toQty(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(4, HALF_UP);
}

/** "40.0000" — unit prices keep 4 decimals. */
export function toPrice(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(4, HALF_UP);
}

/** "0.1000" — tax rates as fractions with 4 decimals. */
export function toRate(value: DecimalInput | null | undefined): string {
  return dec(value).toFixed(4, HALF_UP);
}

export function toMoneyOrNull(value: DecimalInput | null | undefined): string | null {
  return value === null || value === undefined ? null : toMoney(value);
}
