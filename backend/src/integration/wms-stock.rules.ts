import type { StockLevel } from './integration.ports';

/** The fields the ERP reads from one WMS tag (GET /api/epc?status=INBOUND). */
export interface WmsTag {
  status: string;
  product?: { skuCode?: string | null } | null;
  warehouse?: { warehouseCode?: string | null } | null;
}

/**
 * Stock per item and warehouse from the WMS's RFID tags: one tag in the warehouse is one unit on hand. Tags are counted
 * rather than the WMS `inventory` table, which is per product only and also counts tags not yet scanned in.
 * A WMS SKU is the ERP item code.
 */
export function levelsFromTags(tags: WmsTag[], asOf: string, itemCodes?: string[]): StockLevel[] {
  const wanted = itemCodes && new Set(itemCodes);
  const counts = new Map<string, { itemCode: string; warehouseCode: string; onHand: number }>();
  for (const tag of tags) {
    const itemCode = tag.product?.skuCode;
    const warehouseCode = tag.warehouse?.warehouseCode;
    if (tag.status !== 'INBOUND' || !itemCode || !warehouseCode) continue;
    if (wanted && !wanted.has(itemCode)) continue;
    const key = `${itemCode}|${warehouseCode}`;
    const row = counts.get(key) ?? { itemCode, warehouseCode, onHand: 0 };
    row.onHand += 1;
    counts.set(key, row);
  }
  return [...counts.values()]
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.warehouseCode.localeCompare(b.warehouseCode))
    .map((r) => ({ itemCode: r.itemCode, warehouseCode: r.warehouseCode, onHand: `${r.onHand}.0000`, usedLast30Days: '0.0000', asOf }));
}
