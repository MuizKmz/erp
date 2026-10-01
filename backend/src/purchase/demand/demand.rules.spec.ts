import { roundUpToPack, suggestPurchase } from './demand.rules';

const qty = (r: { suggestedQty: { toString(): string } }) => r.suggestedQty.toString();

describe('suggestPurchase — the 29 Sep demand list', () => {
  it('SC-WOD-08: 5 on hand, reorder 20, pack 10 → buy 20', () => {
    const r = suggestPurchase({ onHand: 5, onOrder: 0, reorderLevel: 20, salesNeed: 0, packSize: 10 });
    expect(r.status).toBe('NEEDS_BUYING');
    expect(qty(r)).toBe('20');
  });

  it('VR-LAC-01: 3 on hand, reorder 10, pack 4 → buy 8', () => {
    expect(qty(suggestPurchase({ onHand: 3, onOrder: 0, reorderLevel: 10, salesNeed: 0, packSize: 4 }))).toBe('8');
  });

  it('CH-DIN-01: 0 on hand, reorder 50, SO-0001 needs 40 → buy 90', () => {
    expect(qty(suggestPurchase({ onHand: 0, onOrder: 0, reorderLevel: 50, salesNeed: 40, packSize: 1 }))).toBe('90');
  });

  it('TB-DIN-06: 4 on hand, reorder 5, SO-0008 needs 30 → buy 31', () => {
    expect(qty(suggestPurchase({ onHand: 4, onOrder: 0, reorderLevel: 5, salesNeed: 30, packSize: 1 }))).toBe('31');
  });

  it('FB-OAK-01: 30 on hand, reorder 50, 65 on order → covered', () => {
    const r = suggestPurchase({ onHand: 30, onOrder: 65, reorderLevel: 50, salesNeed: 0, packSize: 1 });
    expect(r.status).toBe('COVERED');
    expect(qty(r)).toBe('0');
  });

  it('SF-CUS-03: buy to order, SO-0003 needs 20, PO-0003 has 20 → covered', () => {
    expect(suggestPurchase({ onHand: 0, onOrder: 20, reorderLevel: 0, salesNeed: 20, packSize: 1 }).status).toBe('COVERED');
  });

  it('above the reorder level with no sales need → not needed', () => {
    expect(suggestPurchase({ onHand: 20, onOrder: 0, reorderLevel: 10, salesNeed: 0, packSize: 1 }).status).toBe('NOT_NEEDED');
  });

  it('items without a reorder level only count sales needs', () => {
    expect(suggestPurchase({ onHand: 0, onOrder: 0, reorderLevel: null, salesNeed: 0, packSize: 1 }).status).toBe('NOT_NEEDED');
    expect(qty(suggestPurchase({ onHand: 0, onOrder: 0, reorderLevel: null, salesNeed: 3, packSize: 1 }))).toBe('3');
  });

  it('a partly covered need suggests only the rest', () => {
    expect(qty(suggestPurchase({ onHand: 0, onOrder: 30, reorderLevel: 50, salesNeed: 0, packSize: 1 }))).toBe('20');
  });
});

describe('roundUpToPack', () => {
  it('rounds up to whole packs and leaves exact multiples alone', () => {
    expect(roundUpToPack(15, 10).toString()).toBe('20');
    expect(roundUpToPack(20, 10).toString()).toBe('20');
    expect(roundUpToPack(7, 4).toString()).toBe('8');
  });

  it('treats a missing or zero pack size as 1', () => {
    expect(roundUpToPack('2.5', 0).toString()).toBe('3');
  });
});
