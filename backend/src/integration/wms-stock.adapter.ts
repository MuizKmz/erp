import { Logger } from '@nestjs/common';
import type { StockLevel, StockPort } from './integration.ports';
import { levelsFromTags, type WmsTag } from './wms-stock.rules';

export interface WmsSettings {
  url: string;
  email: string;
  password: string;
}

/** Many screens ask for stock at once, so one answer is reused briefly instead of asking the WMS each time. */
const CACHE_MS = 15_000;

/**
 * Stock on hand read from a WMS's API, chosen with WMS_URL (one server serves one client). Read only: stock moves still
 * wait in the outbox. If the WMS cannot be reached the user is never blocked: screens get the last figures it gave.
 */
export class WmsStockAdapter implements StockPort {
  readonly connected = true;
  readonly movementsConnected = false;

  private readonly logger = new Logger(WmsStockAdapter.name);
  private token: string | null = null;
  private cached: { at: number; tags: WmsTag[]; asOf: string } | null = null;

  constructor(private readonly settings: WmsSettings) {}

  async listStock(_tenantId: string, itemCodes?: string[]): Promise<StockLevel[]> {
    const { tags, asOf } = await this.tags();
    return levelsFromTags(tags, asOf, itemCodes);
  }

  private async tags(): Promise<{ tags: WmsTag[]; asOf: string }> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached;
    try {
      const tags = await this.fetchTags();
      this.cached = { at: Date.now(), tags, asOf: new Date().toISOString() };
      return this.cached;
    } catch (error) {
      this.logger.warn(`Cannot read stock from the WMS: ${error instanceof Error ? error.message : String(error)}`);
      return this.cached ?? { tags: [], asOf: new Date().toISOString() };
    }
  }

  private async fetchTags(): Promise<WmsTag[]> {
    const url = `${this.settings.url}/api/epc?status=INBOUND`;
    let res = await fetch(url, { headers: await this.headers() });
    if (res.status === 401) {
      this.token = null; // The WMS token ended: sign in once more.
      res = await fetch(url, { headers: await this.headers() });
    }
    if (!res.ok) throw new Error(`GET /api/epc answered ${res.status}`);
    const body = (await res.json()) as WmsTag[] | { data?: WmsTag[] };
    return Array.isArray(body) ? body : (body.data ?? []);
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token) {
      const res = await fetch(`${this.settings.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: this.settings.email, password: this.settings.password }),
      });
      if (!res.ok) throw new Error(`Sign-in answered ${res.status}`);
      this.token = ((await res.json()) as { token: string }).token;
    }
    return { authorization: `Bearer ${this.token}` };
  }
}
