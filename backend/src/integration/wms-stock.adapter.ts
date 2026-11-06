import type { StockLevel, StockPort } from './integration.ports';
import type { WmsClient } from './wms-client';
import { levelsFromTags, type WmsTag } from './wms-stock.rules';

/**
 * Stock on hand read from a WMS's API, chosen with WMS_URL (one server serves one client). Read only: stock moves still
 * wait in the outbox. If the WMS cannot be reached the user is never blocked: screens get the last figures it gave.
 */
export class WmsStockAdapter implements StockPort {
  readonly connected = true;
  readonly movementsConnected = false;

  constructor(private readonly wms: WmsClient) {}

  async listStock(_tenantId: string, itemCodes?: string[]): Promise<StockLevel[]> {
    try {
      const { data, asOf } = await this.wms.get<WmsTag[]>('epc?status=INBOUND');
      return levelsFromTags(data, asOf, itemCodes);
    } catch {
      return [];
    }
  }
}
