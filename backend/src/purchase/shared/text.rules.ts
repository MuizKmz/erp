import { dec, type DecimalInput } from '../../platform/http/decimal';

/** Unit words for sentences: "95 rolls", "1 pcs", "10 packs". */
const UNIT_WORDS: Record<string, [one: string, many: string]> = {
  ROLL: ['roll', 'rolls'],
  PCS: ['pcs', 'pcs'],
  BOX: ['box', 'boxes'],
  TIN: ['tin', 'tins'],
  SET: ['set', 'sets'],
  LOT: ['lot', 'lots'],
  PACK: ['pack', 'packs'],
  M: ['m', 'm'],
};

/** Quantity without trailing zeros: "95.0000" → "95", "2.5000" → "2.5". */
export function plainQty(value: DecimalInput): string {
  return dec(value).toDecimalPlaces(4).toString();
}

/** "95 rolls" */
export function qtyWithUnit(qty: DecimalInput, uomCode: string): string {
  const words = UNIT_WORDS[uomCode];
  const n = dec(qty);
  if (!words) return `${plainQty(n)} ${uomCode}`;
  return `${plainQty(n)} ${n.eq(1) ? words[0] : words[1]}`;
}
