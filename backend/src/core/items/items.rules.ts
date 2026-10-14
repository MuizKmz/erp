/**
 * Item rules (CLAUDE.md → Phase 3 · Core business rules 1–6). Pure functions; the service loads the data and
 * turns the answers into 400 / 409 responses.
 */
import { dec, type DecimalInput } from '../../platform/http/decimal';
import type { FieldError } from '../../platform/http/errors';

export const ITEM_STATUSES = ['ACTIVE', 'BLOCKED', 'DISCONTINUED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_TYPES = ['STOCK', 'NON_STOCK', 'SERVICE', 'ASSET'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const TYPE_LABEL: Record<ItemType, string> = { STOCK: 'Stock', NON_STOCK: 'Non-stock', SERVICE: 'Service', ASSET: 'Asset' };
export const STATUS_LABEL: Record<ItemStatus, string> = { ACTIVE: 'Active', BLOCKED: 'Blocked', DISCONTINUED: 'Discontinued' };

/** FB-OAK-01: capitals, digits and hyphens, 2 to 30 characters. Typed once; it never changes. */
export const ITEM_CODE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;

/** Field labels for the before-and-after audit, in the order the form shows them. */
export const ITEM_LABELS: Record<string, string> = {
  name: 'Name',
  itemGroup: 'Item group',
  type: 'Type',
  baseUom: 'Base unit',
  barcode: 'Barcode',
  einvoiceClassification: 'e-Invoice classification',
  isPurchasable: 'Can be bought',
  isBuyToOrder: 'Buy to order only',
  purchaseUom: 'Purchase unit',
  purchaseTaxCode: 'Purchase tax',
  preferredSupplierCode: 'Preferred supplier',
  reorderLevel: 'Reorder level',
  packSize: 'Pack size',
  isSellable: 'Can be sold',
  salesUom: 'Sales unit',
  salesTaxCode: 'Sales tax',
  standardCost: 'Standard cost',
  conversions: 'Conversions',
};

export interface ItemFields {
  name: string;
  itemGroup: string;
  type: string;
  baseUom: string;
  isPurchasable: boolean;
  purchaseTaxCode: string | null;
  isSellable: boolean;
  salesTaxCode: string | null;
}

/** What an item needs before it can be active (rule 5). Empty = ready. */
export function activationGaps(item: ItemFields): FieldError[] {
  const gaps: FieldError[] = [];
  if (!item.name?.trim()) gaps.push({ field: 'name', message: 'Give the item a name.' });
  if (!item.itemGroup?.trim()) gaps.push({ field: 'itemGroup', message: 'Pick the item group.' });
  if (!item.type) gaps.push({ field: 'type', message: 'Pick the type.' });
  if (!item.baseUom) gaps.push({ field: 'baseUom', message: 'Pick the base unit.' });
  if (item.isPurchasable && !item.purchaseTaxCode) gaps.push({ field: 'purchaseTaxCode', message: 'An item that can be bought needs a purchase tax code.' });
  if (item.isSellable && !item.salesTaxCode) gaps.push({ field: 'salesTaxCode', message: 'An item that can be sold needs a sales tax code.' });
  return gaps;
}

export interface Conversion {
  fromUom: string;
  toUom: string;
  factor: DecimalInput;
}

/** "1 ROLL = 50 M" */
export function conversionText(c: Conversion): string {
  return `1 ${c.fromUom} = ${dec(c.factor).toString()} ${c.toUom}`;
}

/**
 * One conversion against the item's base unit (rule 6, SRS FR-MST-017). A conversion reads "1 from = factor to" and
 * one side must be the base unit. Against the base it is "1 base = f other". When f is below 1, one of the other
 * unit is 1/f base units, and that may not need more decimals than the base unit allows: with PCS (0 decimals),
 * "1 PCS = 0.5 BOX" is fine (1 BOX = 2 PCS) but "1 PCS = 0.3 BOX" is not (1 BOX = 3.33 PCS).
 */
export function conversionError(c: Conversion, baseUom: string, decimals: Map<string, number>): string | null {
  const factor = dec(c.factor);
  if (!c.fromUom || !c.toUom) return 'Pick both units of the conversion.';
  if (c.fromUom === c.toUom) return 'A conversion needs two different units.';
  if (!factor.gt(0)) return 'A conversion factor must be more than 0.';
  if (c.fromUom !== baseUom && c.toUom !== baseUom) return `A conversion is to or from the base unit (${baseUom}).`;
  const toBase = c.toUom === baseUom;
  const other = toBase ? c.fromUom : c.toUom;
  // Base units in one of the other unit. f = 1 / basePerOther, so "f below 1" is "more than one base unit".
  const basePerOther = toBase ? factor : dec(1).div(factor);
  const allowed = decimals.get(baseUom) ?? 0;
  if (basePerOther.gt(1) && basePerOther.decimalPlaces() > allowed) {
    const shown = basePerOther.toDecimalPlaces(4).toString();
    return `1 ${other} would be ${shown} ${baseUom}, but ${baseUom} allows ${allowed === 0 ? 'no decimals' : `${allowed} decimal${allowed === 1 ? '' : 's'}`}.`;
  }
  return null;
}

/** Every conversion of an item, plus "only one conversion per unit". Errors by field path conversions[i]. */
export function conversionErrors(conversions: Conversion[], baseUom: string, decimals: Map<string, number>): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  conversions.forEach((c, i) => {
    const message = conversionError(c, baseUom, decimals);
    if (message) errors.push({ field: `conversions[${i}]`, message });
    const other = c.fromUom === baseUom ? c.toUom : c.fromUom;
    if (!message && seen.has(other)) errors.push({ field: `conversions[${i}]`, message: `${other} already has a conversion.` });
    seen.add(other);
  });
  return errors;
}

