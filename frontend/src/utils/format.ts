/**
 * Display formatting (DESIGN_TOKENS.md → Numbers and dates).
 * Money and quantities arrive from the API as strings ("4400.00", "95.0000") and are never turned into
 * JS floats: rounding works on BigInt minor units.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kuala_Lumpur'

/** "1234.5" → { negative, units: 123450n } with `scale` decimals (half-up rounding). */
function toScaled(value: string, scale: number): { negative: boolean; units: bigint } {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '0', fraction = ''] = trimmed.replace(/^[-+]/, '').split('.')
  const padded = (fraction + '0'.repeat(scale + 1)).slice(0, scale + 1)
  let units = BigInt((whole || '0') + padded.slice(0, scale))
  if (Number(padded[scale] ?? '0') >= 5) units += 1n
  return { negative: negative && units !== 0n, units }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 4400 → "4,400.00"; with decimals 0 → "4,400". Empty or invalid input gives "". */
export function formatMoney(value: string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '' || !/^[-+]?\d*(\.\d*)?$/.test(value.trim())) return ''
  const { negative, units } = toScaled(value, decimals)
  const text = units.toString().padStart(decimals + 1, '0')
  const whole = decimals ? text.slice(0, -decimals) : text
  const fraction = decimals ? `.${text.slice(-decimals)}` : ''
  return `${negative ? '-' : ''}${groupThousands(whole)}${fraction}`
}

/** "RM 4,400.00" */
export function formatRm(value: string | null | undefined, decimals = 2): string {
  const money = formatMoney(value, decimals)
  return money ? `RM ${money}` : ''
}

/** "95.0000" → "95", "2.5000" → "2.5". Up to `maxDecimals` places, trailing zeros dropped. */
export function formatQty(value: string | null | undefined, maxDecimals = 4): string {
  if (value === null || value === undefined || value === '') return ''
  const { negative, units } = toScaled(value, maxDecimals)
  const text = units.toString().padStart(maxDecimals + 1, '0')
  const whole = text.slice(0, -maxDecimals) || '0'
  const fraction = text.slice(-maxDecimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${groupThousands(whole)}${fraction ? `.${fraction}` : ''}`
}

/** A YYYY-MM-DD business date as a Date that formats to the same calendar day in any timezone. */
function calendarDay(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00Z`)
}

/** Three-letter month as in the mockups: "Sep" (en-GB would give "Sept"). */
function shortMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d)
}

/** "2026-09-29" → "29 Sep 2026" */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const d = calendarDay(isoDate)
  return `${d.getUTCDate()} ${shortMonth(d)} ${d.getUTCFullYear()}`
}

/** "2026-09-29" → "29 Sep" */
export function formatDayMonth(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const d = calendarDay(isoDate)
  return `${d.getUTCDate()} ${shortMonth(d)}`
}

/** "2026-09-29" → "Tuesday, 29 September 2026" (Purchase home header) */
export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(calendarDay(isoDate))
}

/** "2026-09-29" → "Tuesday, September 29" (module top bar) */
export function formatTopBarDate(isoDate: string): string {
  const d = calendarDay(isoDate)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d)
  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d)
  return `${weekday}, ${monthDay}`
}

/** "2026-09" or "2026-09-29" → "September" */
export function formatMonthName(isoMonth: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(calendarDay(`${isoMonth.slice(0, 7)}-15`))
}

/** A moment → "10:01 AM" in Malaysia time */
export function formatTime(moment: Date | string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: BUSINESS_TIMEZONE })
    .format(new Date(moment))
}

/** A moment → "29 Sep, 10:05 AM" in Malaysia time */
export function formatDateTime(moment: Date | string): string {
  const d = new Date(moment)
  const parts = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: BUSINESS_TIMEZONE }).formatToParts(d)
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return `${day} ${month}, ${formatTime(d)}`
}

/** "Lim Mei Ying" → "LM" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Ratio of two decimal strings as a 0–100 percentage for progress bars (display only). */
export function percentOf(part: string | null | undefined, whole: string | null | undefined): number {
  const p = Number(part ?? 0)
  const w = Number(whole ?? 0)
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0
  return Math.max(0, Math.min(100, (p / w) * 100))
}
