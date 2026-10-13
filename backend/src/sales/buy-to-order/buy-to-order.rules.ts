import type { Prisma } from '@prisma/client';
import { dec, type DecimalInput } from '../../platform/http/decimal';
import { isRecord, text } from '../../platform/outbox/outbox.payload';

/**
 * Buy-to-order lines (S10). Purchase tells Sales, through its events, which PO a line is on, what arrived and what
 * was cancelled. Sales keeps those numbers on the order line and never reads Purchase tables. Pure functions.
 */

export type BuyToOrderState = 'WAITING_PO' | 'NO_PO' | 'ON_ORDER' | 'PART_RECEIVED' | 'RECEIVED' | 'PO_CANCELLED';

export interface BuyToOrderLine {
  isBuyToOrder: boolean;
  purchaseOrderNo: string | null;
  purchaseProblem: string | null;
  orderedQty: DecimalInput;
  cancelledQty?: DecimalInput;
  purchaseReceivedQty: DecimalInput;
  purchaseCancelledQty: DecimalInput;
  uomCode: string;
}

const plain = (v: DecimalInput) => dec(v).toFixed(4).replace(/\.?0+$/, '');

/** Where a buy-to-order line stands with Purchase, and the words shown next to it. Null for other lines. */
export function buyToOrderStatus(l: BuyToOrderLine): { state: BuyToOrderState; label: string } | null {
  if (!l.isBuyToOrder) return null;
  if (!l.purchaseOrderNo) {
    return l.purchaseProblem
      ? { state: 'NO_PO', label: `No PO yet: ${l.purchaseProblem}` }
      : { state: 'WAITING_PO', label: 'Waiting for Purchase to draft the PO' };
  }
  const needed = dec(l.orderedQty).sub(dec(l.cancelledQty ?? 0));
  const received = dec(l.purchaseReceivedQty);
  const po = l.purchaseOrderNo;
  if (received.gte(needed) && needed.gt(0)) return { state: 'RECEIVED', label: `${po} · received` };
  if (dec(l.purchaseCancelledQty).gt(0)) {
    return { state: 'PO_CANCELLED', label: `${po} · Purchase cancelled ${plain(l.purchaseCancelledQty)} ${l.uomCode}` };
  }
  if (received.gt(0)) return { state: 'PART_RECEIVED', label: `${po} · ${plain(received)} of ${plain(needed)} received` };
  return { state: 'ON_ORDER', label: po };
}

/** Goods Purchase received for this line that have not been delivered yet. They count as stock on the waiting list. */
export function purchaseReady(l: { purchaseReceivedQty: DecimalInput; deliveredQty: DecimalInput }): Prisma.Decimal {
  const left = dec(l.purchaseReceivedQty).sub(dec(l.deliveredQty));
  return left.gt(0) ? left : dec(0);
}

/**
 * Spreads quantities from a Purchase event over the order lines on that PO with the same item, filling each line up
 * to its ordered quantity in line order (`current` = what is already received or cancelled on it).
 * What is left over (the buyer ordered more than the sales order needs):
 * - 'last': goes to the last line. A receipt over the need still means the goods are there.
 * - 'drop': is ignored. Cancelling the surplus costs the sales order nothing, so only its shortfall counts.
 */
export function allocateToLines<T extends { id: string; itemCode: string; orderedQty: DecimalInput; current: DecimalInput }>(
  lines: T[],
  incoming: { itemCode: string; qty: DecimalInput }[],
  overflow: 'last' | 'drop' = 'last',
): { id: string; itemCode: string; add: Prisma.Decimal }[] {
  const adds = new Map<string, Prisma.Decimal>();
  for (const { itemCode, qty } of incoming) {
    const matching = lines.filter((l) => l.itemCode === itemCode);
    if (matching.length === 0) continue;
    let left = dec(qty);
    matching.forEach((l, i) => {
      if (left.lte(0)) return;
      const already = dec(l.current).add(adds.get(l.id) ?? 0);
      const room = dec(l.orderedQty).sub(already);
      const fits = room.gt(0) ? (room.lt(left) ? room : left) : dec(0);
      const take = overflow === 'last' && i === matching.length - 1 ? left : fits;
      if (take.gt(0)) {
        adds.set(l.id, (adds.get(l.id) ?? dec(0)).add(take));
        left = left.sub(take);
      }
    });
  }
  return lines.filter((l) => adds.has(l.id)).map((l) => ({ id: l.id, itemCode: l.itemCode, add: adds.get(l.id)! }));
}

// ── Event payloads (Sales never imports Purchase, so it reads the fields it needs) ─────────────────

const qtyLines = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter(isRecord).flatMap((l) => {
    const itemCode = text(l.itemCode);
    const qty = text(l.qty);
    return itemCode && qty ? [{ itemCode, qty, uomCode: text(l.uomCode) ?? '' }] : [];
  });

/** `purchase.buy_to_order.handled`: which order line went on which PO, or why not. */
export function readBuyToOrderHandled(payload: unknown) {
  if (!isRecord(payload) || !text(payload.soNo) || !Array.isArray(payload.lines)) return null;
  return {
    soNo: text(payload.soNo)!,
    lines: payload.lines.filter(isRecord).flatMap((l) =>
      typeof l.soLineNo === 'number' && text(l.itemCode) ? [{ soLineNo: l.soLineNo, itemCode: text(l.itemCode)!, poNo: text(l.poNo), problem: text(l.problem) }] : [],
    ),
  };
}

/** `purchase.goods.received` and `purchase.order.balance_cancelled`: the PO, the document and its quantities. */
export function readPurchaseQtyEvent(payload: unknown, docField: 'grnNo' | 'pcoNo') {
  if (!isRecord(payload) || !text(payload.poNo) || !text(payload[docField])) return null;
  return { poNo: text(payload.poNo)!, docNo: text(payload[docField])!, lines: qtyLines(payload.lines) };
}

export const qtyText = plain;
