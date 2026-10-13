import { Injectable } from '@nestjs/common';
import { mergeUsage } from './record-usage.rules';
import type { RecordUsage, RecordUsageProvider, UsageQuery } from './record-usage.types';

/**
 * Who can say where a master-data record is used. Modules that keep documents (Purchase, Sales; later WMS and MES)
 * register a read-only provider at start-up, the same way they register outbox listeners. Core asks here and never
 * reads the modules' tables or imports them.
 */
@Injectable()
export class RecordUsageRegistry {
  private readonly providers = new Map<string, RecordUsageProvider>();

  register(provider: RecordUsageProvider): void {
    if (this.providers.has(provider.module)) throw new Error(`A record-usage provider for "${provider.module}" is already registered`);
    this.providers.set(provider.module, provider);
  }

  modules(): string[] {
    return [...this.providers.keys()].sort();
  }

  async check(query: UsageQuery): Promise<RecordUsage> {
    const answers = await Promise.all([...this.providers.values()].map((p) => p.usage(query)));
    return mergeUsage(query, answers);
  }
}