/** The purchase or sales unit is the base unit, or a unit the item has a conversion for. */
export function unitChoiceError(unit: string | null, baseUom: string, conversions: Conversion[], what: 'Purchase unit' | 'Sales unit'): string | null {
  if (!unit || unit === baseUom) return null;
  const converted = conversions.some((c) => (c.fromUom === baseUom && c.toUom === unit) || (c.toUom === baseUom && c.fromUom === unit));
  return converted ? null : `${what} ${unit} needs a conversion to the base unit (${baseUom}).`;
}

export type ItemAction = 'edit' | 'block' | 'activate' | 'discontinue' | 'delete';

/** Which status actions the status allows, before the usage check. */
export function statusActions(status: ItemStatus): ItemAction[] {
  if (status === 'ACTIVE') return ['block', 'discontinue'];
  if (status === 'BLOCKED') return ['activate', 'discontinue'];
  return ['activate'];
}

/** The stored item as plain values, for the before-and-after audit and the mdm.item.* event payload. */
export interface ItemRecord {
  code: string;
  name: string;
  itemGroup: string;
  type: string;
  baseUom: string;
  barcode: string | null;
  einvoiceClassification: string | null;
  isPurchasable: boolean;
  isBuyToOrder: boolean;
  purchaseUom: string | null;
  purchaseTaxCode: string | null;
  preferredSupplierCode: string | null;
  reorderLevel: DecimalInput | null;
  packSize: DecimalInput;
  isSellable: boolean;
  salesUom: string | null;
  salesTaxCode: string | null;
  standardCost: DecimalInput | null;
  status: string;
}

const qty = (v: DecimalInput | null) => (v === null || v === undefined ? null : dec(v).toFixed(4));

/** What the audit compares: decimals at 4 places, conversions as one line of text. */
export function itemAudit(item: ItemRecord, conversions: Conversion[]): Record<string, unknown> {
  return {
    ...item,
    reorderLevel: qty(item.reorderLevel),
    packSize: qty(item.packSize),
    standardCost: qty(item.standardCost),
    conversions: conversions.length ? conversions.map(conversionText).join('; ') : null,
  };
}

/** The item after a change, as mdm.item.* events carry it: codes and plain values (CLAUDE.md → Events Core publishes). */
export function itemSnapshot(item: ItemRecord, conversions: Conversion[]) {
  return {
    code: item.code,
    name: item.name,
    itemGroup: item.itemGroup,
    type: item.type,
    baseUom: item.baseUom,
    purchaseUom: item.purchaseUom,
    salesUom: item.salesUom,
    isPurchasable: item.isPurchasable,
    isBuyToOrder: item.isBuyToOrder,
    isSellable: item.isSellable,
    purchaseTaxCode: item.purchaseTaxCode,
    salesTaxCode: item.salesTaxCode,
    preferredSupplierCode: item.preferredSupplierCode,
    reorderLevel: qty(item.reorderLevel),
    packSize: qty(item.packSize),
    barcode: item.barcode,
    einvoiceClassification: item.einvoiceClassification,
    standardCost: qty(item.standardCost),
    status: item.status,
    conversions: conversions.map((c) => ({ fromUom: c.fromUom, toUom: c.toUom, factor: dec(c.factor).toString() })),
  };
}
