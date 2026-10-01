/**
 * Form previews of line amounts, with the server's rules (totals.rules.ts):
 *   amount = round(qty × price, 2), tax = round(amount × rate, 2), half-up.
 * Works on BigInt minor units, so no float error ever reaches the screen. The server's totals stay the truth.
 */

const SCALE = 4 // qty, price and rate travel with 4 decimals

function toUnits(value: string, scale = SCALE): bigint | null {
  const v = value.trim()
  if (!/^-?\d*(\.\d*)?$/.test(v) || v === '' || v === '.' || v === '-') return null
  const negative = v.startsWith('-')
  const [whole = '0', fraction = ''] = v.replace('-', '').split('.')
  if (fraction.length > scale) return null
  const units = BigInt((whole || '0') + fraction.padEnd(scale, '0'))
  return negative ? -units : units
}

/** Divides and rounds half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d
  const r = n % d
  if (r === 0n) return q
  const twice = (r < 0n ? -r : r) * 2n
  return twice >= d ? q + (n < 0n ? -1n : 1n) : q
}

function centsToString(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  const text = abs.toString().padStart(3, '0')
  return `${negative ? '-' : ''}${text.slice(0, -2)}.${text.slice(-2)}`
}

export interface LinePreview {
  amount: string
  taxAmount: string
}

/** null when qty or price is not a valid number with up to 4 decimals. */
export function previewLine(qty: string, unitPrice: string, taxRate: string): LinePreview | null {
  const q = toUnits(qty)
  const p = toUnits(unitPrice)
  const r = toUnits(taxRate)
  if (q === null || p === null || r === null) return null
  // q, p have 4 decimals → product has 8; cents = round(product / 10^6)
  const amountCents = divRound(q * p, 10n ** 6n)
  // cents × rate(4 decimals) → round(/10^4)
  const taxCents = divRound(amountCents * r, 10n ** 4n)
  return { amount: centsToString(amountCents), taxAmount: centsToString(taxCents) }
}

/** Sum of money strings ("4000.00" + "400.00"). */
export function sumMoney(values: string[]): string {
  const cents = values.reduce((sum, v) => sum + (toUnits(v, 2) ?? 0n), 0n)
  return centsToString(cents)
}

/** Is this a valid quantity/price with up to 4 decimals and more than zero? */
export function isPositiveDecimal(value: string): boolean {
  const units = toUnits(value)
  return units !== null && units > 0n
}
