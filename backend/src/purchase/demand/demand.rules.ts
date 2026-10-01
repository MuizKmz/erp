import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';

/**
 * Demand list (P04, flow P1 step 1):
 * "Buy" tops stock back up to the reorder level, adds what open sales orders still need,
 * takes off what is already on order, and rounds up to the pack size.
 */

export interface DemandInput {
  onHand: DecimalInput;
  /** Open PO quantity (drafts included): ordered − received − cancelled. */
  onOrder: DecimalInput;
  /** null when the item is not stocked to a level (services, assets). */
  reorderLevel: DecimalInput | null;
  /** Open sales-order quantity for this item (direct lines only). */
  salesNeed: DecimalInput;
  packSize: DecimalInput;
}

export type DemandStatus =
  | 'NEEDS_BUYING' // a positive suggestion
  | 'COVERED' // there is a need, but open POs already cover it
  | 'NOT_NEEDED'; // no need at all (not shown on the list)

export interface DemandResult {
  status: DemandStatus;
  /** Need before what is on order: (reorder − on hand, if positive) + sales need. */
  grossNeed: Prisma.Decimal;
  /** Suggested quantity to buy, rounded up to the pack size. 0 unless NEEDS_BUYING. */
  suggestedQty: Prisma.Decimal;
}

/** Rounds up to a whole number of packs: 15 with pack 10 → 20. Pack size ≤ 0 is treated as 1. */
export function roundUpToPack(qty: DecimalInput, packSize: DecimalInput): Prisma.Decimal {
  const pack = dec(packSize).lte(0) ? dec(1) : dec(packSize);
  return dec(qty).div(pack).ceil().mul(pack);
}

export function suggestPurchase(input: DemandInput): DemandResult {
  const topUp = input.reorderLevel === null ? dec(0) : atLeastZero(dec(input.reorderLevel).sub(dec(input.onHand)));
  const grossNeed = topUp.add(dec(input.salesNeed));
  if (grossNeed.lte(0)) {
    return { status: 'NOT_NEEDED', grossNeed, suggestedQty: dec(0) };
  }
  const netNeed = grossNeed.sub(dec(input.onOrder));
  if (netNeed.lte(0)) {
    return { status: 'COVERED', grossNeed, suggestedQty: dec(0) };
  }
  return { status: 'NEEDS_BUYING', grossNeed, suggestedQty: roundUpToPack(netNeed, input.packSize) };
}

function atLeastZero(value: Prisma.Decimal): Prisma.Decimal {
  return value.lt(0) ? dec(0) : value;
}
